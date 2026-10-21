// How a PostgreSQL conversation ended badly, as DATA: a helper maps `kind` (and the server's
// SQLSTATE) onto the orbit.helper/v1 classes without reading a message string. Nothing here is
// news about the product: a server that cannot be reached, a credential the sandbox did not set,
// a table a declaration named and the database does not hold -- each is the environment's or the
// binding's, never a defect.
export class PgError extends Error {
  constructor(kind, message, details = {}) {
    super(message);
    this.name = "PgError";
    this.kind = kind;
    Object.assign(this, details);
  }
}

export const transportError = (message, cause) => new PgError("transport", message, cause ? { cause } : {});
export const protocolError = (message) => new PgError("protocol", message);
export const timeoutError = (message) => new PgError("timeout", message);
export const closedError = (message) => new PgError("transport", message);

// SQLSTATE classes (PostgreSQL Appendix A), by their first two characters: who is to blame.
const STATES = [
  { when: (code) => code === "25006", kind: "refused", say: "the statement would write, and this connection only reads" },
  { when: (code) => /^(28|3D)/.test(code), kind: "transport", say: "the server did not accept this connection's credential or database" },
  { when: (code) => /^42/.test(code), kind: "refused", say: "the server does not hold what the binding named, as named" },
  { when: (code) => /^(57014|53|57|58|08)/.test(code), kind: "transport", say: "the server could not answer now" },
  { when: () => true, kind: "protocol", say: "the server answered with an error this client cannot place" },
];

// An ErrorResponse's fields: S severity, C code, M message. The message is the server's and is
// untrusted: it is bounded here, and scrubbed by whoever shows it.
export function serverError(fields) {
  const code = String(fields?.C ?? "");
  const row = STATES.find((r) => r.when(code));
  return new PgError(row.kind, `${row.say} (SQLSTATE ${code || "?"}: ${String(fields?.M ?? "").slice(0, 200)})`, { sqlstate: code || null });
}
