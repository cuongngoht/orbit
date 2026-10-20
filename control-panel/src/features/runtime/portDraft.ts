// How a sandbox tells a component its port, as the Settings card holds it: every field a string or a
// switch, so a person can type freely, turned into exactly the override the engine reads -- or into no
// `port` at all. The engine judges what is saved (a refused override comes back in its own words); the
// hints here only say early what it would refuse.
import type { ComponentSetting, PortBinding } from "./runtime.types";

export type PortKind = "" | "argv" | "env";

export interface PortDraft {
  kind: PortKind;
  /** The argument flag, e.g. `--port`. */
  flag: string;
  /** Put `--` before the flag: what `npm run <script>` needs to hand an argument to the script. */
  dashes: boolean;
  /** The environment variable's name, e.g. `PORT`. */
  name: string;
  /** What the component is told, `{port}` once. Empty is `{port}`. */
  format: string;
}

export const PORT_FORMAT = "{port}";

export const NO_PORT: PortDraft = { kind: "", flag: "", dashes: false, name: "", format: PORT_FORMAT };

export const PORT_KINDS: readonly PortKind[] = ["", "argv", "env"];

export const PORT_KIND_SAY: Record<PortKind, string> = { "": "not told (keeps its own)", argv: "an argument", env: "an environment variable" };

export const isPortKind = (v: string): v is PortKind => PORT_KINDS.some((k) => k === v);

/** The usual flag and variable a newly chosen kind starts with: a VALUE, not a placeholder, so a draft never
 * goes out with an empty flag that only looked filled in. Anything a person already typed stays. */
export const PORT_FLAG = "--port";
export const PORT_NAME = "PORT";

export const withKind = (d: PortDraft, kind: PortKind): PortDraft => ({ ...d, kind, flag: kind === "argv" && d.flag.trim() === "" ? PORT_FLAG : d.flag, name: kind === "env" && d.name.trim() === "" ? PORT_NAME : d.name });

const draftOfBinding = (b: PortBinding): PortDraft => (b.kind === "argv" ? { ...NO_PORT, kind: "argv", flag: b.flag, dashes: b.after === "--", format: b.format } : { ...NO_PORT, kind: "env", name: b.name, format: b.format });

export const portDraftOf = (port: ComponentSetting["port"]): PortDraft => (port?.override ? draftOfBinding(port.override) : NO_PORT);

const formatOf = (d: PortDraft): string => (d.format === "" ? PORT_FORMAT : d.format);

const bindingOf = (d: PortDraft): PortBinding | null => {
  if (d.kind === "argv") return { kind: "argv", flag: d.flag.trim(), format: formatOf(d), ...(d.dashes ? { after: "--" } : {}) };
  if (d.kind === "env") return { kind: "env", name: d.name.trim(), format: formatOf(d) };
  return null;
};

/** The component's `port` setting, or undefined: "not told" removes it. */
export function portOf(d: PortDraft): ComponentSetting["port"] | undefined {
  const override = bindingOf(d);
  return override ? { override } : undefined;
}

const FLAG = /^--?[A-Za-z][A-Za-z0-9-]*$/;
const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

// Advice only: the save is never blocked here, and the engine's word is the one that counts.
const HINTS: { when: (d: PortDraft) => boolean; say: string }[] = [
  { when: (d) => d.kind === "argv" && !FLAG.test(d.flag.trim()), say: "A flag starts with - or --, e.g. --port." },
  { when: (d) => d.kind === "env" && !NAME.test(d.name.trim()), say: "A variable name is letters, digits and _, e.g. PORT." },
  { when: (d) => d.kind !== "" && formatOf(d).split(PORT_FORMAT).length !== 2, say: "The format holds {port} once." },
];

export const portHintsOf = (d: PortDraft): string[] => HINTS.filter((h) => h.when(d)).map((h) => h.say);
