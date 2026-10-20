import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../shared/api/client";
import { projectKeys } from "../projects/projects.api";
import type { SandboxList, SavedTrust, TrustBody } from "./sandbox.types";
import type { AdoptResult, CheckResult, CheckoutRef, Connectivity, DiscoverResult, DoctorResult, Observations, PrepareResult, Proposal, Provider, RuntimeSettings, RuntimeStatus, SavedSettings, SettingsBlock, StartResult, StopResult, ValidateResult } from "./runtime.types";

// Both identities are in every address: a page is about the checkout its path names, and nothing in
// a body can name another.
const base = (ref: CheckoutRef) => `/api/v1/projects/${encodeURIComponent(ref.key)}/checkouts/${encodeURIComponent(ref.checkout)}/runtime`;

export interface StartBody {
  component?: string;
  wait?: number;
}

export interface StopBody {
  component?: string;
  session?: string;
  environment?: boolean;
}

/** A check chooses a LOCATION and nothing else: the host and port are the setting's, read by the server. */
export interface ReachBody {
  provider?: Provider;
}

export interface ReachAsk {
  id: string;
  body: ReachBody;
}

// A POST always carries a JSON body, even an empty one: the server reads it as JSON.
export const runtimeApi = {
  status: (ref: CheckoutRef) => api.get<RuntimeStatus>(base(ref)),
  settings: (ref: CheckoutRef) => api.get<RuntimeSettings>(`${base(ref)}/settings`),
  proposal: (ref: CheckoutRef, id: string) => api.get<Proposal>(`${base(ref)}/proposals/${encodeURIComponent(id)}`),
  discover: (ref: CheckoutRef, body: { dry?: boolean; rescan?: boolean }) => api.post<DiscoverResult>(`${base(ref)}/discover`, body),
  design: (ref: CheckoutRef) => api.post<Proposal>(`${base(ref)}/design`, {}),
  adopt: (ref: CheckoutRef, id: string) => api.post<AdoptResult>(`${base(ref)}/proposals/${encodeURIComponent(id)}/adopt`, { human: true }),
  doctor: (ref: CheckoutRef) => api.post<DoctorResult>(`${base(ref)}/doctor`, {}),
  // A plan only: acting on it is validate's, which is a person's.
  prepare: (ref: CheckoutRef) => api.post<PrepareResult>(`${base(ref)}/prepare`, {}),
  // Bringing an environment up builds it on this machine, where its definition may run commands of
  // its own: relayed as a person's, from the confirmation they pressed.
  validate: (ref: CheckoutRef) => api.post<ValidateResult>(`${base(ref)}/validate`, { human: true }),
  start: (ref: CheckoutRef, body: StartBody) => api.post<StartResult>(`${base(ref)}/start`, body),
  stop: (ref: CheckoutRef, body: StopBody) => api.post<StopResult>(`${base(ref)}/stop`, body),
  saveSettings: (ref: CheckoutRef, settings: SettingsBlock, revision: string | null) => api.put<SavedSettings>(`${base(ref)}/settings`, { settings, revision }),
  // What each reach target last answered: a read of what is kept, which opens no connection.
  connectivity: (ref: CheckoutRef) => api.get<Connectivity>(`${base(ref)}/connectivity`),
  // One attempt, or the saved retry policy -- run by the server, never looped here.
  checkReach: (ref: CheckoutRef, id: string, body: ReachBody) => api.post<CheckResult>(`${base(ref)}/connectivity/${encodeURIComponent(id)}/check`, body),
  retryReach: (ref: CheckoutRef, id: string, body: ReachBody) => api.post<CheckResult>(`${base(ref)}/connectivity/${encodeURIComponent(id)}/retry`, body),
  // Every sandbox a checkout's tasks own: a read of what the runtime keeps, which starts nothing.
  sandboxes: (ref: CheckoutRef) => api.get<SandboxList>(`${base(ref)}/sandboxes`),
  // A person's standing word that one restore plan or one container definition -- named by the
  // fingerprint they read -- may run in a sandbox, and the taking back of it. Control's alone.
  trust: (ref: CheckoutRef, body: TrustBody) => api.post<SavedTrust>(`${base(ref)}/sandbox/trust`, body),
  revoke: (ref: CheckoutRef, body: TrustBody) => api.post<SavedTrust>(`${base(ref)}/sandbox/revoke`, body),
};

export const runtimeKeys = {
  all: (ref: CheckoutRef) => ["runtime", ref.key, ref.checkout] as const,
  status: (ref: CheckoutRef) => [...runtimeKeys.all(ref), "status"] as const,
  proposal: (ref: CheckoutRef, id: string) => [...runtimeKeys.all(ref), "proposal", id] as const,
  connectivity: (ref: CheckoutRef) => [...runtimeKeys.all(ref), "connectivity"] as const,
  sandboxes: (ref: CheckoutRef) => [...runtimeKeys.all(ref), "sandboxes"] as const,
};

export const useSandboxes = (ref: CheckoutRef) => useQuery({ queryKey: runtimeKeys.sandboxes(ref), queryFn: () => runtimeApi.sandboxes(ref) });

export const useConnectivity = (ref: CheckoutRef) => useQuery({ queryKey: runtimeKeys.connectivity(ref), queryFn: () => runtimeApi.connectivity(ref) });

const withResults = (c: Connectivity, id: string, results: Observations): Connectivity => ({ ...c, targets: c.targets.map((t) => (t.id === id ? { ...t, observations: { ...t.observations, ...results } } : t)) });

// One click is one request: the attempts, the waits and when to stop are the engine's. What came back
// is shown at once, and the page reads again -- a start's gate and the status may have moved too.
export function useReachOperation(ref: CheckoutRef, run: (ref: CheckoutRef, id: string, body: ReachBody) => Promise<CheckResult>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: ReachAsk) => run(ref, id, body),
    onSuccess: (result, { id }) => client.setQueryData<Connectivity>(runtimeKeys.connectivity(ref), (old) => (old ? withResults(old, id, result.results) : old)),
    onSettled: () => client.invalidateQueries({ queryKey: runtimeKeys.all(ref) }),
  });
}

export const useRuntimeStatus = (ref: CheckoutRef) => useQuery({ queryKey: runtimeKeys.status(ref), queryFn: () => runtimeApi.status(ref) });

export const useProposal = (ref: CheckoutRef, id: string | null) => useQuery({ queryKey: runtimeKeys.proposal(ref, id ?? ""), queryFn: () => runtimeApi.proposal(ref, id ?? ""), enabled: id !== null });

// Whatever an operation did -- or failed half way through -- may have moved the runtime, and the
// one-line summary the Projects list shows, so both are read again.
export function useRuntimeOperation<B, R>(ref: CheckoutRef, run: (ref: CheckoutRef, body: B) => Promise<R>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: B) => run(ref, body),
    onSettled: () => Promise.all([client.invalidateQueries({ queryKey: runtimeKeys.all(ref) }), client.invalidateQueries({ queryKey: projectKeys.all })]),
  });
}

// A settings save names the revision the page read. It moves things only on SUCCESS: a stale one
// is a 409 that keeps the person's draft and says so, instead of replacing it with what is there now.
// `onSaved` hears the new revision BEFORE the page reads again -- the form is drawn afresh for every
// revision, so whatever says "saved" has to live above it.
export function useSaveRuntimeSettings(ref: CheckoutRef, revision: string | null, onSaved?: (revision: string | null) => void) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (settings: SettingsBlock) => runtimeApi.saveSettings(ref, settings, revision),
    onSuccess: (result) => {
      onSaved?.(result.saved.revision);
      return Promise.all([client.invalidateQueries({ queryKey: runtimeKeys.all(ref) }), client.invalidateQueries({ queryKey: projectKeys.all })]);
    },
  });
}

/** What trusting or revoking answers: the settings as they now stand, with the revision to read next. */
export type TrustOperation = "trust" | "revoke";

export interface TrustAsk {
  operation: TrustOperation;
  body: Omit<TrustBody, "revision">;
}

// Trust and revoke name the revision the page read, like every settings write, and move things only on
// SUCCESS: a stale one is a 409 that keeps what the person typed. `onSaved` hears the new revision
// before the page reads again, for whatever says "done" and lives above a form drawn afresh per revision.
export function useTrustOperation(ref: CheckoutRef, revision: string | null, onSaved?: (revision: string | null) => void) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ operation, body }: TrustAsk) => runtimeApi[operation](ref, { ...body, revision }),
    onSuccess: (result) => {
      onSaved?.(result.saved.revision);
      return Promise.all([client.invalidateQueries({ queryKey: runtimeKeys.all(ref) }), client.invalidateQueries({ queryKey: projectKeys.all })]);
    },
  });
}
