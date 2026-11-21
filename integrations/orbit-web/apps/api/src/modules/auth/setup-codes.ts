// A ONE-TIME SETUP CODE: 120 random bits as 24 characters of Crockford's base32 in groups of four (XXXX-XXXX-…), printed
// once in a terminal of the server (cli/governance.ts) and kept only as its hash. A person types it back; it is compared
// without its dashes, spaces and case.
import { randomBytes } from "node:crypto";
import { normalizeSetupCode } from "@orbit-web/contracts";
import { sha256 } from "../../infra/accounts/stores.js";

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export const setupCodeHash = (code: string): string => sha256(`orbit-web/setup-code/${normalizeSetupCode(code)}`);

export function newSetupCode(): { code: string; hash: string } {
  const chars = [...randomBytes(24)].map((b) => ALPHABET[b % 32] as string).join("");
  return { code: (chars.match(/.{4}/g) as string[]).join("-"), hash: setupCodeHash(chars) };
}
