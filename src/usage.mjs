/**
 * Command Code's own `/usage` slash command has no headless equivalent
 * (`cmd -p "/usage"` just hands the literal text to the model — slash
 * commands only exist in the REPL). Its CLI calls undocumented `/alpha/*`
 * REST endpoints instead, using the API key it already stores on disk at
 * `~/.commandcode/auth.json` (shared by both the `cmd` and `commandcode`
 * bin aliases of the `command-code` npm package). This reads that same key
 * and calls those same endpoints directly.
 *
 * `/alpha` is unversioned and undocumented — Command Code can change or
 * remove it without notice, unlike a public API contract.
 */

import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const API_BASE = "https://api.commandcode.ai";
const AUTH_FILE = join(homedir(), ".commandcode", "auth.json");

async function readApiKey() {
  try {
    const raw = await readFile(AUTH_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return typeof parsed.apiKey === "string" && parsed.apiKey.length > 0 ? parsed.apiKey : null;
  } catch {
    return null;
  }
}

async function fetchJson(apiKey, path) {
  const res = await fetch(`${API_BASE}${path}`, { headers: { Authorization: `Bearer ${apiKey}` } });
  if (!res.ok) {
    const err = new Error(`${path} -> HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

function usdWindow(label, used, cap, resetAt) {
  const usedPercent = cap > 0 ? Math.min(100, Math.max(0, (used / cap) * 100)) : 0;
  return {
    label,
    resetsAt: resetAt ? new Date(resetAt).toISOString() : null,
    usedPercent,
    // windowLimits reports plain USD, not credits or tokens — /alpha/usage/summary's
    // totalCost is in the same unit.
    cost: { limitUsdCents: Math.round(cap * 100), usedUsdCents: Math.round(used * 100) },
  };
}

/** @returns {Promise<import("@get-bb/plugin-sdk/provider-bridge").ProviderUsageResult>} */
export async function readCommandCodeUsage() {
  const apiKey = await readApiKey();
  if (apiKey === null) return { supported: true, usage: { status: "unauthenticated" } };

  try {
    const [whoami, credits, subscriptions] = await Promise.all([
      fetchJson(apiKey, "/alpha/whoami").catch(() => null),
      fetchJson(apiKey, "/alpha/billing/credits"),
      fetchJson(apiKey, "/alpha/billing/subscriptions").catch(() => null),
    ]);

    const windows = [];
    const limits = credits?.windowLimits;
    if (limits?.fiveHour) {
      windows.push(usdWindow("5-hour", limits.fiveHour.used, limits.fiveHour.cap, limits.fiveHour.resetAt ?? null));
    }
    if (limits?.weekly) {
      windows.push(usdWindow("Weekly", limits.weekly.used, limits.weekly.cap, limits.weekly.resetAt ?? null));
    }

    const planId = subscriptions?.data?.planId;
    return {
      supported: true,
      usage: {
        status: "ok",
        accountEmail: whoami?.user?.email ?? null,
        planLabel: typeof planId === "string" ? planId : null,
        windows,
      },
    };
  } catch (err) {
    if (err.status === 401 || err.status === 403) {
      return { supported: true, usage: { status: "unauthenticated" } };
    }
    return {
      supported: true,
      usage: {
        status: "error",
        message: err instanceof Error ? err.message : "Failed to load Command Code usage.",
        accountEmail: null,
        planLabel: null,
      },
    };
  }
}
