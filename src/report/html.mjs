// The report itself: one self-contained HTML file, no stylesheet to fetch, no
// script to install, no sibling directory to keep with it -- openable from a
// network share, or out of a mail attachment, by somebody who has never heard of
// this engine.
//
// The markup is report.html and the theme is report.css: two files a person can
// open in a browser, edit and preview. This module only puts them together with
// the data view.mjs shaped. All three used to be one 285-line file of string
// literals, which meant changing a colour required reading JavaScript, and
// every one of the fifty-seven interpolations had to remember to escape itself.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { render } from "./template.mjs";
import { view } from "./view.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (name) => readFileSync(join(HERE, name), "utf8");

export const page = (m, publication = {}) => render(read("report.html"), { ...view(m, read("report.css")), ...publication, script: read("interactions.mjs") });
export { esc } from "./template.mjs";
