// THE CLAUDE SIGN-IN GATE: Orbit Web is signed in when, and only when, the Claude CLI is signed in to a Claude account.
// Every route is refused with 401 claude_sign_in_required until then -- every route but the few a person needs to get
// there, each marked where it is declared with @BeforeClaudeSignIn() (common/before-claude-sign-in.ts): the health
// check, the access token, and the Claude sign-in itself. It is a GLOBAL guard, so a route added later is gated unless
// it says otherwise, and it runs after the host guard and the access token gate (both middleware): in token mode the
// token is asked for first. The static web app is not a route: it loads, and shows the sign-in page.
import { type CanActivate, type ExecutionContext, Inject, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { CLAUDE_SIGN_IN_REQUIRED } from "@orbit-web/contracts";
import { BEFORE_CLAUDE_SIGN_IN } from "../../common/before-claude-sign-in.js";
import { ApiError } from "../../common/errors.js";
import { ClaudeAuthService } from "./claude-auth.service.js";

@Injectable()
export class ClaudeSignInGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(ClaudeAuthService) private readonly claude: ClaudeAuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (this.reflector.getAllAndOverride<boolean>(BEFORE_CLAUDE_SIGN_IN, [context.getHandler(), context.getClass()]) === true) return true;
    const signIn = await this.claude.account();
    if (signIn.state === "connected") return true;
    throw new ApiError(401, CLAUDE_SIGN_IN_REQUIRED, `Sign in to Orbit Web with your Claude account first.${signIn.detail ? ` ${signIn.detail}` : ""}`);
  }
}
