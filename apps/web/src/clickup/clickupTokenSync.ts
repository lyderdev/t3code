import { runAtomCommand } from "@t3tools/client-runtime/state/runtime";
import { Atom } from "effect/reactivity";

import { appAtomRegistry } from "~/rpc/atomRegistry";
import { primaryEnvironmentIdAtom } from "~/state/primaryEnvironment";
import { environmentPresentations } from "~/state/presentation";
import { serverEnvironment } from "~/state/server";

import { CLICKUP_ACCOUNTS_CHANGED_EVENT, readClickUpAccounts } from "./api";

// Changes when the primary server connects or restarts, so it always holds the current tokens.
const primaryConfigAtom = Atom.make((get) => {
  const environmentId = get(primaryEnvironmentIdAtom);
  if (environmentId === null) return null;
  const config = get(environmentPresentations.serverConfigsAtom).get(environmentId);
  return config === undefined ? null : { environmentId, config };
}).pipe(Atom.withLabel("clickup-token-sync-target"));

/**
 * Gives the primary environment's agents this browser's ClickUp tokens, for its ClickUp MCP
 * tools. Only the primary one: other environments may belong to someone else.
 */
export function startClickUpTokenSync(): () => void {
  let sent: { readonly config: unknown; readonly tokens: string } | undefined;
  const sync = () => {
    const target = appAtomRegistry.get(primaryConfigAtom);
    if (target === null) return;
    const tokens = readClickUpAccounts().map((account) => account.token);
    const key = JSON.stringify(tokens);
    if (sent?.config === target.config && sent.tokens === key) return;
    sent = { config: target.config, tokens: key };
    void runAtomCommand(
      appAtomRegistry,
      serverEnvironment.setClickUpTokens,
      { environmentId: target.environmentId, input: { tokens } },
      { reportFailure: false },
    );
  };
  const unsubscribe = appAtomRegistry.subscribe(primaryConfigAtom, sync);
  window.addEventListener(CLICKUP_ACCOUNTS_CHANGED_EVENT, sync);
  sync();
  return () => {
    unsubscribe();
    window.removeEventListener(CLICKUP_ACCOUNTS_CHANGED_EVENT, sync);
  };
}
