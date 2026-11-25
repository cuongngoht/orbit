// THE AIs A CHAT MAY RUN ON, as the account has them: its Claude Code and OpenAI Codex connections that are signed in and
// said which models they may use -- and the one a new chat starts on: that AI's default connection when it is signed
// in, else the first of that AI that is (as the API picks it: run-connections.ts `signedInOf`), else another AI's.
import { CHAT_RUNTIMES, isChatRuntime, type AiConnectionsView, type ChatRuntime, type RuntimeConnection } from "@orbit-web/contracts";

export type ChatConnection = RuntimeConnection & { runtime: ChatRuntime };

export const chatConnectionsOf = (view: AiConnectionsView | null): ChatConnection[] =>
  (view?.connections ?? []).filter((c): c is ChatConnection => isChatRuntime(c.runtime) && c.auth === "connected" && c.catalog.models.length > 0);

const ofRuntime = (chat: readonly ChatConnection[], runtime: ChatRuntime): ChatConnection | null =>
  chat.find((c) => c.runtime === runtime && c.isDefault) ?? chat.find((c) => c.runtime === runtime) ?? null;

export const newChatConnection = (chat: readonly ChatConnection[], runtime: ChatRuntime): ChatConnection | null =>
  ofRuntime(chat, runtime) ?? CHAT_RUNTIMES.map((r) => ofRuntime(chat, r)).find((c) => c !== null) ?? null;

// The AIs a chat runs on, in their order, that the account has signed in -- and those it has not yet.
export const signedInRuntimes = (chat: readonly ChatConnection[]): ChatRuntime[] => CHAT_RUNTIMES.filter((r) => ofRuntime(chat, r) !== null);
export const unsignedRuntimes = (chat: readonly ChatConnection[]): ChatRuntime[] => CHAT_RUNTIMES.filter((r) => ofRuntime(chat, r) === null);
