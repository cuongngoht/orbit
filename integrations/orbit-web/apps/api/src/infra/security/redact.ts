// Masking by SHAPE. Text a process printed (a CLI's sign-in output, Claude Code's stream, a tool's output) passes
// through here before it is stored, logged or sent to the browser, so a credential that ends up in it -- a token a
// command echoed, a key in a file the model read -- is not carried further. The patterns are shapes a credential has,
// never names of a product's accounts.
const TOKEN_SHAPES: { re: RegExp; as: string }[] = [
  // GitHub tokens: classic and OAuth (gho_, ghp_, ghu_, ghs_, ghr_) and fine-grained personal access tokens.
  { re: /\bgh[pousr]_[A-Za-z0-9]{30,255}\b/g, as: "[redacted-github-token]" },
  { re: /\bgithub_pat_[A-Za-z0-9_]{22,255}\b/g, as: "[redacted-github-token]" },
  // Anthropic API keys and OAuth tokens (sk-ant-api03-…, sk-ant-oat01-…).
  { re: /\bsk-ant-[A-Za-z0-9_-]{16,}/g, as: "[redacted-anthropic-key]" },
  // A JSON Web Token.
  { re: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*/g, as: "[redacted-jwt]" },
  // Cloud access key ids.
  { re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, as: "[redacted-access-key]" },
  // A PEM private key, whole.
  { re: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z0-9 ]*PRIVATE KEY-----|$)/g, as: "[redacted-private-key]" },
  // HTTP authorization values.
  { re: /\b(Bearer|token)\s+(?!\[redacted)[A-Za-z0-9._~+/=-]{16,}/g, as: "$1 [redacted]" },
  { re: /\bBasic\s+[A-Za-z0-9+/]{12,}={0,2}/g, as: "Basic [redacted]" },
  // Credentials inside a URL: https://user:secret@host
  { re: /\b(https?:\/\/)[^\s/@:]+:[^\s/@]+@/g, as: "$1[redacted]@" },
];

// An environment assignment of a secret-named variable (`GH_TOKEN=…`, `ANTHROPIC_API_KEY: …`), or of headers handed to a
// client (`…_HEADERS=…`, which carry a credential in whatever scheme), the likeliest way a credential reaches a shell's
// output.
const ASSIGNMENT = /\b([A-Z][A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|PASSWD|API_?KEY|ACCESS_KEY|PRIVATE_KEY|CREDENTIALS?|HEADERS))(\s*[:=]\s*)(?!\[redacted)("[^"\n]*"|'[^'\n]*'|[^\s"',;}]+)/g;

// For code shown as code (a diff): only what is unmistakably a credential, so the file reads as it is.
export function redactShapes(text: string): string {
  return TOKEN_SHAPES.reduce((s, p) => s.replace(p.re, p.as), text);
}

// For everything a process printed.
export function redactSecrets(text: string): string {
  return redactShapes(text).replace(ASSIGNMENT, "$1$2[redacted]");
}

// Cuts text to a bound (in UTF-16 code units), saying whether it was cut.
export function bounded(text: string, max: number): { text: string; truncated: boolean } {
  return text.length <= max ? { text, truncated: false } : { text: text.slice(0, max), truncated: true };
}

// The last lines of a process's output, redacted and bounded: what an error message may quote.
export function tail(text: string, lines = 8, max = 2_000): string {
  const kept = redactSecrets(text).trimEnd().split("\n").slice(-lines).join("\n");
  return kept.length > max ? kept.slice(kept.length - max) : kept;
}
