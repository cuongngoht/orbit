// HOW EACH RUNTIME MAY SIGN IN, and on what evidence -- the provider's own words, read on 2026-11-21 (plan 7.8). A
// method is offered only when it is `supported`; anything else is shown with its reason and refused at creation
// (`method_not_supported`) -- but for a Claude Code cloud connection, which may be saved and is shown `blocked`: Claude
// Code documents Bedrock, Vertex and Foundry, and nothing here has verified them.
//
// Never offered by any method: a subscription token pasted by hand, a copied `.credentials.json` or `auth.json`, a
// "setup token" for anybody else's use -- Anthropic: developers "may not collect, store, or intermediate Claude.ai
// credentials or session tokens". A subscription is signed in by the provider's own CLI, by its owner: from its card
// (ADR 0061: the CLI's sign-in runs on the server and only the code its owner pastes is relayed to its stdin, kept
// nowhere) or in a terminal of the server.
import type { AuthMethod, MethodSupport, RuntimeKind } from "@orbit-web/contracts";

const CLAUDE_LEGAL = "https://code.claude.com/docs/en/legal-and-compliance";
const CLAUDE_AGENT_SDK = "https://code.claude.com/docs/en/agent-sdk/overview";
const OPENAI = "https://developers.openai.com/llms-full.txt";
const ANTIGRAVITY_TERMS = "https://antigravity.google/terms";

export const METHOD_SUPPORT: readonly MethodSupport[] = [
  {
    runtime: "claude",
    method: "subscription",
    state: "supported",
    note: "Your own Claude subscription, signed in with the unmodified Claude Code CLI's own sign-in -- from its card (Orbit Web runs it on the server, shows the link it prints and hands it the code you paste back, keeping none of it) or in a terminal of the server. Anthropic: \"Nor does it prevent an end user from signing in to the unmodified Claude Code binary with their own Claude subscription, including where a platform hosts Claude Code.\" Its usage limits \"assume ordinary, individual usage\": for autonomous employees an API key is recommended.",
    source: CLAUDE_LEGAL,
  },
  {
    runtime: "claude",
    method: "api_key",
    state: "supported",
    note: "Your own Claude Console API key, entered here once and kept by the server's credential store. Anthropic: \"Developers building products or services that interact with Claude's capabilities, including those using the Agent SDK, should use API key authentication through Claude Console or a supported cloud provider.\"",
    source: CLAUDE_LEGAL,
  },
  {
    runtime: "claude",
    method: "cloud",
    state: "blocked",
    note: "Amazon Bedrock, Google Vertex AI and Microsoft Foundry are documented by Claude Code, but not verified on this installation: a cloud connection is saved and shown, never used.",
    source: CLAUDE_AGENT_SDK,
  },
  {
    runtime: "codex",
    method: "subscription",
    state: "supported",
    note: "ChatGPT sign-in with the Codex CLI's own device flow -- from its card (the link and one-time code it prints are shown there) or in a terminal of the server. OpenAI: ChatGPT sign-in is documented for open-source and locally hosted apps; offering it in a paid or remotely hosted app needs OpenAI's interest form.",
    source: OPENAI,
  },
  {
    runtime: "codex",
    method: "api_key",
    state: "supported",
    note: "Your own OpenAI API key, handed to `codex login --with-api-key` on its standard input. OpenAI: \"Use API key authentication for programmatic Codex CLI workflows.\"",
    source: OPENAI,
  },
  {
    runtime: "codex",
    method: "cloud",
    state: "not_verified",
    note: "No cloud-provider sign-in of the Codex CLI has been verified here.",
    source: null,
  },
  {
    runtime: "agy",
    method: "subscription",
    state: "not_permitted",
    note: "Antigravity's terms: \"Using third party software, tools, or services to access the Service (e.g. using OpenClaw with Antigravity OAuth) is a breach of this Agreement.\" Orbit does not offer its Google sign-in.",
    source: ANTIGRAVITY_TERMS,
  },
  {
    runtime: "agy",
    method: "api_key",
    state: "not_verified",
    note: "A Gemini API key used through Antigravity from another product: its terms say nothing of it, so it is not offered until verified.",
    source: ANTIGRAVITY_TERMS,
  },
  {
    runtime: "agy",
    method: "cloud",
    state: "not_verified",
    note: "Application Default Credentials (a Google Cloud project) are not verified here.",
    source: ANTIGRAVITY_TERMS,
  },
];

export const supportOf = (runtime: RuntimeKind, method: AuthMethod): MethodSupport => METHOD_SUPPORT.find((m) => m.runtime === runtime && m.method === method) as MethodSupport;

// Whether a connection of this kind may be created: a supported method -- or a Claude Code cloud connection, saved and
// shown blocked.
export const mayCreate = (runtime: RuntimeKind, method: AuthMethod): boolean => supportOf(runtime, method).state === "supported" || (runtime === "claude" && method === "cloud");
