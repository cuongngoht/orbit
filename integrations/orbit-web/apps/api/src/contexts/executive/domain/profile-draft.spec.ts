import assert from "node:assert/strict";
import { test } from "node:test";
import { profileBlocks, readProfileDraft } from "./profile-draft.js";
import { readAnswer } from "./proposal.js";

const block = (v: unknown): string => `Here is a draft.\n\n\`\`\`orbit-profile\n${JSON.stringify(v)}\n\`\`\``;
const DRAFT = { title: "Chuyên viên tuyển dụng", duties: "Tìm ứng viên.", instructions: "Đọc mô tả công việc trước.", skills: ["phỏng vấn"], languages: ["vi", "en"], handoffStandard: "Danh sách ứng viên kèm đánh giá." };

test("a profile draft: the last block counts, taken out of the words shown, and read as a profile's own fields", () => {
  const two = `${block({ ...DRAFT, title: "First" })}\n\n${block(DRAFT)}`;
  const read = profileBlocks(two);
  assert.deepEqual(readProfileDraft(read.last), { draft: DRAFT, problems: [] });
  const said = readAnswer(two);
  assert.ok(!said.text.includes("orbit-profile"));
  assert.equal(said.profile, read.last);
  assert.equal(said.staffing, null);
  assert.deepEqual(readProfileDraft(profileBlocks(block({ title: "Analyst" })).last)?.draft, { title: "Analyst", duties: "", instructions: "", skills: [], languages: [], handoffStandard: "" }, "what is left out is empty");
});

test("a draft is held to a profile's bounds and fields: never a model, resources or a permission", () => {
  assert.match(readProfileDraft(null).problems[0] ?? "", /held no profile/);
  assert.match(readProfileDraft("{not json").problems[0] ?? "", /The draft: the draft must be/);
  for (const field of ["execution", "model", "resources", "canDelegate", "maxAssistants", "name"]) {
    const r = readProfileDraft(JSON.stringify({ ...DRAFT, [field]: "x" }));
    assert.equal(r.draft, null, field);
    assert.match(r.problems.join(" "), new RegExp(`${field} is not a field Orbit takes from a draft`));
  }
  assert.equal(readProfileDraft(JSON.stringify({ ...DRAFT, title: "x".repeat(121) })).draft, null);
  assert.equal(readProfileDraft(JSON.stringify({ ...DRAFT, skills: Array.from({ length: 21 }, (_, i) => `s${i}`) })).draft, null);
  assert.equal(readProfileDraft(JSON.stringify({ ...DRAFT, title: "" })).draft, null, "a draft names a title");
});
