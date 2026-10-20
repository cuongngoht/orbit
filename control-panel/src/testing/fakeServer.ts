// An in-memory stand-in for control-server: fetch is replaced and nothing else
// is mocked, so the client, the hooks, the router and the Fluent components
// under test are the real ones.
import { vi } from "vitest";
import type { HostAccount } from "../features/account/account.api";
import type { SkillSummary } from "../features/skills/api/skills.types";
import { fakeTrail } from "./fakeTrace";

export const skillMd = (id: string, description: string) => `---\nname: ${id}\ndescription: ${description}\nuser-invocable: true\n---\n\n# ${id}\n`;

export interface FakeSkill extends SkillSummary {
  content: string;
  revision: number;
}

export interface Call {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: unknown;
}

export function fakeSkill(id: string, over: Partial<FakeSkill> = {}): FakeSkill {
  const description = over.description ?? `The ${id} skill.`;
  const content = skillMd(id, description);
  return {
    id,
    name: id,
    description,
    userInvocable: true,
    allowedTools: ["Read", "Bash(node x)"],
    valid: true,
    problems: [],
    skillBytes: content.length,
    files: 1,
    bytes: content.length,
    modified: "2026-09-23T10:00:00.000Z",
    content,
    revision: 1,
    ...over,
  };
}

export const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** Whoever is signed in to Claude on the fake machine -- its profile, as the real server answers it. */
export const SIGNED_IN: HostAccount = { host: "claude", signedIn: true, displayName: "Test Person", email: "person@example.test", organization: "Example Org", role: "admin" };

// `extra` answers first, for the pages that are not about skills (see
// fakeResources.ts and fakeTrace.ts); a null from it falls through to the
// skills. A machine whose session trail recorded nothing yet is the default.
export function fakeServer(seed: FakeSkill[] = [fakeSkill("alpha"), fakeSkill("beta")], extra?: (call: Call) => Response | null) {
  const skills = new Map(seed.map((s) => [s.id, s]));
  const calls: Call[] = [];
  const state = { rejectNextSave: false };
  const summary = ({ content: _c, revision: _r, ...s }: FakeSkill): SkillSummary => s;
  const detail = (s: FakeSkill) => ({ ...summary(s), content: s.content, revision: `rev-${s.revision}` });
  const save = (call: Call, skill: FakeSkill) => {
    if (state.rejectNextSave) {
      state.rejectNextSave = false;
      return reply(400, { error: { code: "INVALID_SKILL", message: `${skill.id} was not saved`, details: ["the frontmatter has no description"] } });
    }
    const content = (call.body as { content: string }).content;
    skills.set(skill.id, { ...skill, content, description: "Edited.", revision: skill.revision + 1 });
    return reply(200, detail(skills.get(skill.id)!));
  };
  const emptyTrail = fakeTrail();
  const handle = (call: Call): Response => {
    const answered = extra?.(call) ?? emptyTrail(call);
    if (answered) return answered;
    if (call.path === "/api/v1/health") return reply(200, { status: "ok", node: "24.15.0", engine: "9.9.9", skills: skills.size });
    if (call.path === "/api/v1/account") return reply(200, SIGNED_IN);
    if (call.path === "/api/v1/skills") return reply(200, { skills: [...skills.values()].map(summary) });
    const id = decodeURIComponent(call.path.split("/")[4] ?? "");
    const skill = skills.get(id);
    if (!skill) return reply(404, { error: { code: "SKILL_NOT_FOUND", message: `no skill named ${id}` } });
    if (call.method === "GET") return reply(200, detail(skill));
    if (call.method === "PUT") return save(call, skill);
    skills.delete(id);
    return reply(200, { id, deleted: true, backup: `2026-09-23T10-15-30-123Z/${id}` });
  };
  const fetch = vi.fn(async (path: string, init?: RequestInit) => {
    const call = { method: init?.method ?? "GET", path, headers: (init?.headers ?? {}) as Record<string, string>, body: init?.body ? JSON.parse(String(init.body)) : undefined };
    calls.push(call);
    return handle(call);
  });
  return { fetch, calls, state, skills };
}
