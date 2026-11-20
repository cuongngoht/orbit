// Text and Markdown. The encoding is the file's own (a byte order mark), else UTF-8, else Windows-1252 -- the one a
// text file that is not UTF-8 most likely is. Markdown keeps its headings (they name the sections of what follows) and
// its fenced code whole.
import { normalize, paragraphs, type Block, type Extracted } from "../blocks.js";

export function decodeText(bytes: Buffer): string {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return new TextDecoder("utf-8").decode(bytes.subarray(3));
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes.subarray(2));
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(bytes.subarray(2));
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

export function textOf(bytes: Buffer): Extracted {
  return { blocks: paragraphs(decodeText(bytes)), pages: null, title: null };
}

const HEADING = /^(#{1,6})\s+(.+?)\s*#*\s*$/;
const FENCE = /^(```|~~~)/;

export function markdownOf(bytes: Buffer): Extracted {
  const blocks: Block[] = [];
  let buffer: string[] = [];
  let fence: string | null = null;
  const flush = () => {
    blocks.push(...paragraphs(buffer.join("\n")));
    buffer = [];
  };
  for (const line of normalize(decodeText(bytes)).split("\n")) {
    if (fence !== null) {
      buffer.push(line);
      if (line.startsWith(fence)) {
        blocks.push({ text: buffer.join("\n"), page: null, heading: null });
        buffer = [];
        fence = null;
      }
      continue;
    }
    const opens = FENCE.exec(line);
    const heading = HEADING.exec(line);
    if (opens !== null) {
      flush();
      fence = opens[1] as string;
      buffer.push(line);
    } else if (heading !== null) {
      flush();
      blocks.push({ text: (heading[2] as string).trim(), page: null, heading: (heading[1] as string).length });
    } else buffer.push(line);
  }
  if (fence !== null) blocks.push({ text: buffer.join("\n"), page: null, heading: null });
  else flush();
  const first = blocks.find((b) => b.heading !== null);
  return { blocks, pages: null, title: first?.text ?? null };
}
