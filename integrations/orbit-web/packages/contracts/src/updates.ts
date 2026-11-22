// WHETHER A NEWER RELEASE EXISTS of what Orbit Web's image holds -- each read from its own publisher, never assumed.
// What the image holds is pinned (docker/Dockerfile): a newer release reaches it by moving the pins and building the
// image again (scripts/update-pins.mjs), with or without a new Orbit Web. A source that could not be asked is "unknown"
// with why -- never "up to date".
export const UPDATE_COMPONENTS = ["claude", "codex", "gh", "az", "node", "orbit", "agy", "git", "python"] as const;
export type UpdateComponent = (typeof UPDATE_COMPONENTS)[number];

export const UPDATE_LABELS: Record<UpdateComponent, string> = {
  claude: "Claude CLI",
  codex: "OpenAI Codex CLI",
  gh: "GitHub CLI",
  az: "Azure CLI",
  node: "Node.js",
  orbit: "Orbit plugin",
  agy: "Antigravity CLI",
  git: "Git",
  python: "Python",
};

//   up_to_date        the publisher's newest release is the one here (or older)
//   update_available  the publisher has a newer release
//   unknown           it could not be told (the publisher did not answer, or named no version; nothing installed)
//   not_checked       nothing here reads that publisher's releases (said why)
export type UpdateState = "up_to_date" | "update_available" | "unknown" | "not_checked";

export interface ComponentUpdate {
  component: UpdateComponent;
  installed: string | null;
  latest: string | null;
  state: UpdateState;
  // The publisher says a newer release fixes a security issue (true), says none does (false), or does not say (null).
  security: boolean | null;
  // Why it is unknown or not checked; null otherwise.
  detail: string | null;
}

export interface SystemUpdates {
  // When the publishers were last asked (null: not yet).
  checkedAt: string | null;
  components: ComponentUpdate[];
  // How a newer release reaches this installation, without waiting for a new Orbit Web: one command a line.
  howToUpdate: string[];
}
