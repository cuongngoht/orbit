// The mark of a route a person may reach before Orbit Web is signed in to a Claude account (the Claude sign-in gate,
// modules/claude-auth/claude-sign-in.guard.ts). Only four things carry it: the health check, the access token, the
// Claude sign-in itself, and reading a shared chat's snapshot (its link needs no account). Everything else is gated
// without saying so.
import { SetMetadata } from "@nestjs/common";

export const BEFORE_CLAUDE_SIGN_IN = "orbit-web:before-claude-sign-in";

export const BeforeClaudeSignIn = () => SetMetadata(BEFORE_CLAUDE_SIGN_IN, true);
