// A web page's READABLE text, through parse5 (the HTML standard's own parsing): the main content -- <main>, or the
// largest <article>, else the body -- without what is not prose (scripts, styles, navigation, forms, embedded media).
// Nothing in the page runs: it is parsed into a tree and read. Headings keep their level; the <title> names it.
import { parse } from "parse5";
import { normalize, type Block, type Extracted } from "../blocks.js";

interface Node {
  nodeName: string;
  tagName?: string;
  value?: string;
  childNodes?: Node[];
  content?: Node;
}

const SKIPPED = new Set(["script", "style", "noscript", "template", "svg", "math", "iframe", "object", "embed", "canvas", "video", "audio", "picture", "nav", "footer", "aside", "form", "button", "select", "input", "textarea", "dialog", "head"]);
const BLOCKS = new Set(["p", "div", "section", "article", "main", "header", "li", "ul", "ol", "pre", "blockquote", "table", "tr", "td", "th", "dt", "dd", "dl", "figcaption", "figure", "address", "details", "summary", "hr"]);
const HEADINGS: Record<string, number> = { h1: 1, h2: 2, h3: 3, h4: 4, h5: 5, h6: 6 };

const children = (n: Node): Node[] => n.childNodes ?? [];

function find(n: Node, tag: string): Node[] {
  const out: Node[] = [];
  const walk = (x: Node) => {
    if (x.tagName === tag) out.push(x);
    for (const c of children(x)) walk(c);
  };
  walk(n);
  return out;
}

const textLength = (n: Node): number => (n.nodeName === "#text" ? (n.value ?? "").length : children(n).reduce((sum, c) => sum + textLength(c), 0));

function blocksOf(root: Node): Block[] {
  const blocks: Block[] = [];
  let line = "";
  const flush = (heading: number | null = null) => {
    const text = normalize(line);
    if (text.length > 0) blocks.push({ text, page: null, heading });
    line = "";
  };
  const walk = (n: Node) => {
    const tag = n.tagName ?? "";
    if (SKIPPED.has(tag)) return;
    if (n.nodeName === "#text") {
      line += (n.value ?? "").replace(/\s+/g, " ");
      return;
    }
    if (tag === "br") {
      line += "\n";
      return;
    }
    const level = HEADINGS[tag];
    if (level !== undefined) {
      flush();
      for (const c of children(n)) walk(c);
      flush(level);
      return;
    }
    const block = BLOCKS.has(tag);
    if (block) flush();
    if (tag === "pre") {
      line += collectRaw(n);
      flush();
      return;
    }
    for (const c of children(n)) walk(c);
    if (block) flush();
  };
  walk(root);
  flush();
  return blocks;
}

// A <pre>'s text as written: its line breaks and spacing are its meaning.
const collectRaw = (n: Node): string => (n.nodeName === "#text" ? (n.value ?? "") : children(n).map(collectRaw).join(""));

export function htmlOf(html: string): Extracted {
  const document = parse(html) as unknown as Node;
  const title = normalize(find(document, "title").map(collectRaw).join(" ")) || null;
  const main = find(document, "main")[0];
  const articles = find(document, "article").sort((a, b) => textLength(b) - textLength(a));
  const root = main ?? articles[0] ?? find(document, "body")[0] ?? document;
  const blocks = blocksOf(root);
  return { blocks, pages: null, title: title ?? blocks.find((b) => b.heading !== null)?.text ?? null };
}
