// The fictional capability a fictional observation needs. It imports nothing
// from the engine and answers a fixed value: the acceptance test proves who
// PROVIDES it, not what it returns.
export default [
  {
    id: "company.capability.delta", apiVersion: "orbit.capability/v1",
    doc: "asks the fictional system whether its record exists",
    invoke: () => ({ exists: true }),
  },
];
