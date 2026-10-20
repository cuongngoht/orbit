// A LEAF: text a terminal may be handed.
//
// What a checkout says -- a manifest's version range, a project's name, a script's name -- reaches a
// person's terminal inside a sentence Orbit prints, and a terminal OBEYS what it is given: an escape
// sequence can clear the screen, rewrite what was already printed, set the window title or, in some
// emulators, put text on the clipboard. So text that came from a file is made printable before it is
// shown: control characters are removed (a line feed and a tab are kept, a carriage return -- which
// could overwrite the line it follows -- is not), and so are the invisible characters that reorder
// the text around them. What is left is what a person would have read.
const CONTROL = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/g;
const REORDERING = /[‎‏‪-‮⁦-⁩]/g;

export const printable = (text) => String(text ?? "").replace(CONTROL, "").replace(REORDERING, "");
