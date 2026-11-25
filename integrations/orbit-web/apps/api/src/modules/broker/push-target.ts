// WHICH BRANCH A CHAT MAY PUSH TO, decided here alone. Never the repository's default branch, never a branch the source
// protects, and nothing at all when the default cannot be established (neither the source's listing nor the remote's
// own HEAD names one). Names compare as the more lenient source does: Azure DevOps ignores case.
//
// The branch the chat started from is neither an exception nor a refusal. When it is a working branch -- a story
// branch somebody works on, not the default and not protected -- the chat pushes to it like any other branch: a person
// approves the exact commit first, and a push that is not a fast-forward of the remote's branch is refused by git, so
// nobody's work there is overwritten. The default branch is reached by a pull request, as every chat's work reaches it.
import { HttpStatus } from "@nestjs/common";
import { ApiError, conflict } from "../../common/errors.js";

export interface ListedBranch {
  name: string;
  protected: boolean;
}

export function pushRefusal(branch: string, defaults: readonly string[], listed: readonly ListedBranch[]): ApiError | null {
  const same = (name: string): boolean => name.toLowerCase() === branch.toLowerCase();
  if (defaults.length === 0) return new ApiError(HttpStatus.BAD_GATEWAY, "default_unknown", "The repository's default branch could not be established (neither its listing nor its own HEAD names one), so nothing is pushed.");
  if (defaults.some(same)) return conflict("default_branch", `${branch} is the repository's default branch: a chat never pushes to it directly; its work reaches it by a pull request.`);
  if (listed.some((b) => b.protected && same(b.name))) return conflict("protected_branch", `${branch} is a protected branch of the repository: a chat never pushes to it directly.`);
  return null;
}
