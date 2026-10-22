// What the engine's own actions share: who carries them (the engine), the profile it acts under (ORCHESTRATOR), and
// how a refusal found before anything runs is said.
import { clip } from "../../store/text.mjs";

export const ENGINE = () => "engine";

export const ORCHESTRATOR = () => "ORCHESTRATOR";

export const finding = (rule, say, extra = {}) => ({ rule, say: clip(say, 1000), ...extra });

export const unitIn = (lw, id) => (id ? lw.m.units.get(id) ?? null : null);

export const stateIn = (lw, id) => lw.states().get(id) ?? null;
