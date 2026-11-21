// What the Claude CLI said about the signed-in account beyond its address, as one line ("Octo Org · max"), or nothing
// when it said nothing more. The sidebar's account menu and Settings → Account both show it.
import type { ClaudeAccount } from "@orbit-web/contracts";

export const accountLine = (a: ClaudeAccount | null): string | null => {
  const parts = [a?.organization, a?.plan].filter((p): p is string => typeof p === "string" && p !== "");
  return parts.length > 0 ? parts.join(" · ") : null;
};
