/**
 * Command Code speaks ACP through this plugin's own adapter binary, so the
 * SDK's generic ACP bridge does almost the whole job — BB drives it, it
 * drives `command-code-acp`, and that drives `cmd`.
 *
 * The one thing the generic ACP dialect has no plugin-facing hook for is
 * `provider/usage`: `AcpMaintenanceDialect.readUsage()` exists in the bridge
 * kit's types, but the dialect registry that would let a plugin supply one is
 * explicitly not public yet ("no plugin has needed to supply one" — see the
 * SDK's own `provider-bridge/acp` module docs). Rather than wait on that, this
 * intercepts the one JSON-RPC method at the line level and answers it
 * directly from Command Code's own `/alpha/billing` API (see src/usage.mjs);
 * every other method is forwarded untouched to the real ACP bridge.
 */
import { BRIDGE_REQUEST_METHODS, createBridgeIo } from "@get-bb/plugin-sdk/provider-bridge";
import { experimental_acpProviderBridge } from "@get-bb/plugin-sdk/provider-bridge/acp";
import { readCommandCodeUsage } from "./src/usage.mjs";

const io = createBridgeIo<Record<string, unknown>>({
  write: (line) => process.stdout.write(line + "\n"),
});

export const experimental_providerBridge = {
  ...experimental_acpProviderBridge,
  handleLine(line: string) {
    let msg: unknown;
    try {
      msg = JSON.parse(line);
    } catch {
      experimental_acpProviderBridge.handleLine(line);
      return;
    }
    const { id, method } = (msg ?? {}) as { id?: string | number; method?: string };
    if (method === BRIDGE_REQUEST_METHODS.providerUsage && id !== undefined) {
      readCommandCodeUsage().then((result) => io.sendResult(id, result));
      return;
    }
    experimental_acpProviderBridge.handleLine(line);
  },
};
