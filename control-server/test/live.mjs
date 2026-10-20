// A Server-Sent Events client for tests: open a stream, read frames as they arrive, and stop when the test has
// seen what it waits for (or the server ends the response) -- then let go of the socket. A refusal before the
// headers is an ordinary JSON answer, and comes back as one.
import { request } from "node:http";

// One block of an event stream: event, id, data (parsed), retry. A block with only a comment is not a frame.
export function parseFrames(text) {
  const blocks = text.split("\n\n");
  const rest = blocks.pop();
  return { frames: blocks.map(blockOf).filter((f) => f !== null), rest };
}

function blockOf(block) {
  const fields = Object.fromEntries(block.split("\n").filter((l) => !l.startsWith(":") && l.includes(":")).map((l) => [l.slice(0, l.indexOf(":")), l.slice(l.indexOf(":") + 1).trimStart()]));
  if (!("event" in fields) && !("data" in fields) && !("retry" in fields)) return null;
  return { event: fields.event ?? "message", id: fields.id, data: fields.data === undefined ? undefined : JSON.parse(fields.data), retry: fields.retry };
}

// -> { status, type, frames, ended, json }. `until(frames)` decides when the test has seen enough.
export function stream(port, path, { until = () => false, headers = {}, timeoutMs = 4000 } = {}) {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, method: "GET", path, headers: { host: `127.0.0.1:${port}`, ...headers } }, (res) => {
      const state = { text: "", frames: [], ended: false };
      const done = () => { clearTimeout(timer); req.destroy(); resolve({ status: res.statusCode, type: res.headers["content-type"], cache: res.headers["cache-control"], frames: state.frames, ended: state.ended, json: res.headers["content-type"]?.startsWith("application/json") ? JSON.parse(state.text || "null") : null }); };
      const timer = setTimeout(done, timeoutMs);
      res.on("data", (chunk) => {
        state.text += chunk.toString("utf8");
        if (!res.headers["content-type"]?.startsWith("text/event-stream")) return;
        const parsed = parseFrames(state.text);
        state.frames.push(...parsed.frames);
        state.text = parsed.rest;
        if (until(state.frames)) done();
      });
      res.on("end", () => { state.ended = true; done(); });
    });
    req.on("error", (e) => (e.code === "ECONNRESET" ? null : reject(e)));
    req.end();
  });
}

export const kinds = (frames, event = "task-event") => frames.filter((f) => f.event === event).map((f) => f.data.kind);

export const waitFor = async (check, timeoutMs = 2000) => {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error("waited too long");
    await new Promise((r) => setTimeout(r, 10));
  }
};
