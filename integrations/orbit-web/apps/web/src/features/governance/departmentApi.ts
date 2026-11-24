// A DEPARTMENT'S POLICY's routes (the API's department-policies.controller.ts), typed: what is in effect for its
// employees and every revision, one revision, and the lifecycle -- a draft (a document, a copy `from` a revision, or the
// one in effect), its edit against the digest read, validation against the company's delegation in effect, discarding,
// and the owner's publication against the department's revision in effect AND the company's -- and asking what a revision
// would decide. The owner's alone: the API refuses, and records, anybody else.
import type { CreateRevisionRequest, DepartmentPolicyOverview, DepartmentRevisionView, PublishDepartmentRevisionRequest, RevisionView, SimulateRequest, SimulateResult } from "@orbit-web/contracts";
import { get, send } from "../../services/api";

const id = (v: string): string => encodeURIComponent(v);
const policyOf = (departmentId: string): string => `/api/governance/departments/${id(departmentId)}/policy`;
const revisionOf = (departmentId: string, revisionId: string): string => `${policyOf(departmentId)}/revisions/${id(revisionId)}`;

export const departmentPolicy = {
  overview: (departmentId: string) => get<DepartmentPolicyOverview>(policyOf(departmentId)),
  revision: (departmentId: string, revisionId: string) => get<DepartmentRevisionView>(revisionOf(departmentId, revisionId)),
  draft: (departmentId: string, body: CreateRevisionRequest) => send<DepartmentRevisionView>("POST", `${policyOf(departmentId)}/revisions`, body),
  // An edit names the digest of the content it was made on: a revision that moved since is refused, never overwritten.
  save: (departmentId: string, r: RevisionView, document: unknown) => send<DepartmentRevisionView>("PUT", revisionOf(departmentId, r.id), { document, expectedDigest: r.digest }),
  validate: (departmentId: string, revisionId: string) => send<DepartmentRevisionView>("POST", `${revisionOf(departmentId, revisionId)}/validate`),
  discard: (departmentId: string, r: RevisionView) => send<DepartmentRevisionView>("POST", `${revisionOf(departmentId, r.id)}/discard`, { digest: r.digest }),
  publish: (departmentId: string, revisionId: string, body: PublishDepartmentRevisionRequest) => send<DepartmentRevisionView>("POST", `${revisionOf(departmentId, revisionId)}/publish`, body),
  // Asked as one of the department's employees, of a revision (the one in effect when none is named): nothing recorded.
  simulate: (departmentId: string, body: SimulateRequest) => send<SimulateResult>("POST", `${policyOf(departmentId)}/simulate`, body),
};
