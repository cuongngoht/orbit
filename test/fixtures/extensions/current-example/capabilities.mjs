// orbit.extension/v2 and nothing else.
//
// It imports nothing from the engine -- that is the contract, and the reason the
// contract can hold: it is handed an `ext` (the public ExtensionContextV1) and
// reaches the world only through that. If a future runtime change would require
export default [
  {
    id: "example.rows",
    apiVersion: "orbit.capability/v1", doc: "read rows out of whatever this project keeps them in",
    inputSchema: {
      query: { type: "string", esc: "sql", doc: "a read-only statement" },
      limit: { type: "integer", minimum: 1, doc: "how many rows at most" },
    },
    required: ["query"],
    tools: ["fake-probe"],
    timeoutSec: 20,
    invoke(ext, input) {
      const args = ["--query", input.query, ...(input.limit ? ["--limit", String(input.limit)] : [])];
      const answer = ext.process.run("fake-probe", args);
      if (!answer.ok) throw new Error(answer.error);
      return { rows: JSON.parse(answer.out || "[]"), asked: input.query };
    },
  },
];
