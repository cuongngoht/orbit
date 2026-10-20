// What control-server answers for the projects Orbit knows on this machine
// (control-server/src/projects/, from src/store/registry.mjs). A checkout is KNOWN because Orbit
// was used from it; the summary is the line its last command left, as of `lastSeen` -- the truth
// about a checkout is its own Runtime page.

export interface CheckoutSummary {
  /** NOT_DISCOVERED · CURRENT · STALE · PARTIAL · UNKNOWN, as of the last command. */
  understanding: string;
  /** RUNNING · PARTIAL · STOPPED · BLOCKED · UNRESOLVED · UNKNOWN · EMPTY · NOT_DISCOVERED. */
  runtime: string;
  branch: string | null;
}

export interface Checkout {
  /** The binding's own name: the identity of this directory on this machine. */
  id: string;
  root: string;
  /** False when the directory is gone. The engine never deletes it from the registry: a person decides. */
  exists: boolean;
  host: string | null;
  lastSeen: string | null;
  summary: CheckoutSummary | null;
}

export interface Project {
  key: string;
  name: string;
  checkouts: Checkout[];
}

export interface ProjectList {
  projects: Project[];
}

/** What forgetting a checkout answers: the project and the checkout, as they were listed. */
export interface Forgotten {
  project: Project;
  checkout: Checkout;
}

/** Which checkout a person asked to forget, by both identities. */
export interface ForgetTarget {
  key: string;
  checkout: string;
}
