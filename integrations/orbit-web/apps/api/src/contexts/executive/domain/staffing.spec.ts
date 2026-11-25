import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { readAnswer } from "./proposal.js";
import { readStaffing, staffingBlocks, type StaffingFacts } from "./staffing.js";

const R = "d1000000-0000-4000-8000-000000000001";
const FX = "d1000000-0000-4000-8000-000000000002";
const company: StaffingFacts = {
  departmentId: null,
  departments: [
    { id: R, name: "Research", manager: "Minh" },
    { id: FX, name: "Phòng FX", manager: null },
  ],
  maxHires: 10,
};
const hire = (name: string, department: string, role: "member" | "manager" = "member") => ({ name, department, role, title: `${name}'s title`, duties: "Duties.", instructions: "How.", skills: ["a"], languages: ["vi"] });
const block = (plan: unknown): string => `Here is my plan.\n\n\`\`\`orbit-staffing\n${JSON.stringify(plan)}\n\`\`\``;
const raw = (plan: unknown): string | null => staffingBlocks(block(plan)).last;

describe("a staffing plan, held to the request and the company as it is", () => {
  test("the last block counts, and every block is taken out of the words shown", () => {
    const two = `${block({ hires: [hire("A", "Research")] })}\n\nSorry, this one:\n\n${block({ hires: [hire("B", "Research")] })}`;
    const read = staffingBlocks(two);
    assert.equal(JSON.parse(read.last as string).hires[0].name, "B");
    assert.equal(read.text, "Here is my plan.\n\nSorry, this one:\n\nHere is my plan.");
    const said = readAnswer(two);
    assert.ok(!said.text.includes("orbit-staffing"), "never shown as text");
    assert.equal(said.staffing, read.last);
    assert.equal(readAnswer("Just an answer.").staffing, null);
  });

  test("a department made with its manager, members into departments that exist -- resolved to what Orbit makes", () => {
    const r = readStaffing(raw({ departments: [{ name: "Phòng Nhân sự" }], hires: [hire("Lan", "phòng nhân sự", "manager"), hire("Hoa", "Phòng Nhân sự"), hire("Binh", "phòng fx"), hire("Tú", "Phòng FX", "manager")] }), company);
    assert.deepEqual(r.problems, []);
    assert.deepEqual(r.departments, ["Phòng Nhân sự"]);
    assert.deepEqual(r.hires.map((h) => [h.name, h.department, h.departmentId, h.newDepartment, h.role]), [
      ["Lan", "Phòng Nhân sự", null, "Phòng Nhân sự", "manager"],
      ["Hoa", "Phòng Nhân sự", null, "Phòng Nhân sự", "member"],
      ["Binh", "Phòng FX", FX, null, "member"],
      ["Tú", "Phòng FX", FX, null, "manager"],
    ]);
  });

  test("no block, a block that is not JSON, or a field no plan has: refused, saying why", () => {
    assert.match(readStaffing(null, company).problems[0] ?? "", /held no staffing plan/);
    assert.match(readStaffing(staffingBlocks("```orbit-staffing\n{not json\n```").last, company).problems[0] ?? "", /The plan: the plan must be/);
    const forbidden = readStaffing(raw({ hires: [{ ...hire("A", "Research"), model: "x" }] }), company);
    assert.equal(forbidden.plan, null);
    assert.match(forbidden.problems.join(" "), /hires\[0\]\.model is not a field Orbit takes from a plan/);
  });

  test("every rule broken is listed, and nothing of the plan is taken", () => {
    const r = readStaffing(
      raw({
        departments: [{ name: "Research" }, { name: "Legal" }, { name: "legal" }],
        hires: [hire("A", "Nowhere"), hire("B", "Research", "manager"), hire("C", "Phòng FX", "manager"), hire("D", "Phòng FX", "manager"), hire("b", "Research")],
      }),
      { ...company, maxHires: 4 },
    );
    assert.deepEqual(r.hires, []);
    assert.deepEqual(r.departments, []);
    const all = r.problems.join("\n");
    assert.match(all, /"Research" is a department already/);
    assert.match(all, /makes "legal" twice/);
    assert.match(all, /hires 5; this request may hire at most 4/);
    assert.match(all, /"Nowhere" is neither a department of the company nor one the plan makes/);
    assert.match(all, /hires "b" twice/);
    assert.match(all, /Research has a manager in office \(Minh\)/);
    assert.match(all, /Phòng FX gets one manager, not 2 \(C, D\)/);
    assert.match(all, /"Legal" gets 0/, "a department made with no manager");
  });

  test("a request for one department: every hire goes into it, and no department is made", () => {
    const one = { ...company, departmentId: FX };
    assert.deepEqual(readStaffing(raw({ hires: [hire("A", "Phòng FX"), hire("B", "phòng fx")] }), one).problems, []);
    const r = readStaffing(raw({ departments: [{ name: "Ops" }], hires: [hire("A", "Research"), hire("B", "Ops", "manager")] }), one);
    assert.match(r.problems.join("\n"), /This request is for Phòng FX: the plan makes no department \("Ops"\)/);
    assert.match(r.problems.join("\n"), /This request is for Phòng FX: A cannot go to "Research"/);
    assert.match(readStaffing(raw({ hires: [hire("A", "Phòng FX")] }), { ...company, departmentId: "d1000000-0000-4000-8000-000000000009" }).problems[0] ?? "", /no longer live/);
  });
});
