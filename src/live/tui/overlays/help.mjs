// KEYS (`?`) and the message a terminal too small to draw in gets. The keys are keys.mjs HELP, each held to a
// KEYMAP row by a test, so this list cannot promise a key the viewer does not have.
import { HELP } from "../keys.mjs";
import { dim, row, seg } from "../sections/parts.mjs";

export const helpOverlay = () => ({ title: "KEYS", lead: [row([dim("every key only changes what this viewer shows: nothing here approves, resumes, cancels or runs anything")])], rows: HELP.map(([key, says]) => row([seg(`  ${key.padEnd(8)}`, "label"), seg(says)])), selectable: false });

export const tooSmallRows = (size) => [row([seg(" ORBIT LIVE ", "brand")]), row([seg(`this terminal is ${size.columns}×${size.rows}; the viewer needs 60×12`, "warning")]), row([dim("make it larger, or press q to leave (the task keeps running)")])];
