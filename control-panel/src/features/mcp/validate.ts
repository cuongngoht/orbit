// The rules the server holds a managed definition's secrets to
// (src/mcp/managed.mjs), asked while a person types -- so a token pasted into
// the wrong box is caught in that box, before anything is sent -- and, like the
// server, never repeating what was typed back in a message.
export const HEADER_NAME = /^[A-Za-z0-9!#$%&'*+.^_`|~-]{1,128}$/;
export const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;

// A header written the way a curl command or a config file writes it --
// "Authorization", Authorization: -- still names Authorization.
export const cleanHeaderName = (text: string): string => text.trim().replace(/^(["'])(.*)\1$/, "$2").replace(/:$/, "").trim();

// A variable name a person can use as it is: the server's id and the header,
// in capitals -- TEST_AUTHORIZATION.
export function suggestedEnv(id: string, header: string): string {
  const name = `${id}_${cleanHeaderName(header) || "token"}`.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return /^[0-9]/.test(name) ? `_${name}` : name || "MCP_TOKEN";
}

// What a secret LOOKS like where a variable's name belongs: a space or quotes,
// a scheme word (Bearer, Basic), or a long run no variable name would be.
export const looksLikeSecret = (text: string): boolean => /\s|["']/.test(text.trim()) || /^(bearer|basic|token)\b/i.test(text.trim()) || (text.trim().length > 40 && !ENV_NAME.test(text.trim()));

export interface HeaderIssues {
  name?: string;
  env?: string;
  /** What is in the variable box looks like the secret itself: mask it, and offer a name instead. */
  secret: boolean;
}

export function headerIssues(row: { name: string; env: string }): HeaderIssues {
  const name = row.name.trim();
  const env = row.env.trim();
  if (!name && !env) return { secret: false };
  return { name: nameIssue(name), env: envIssue(env), secret: looksLikeSecret(env) };
}

function nameIssue(name: string): string | undefined {
  if (!name) return "Name the header, e.g. Authorization.";
  if (HEADER_NAME.test(name)) return undefined;
  const cleaned = cleanHeaderName(name);
  return HEADER_NAME.test(cleaned) ? `Without quotes or a colon: ${cleaned}` : "A header name is letters, digits and !#$%&'*+.^_`|~- — no spaces, quotes or colon.";
}

function envIssue(env: string): string | undefined {
  if (!env) return "Name the environment variable that holds the value.";
  if (looksLikeSecret(env)) return "That looks like the secret itself. Orbit never stores a value: put it in an environment variable, and write the variable's NAME here.";
  return ENV_NAME.test(env) ? undefined : "An environment variable name is letters, digits and _, not starting with a digit.";
}

// The stdio form's variable list: one name per line.
export function envListIssue(text: string): string | undefined {
  const bad = text.split(/[\n,]/).map((l) => l.trim()).filter(Boolean).findIndex((l) => !ENV_NAME.test(l));
  if (bad < 0) return undefined;
  return looksLikeSecret(text.split(/[\n,]/).map((l) => l.trim()).filter(Boolean)[bad]) ? `Line ${bad + 1} looks like a secret. Orbit never stores a value: list the variable's NAME, and set the value in the environment.` : `Line ${bad + 1} is not an environment variable name (letters, digits and _, not starting with a digit).`;
}

// A server's id, as the server holds it: letters, digits and . _ -, starting
// with a letter or digit, up to 64 -- no spaces and no accents.
export const SERVER_ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;

// An id a person can use as it is, made from what they typed or the display
// name: accents dropped (a stroked đ included), anything else becomes `-`.
export function slugOf(text: string): string {
  const plain = text.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[đĐ]/g, "d");
  return plain.toLowerCase().replace(/[^a-z0-9_.-]+/g, "-").replace(/^[^a-z0-9]+|-+$/g, "").slice(0, 64);
}

export function idIssue(id: string): string | undefined {
  if (!id.trim() || SERVER_ID.test(id.trim())) return undefined;
  return "An id is letters, digits and . _ - only — no spaces or accents — starting with a letter or digit.";
}
