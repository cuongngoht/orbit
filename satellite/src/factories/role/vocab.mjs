// What a ROLE is: a contract for a responsibility, kept as an immutable definition (src/store/definitions.mjs). A role
// REQUESTS a permission profile; it never grants itself one, and a proposal that tries -- by naming grants, tools, an
// approval or its own name -- is refused by name.
export const ROLE_SCHEMA = 1;

export const ROLE_PROPOSAL_FIELDS = Object.freeze(["unit", "responsibilities", "purpose", "restrictions", "completionCriteria", "profile", "requiredCapabilities", "inputContract", "outputContract"]);

// Authority a role cannot give itself, and what the engine stamps: refused by name in a proposal.
export const ROLE_REFUSED = Object.freeze(["grants", "permissions", "allowedTools", "tools", "approved", "approval", "admin", "displayName", "roleId", "name", "version", "digest", "provenance"]);

export const ACTIVITY = /^[a-z]{3,24}$/;

export const SUBJECT = /^[a-z0-9][a-z0-9 -]{1,47}$/;

export const MAX_RESPONSIBILITIES = 6;
