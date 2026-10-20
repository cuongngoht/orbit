// A fictional company's vocabulary, as an extension teaches it. It imports
// nothing from the engine: relation rows are data, and the interpreter is a
// pure function over the frozen claims it is handed.
export default {
  relations: [
    { id: "company.relation.gamma", role: "consequence", doc: "when the operation runs, the system's record comes to exist" },
    { id: "company.relation.via", role: "implementation", cardinality: "one", doc: "how this company builds it, in a context" },
    { id: "company.relation.witness", role: "observation", doc: "where this company can see that it happened" },
    { id: "company.relation.needs", role: "capability", doc: "which capability that sighting needs" },
  ],
  interpreters: [
    {
      id: "company-knowledge.unseen",
      doc: "understands a relation no vocabulary gives a role",
      understands: ["relation-never-seen-before"],
      interpret: ({ claims }) => ({ needs: [], notes: claims.map((c) => `${c.subject} is linked to ${c.object} in a way only this company understands`) }),
    },
  ],
};
