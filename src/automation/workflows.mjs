// Which WORKFLOW an objective gets, as an ordered table over facts -- never a model's guess, and never one
// fixed sequence for every request. The first row that matches decides; the last always does, and says
// there is nothing to coordinate (orbit-help's single recommendation is then the answer).
//
// `matched` is every routing intent whose cues the objective hit, not only the strongest: "implement the
// refund rule and test it until it passes" hits development AND qa, and a change to the code is what it
// asks for. A work item named with `--ref` is a requirement to implement.
//
// A row says WHICH steps an objective gets -- step kinds, or a playbook step FOR a capability -- with the
// conditions under which a kind is left out: no requirement step without a reference to settle, no QA step
// when nothing the checkout declares can be started to investigate. What each step waits for is not a row's
// business since 1.8.6: graph.mjs draws it from DEPENDS, adds a playbook step for every capability a person or a
// host named that no kind here provides, and the draft and register steps before a playbook step whose gap the
// skill factory may close.
const ENGINEERING_INTENTS = ["autonomous-engineering", "development", "requirements"];

const PLAYBOOK_INTENTS = ["qa", "release", "documentation", "code-review", "architecture", "engineering", "reporting", "environment"];

const hasAny = (facts, ids) => ids.some((id) => facts.matched.includes(id) || facts.intent === id);

export const WORKFLOWS = [
  { id: "engineering", when: (f) => Boolean(f.ref) || hasAny(f, ENGINEERING_INTENTS), steps: (f) => [f.ref ? "requirement" : null, "context", "runtime", "engineering", f.startable.length ? "qa" : null, "regression", "review"], say: "a change to the code: the requirement, context, runtime, an engineering task, QA of the running change, regression and review" },
  { id: "investigation", when: (f) => f.intent === "investigation", steps: (f) => ["context", f.startable.length ? "runtime" : null, "qa"], say: "an investigation of the running application" },
  { id: "playbook", when: (f) => Boolean(f.playbook?.capability) && (PLAYBOOK_INTENTS.includes(f.intent) || (f.named ?? []).length > 0), steps: (f) => ["context", { kind: "playbook", for: f.playbook.capability }], say: "the workflow its capability's playbook describes" },
  { id: "none", when: () => true, steps: () => [], say: "nothing to coordinate — orbit-help names the one workflow for it" },
];

export const workflowOf = (facts) => WORKFLOWS.find((w) => w.when(facts));
