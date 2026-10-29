import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../shared/api/client";
import type { AuthRun, AuthState, Connection, ConnectionsView, ConnectionTest, CredentialInput, NewConnection } from "./connections.types";

const BASE = "/api/v1/connections";
const one = (id: string) => `${BASE}/${encodeURIComponent(id)}`;

export const connectionsApi = {
  list: () => api.get<ConnectionsView>(BASE),
  get: (id: string) => api.get<Connection>(one(id)),
  create: (input: NewConnection) => api.post<Connection>(BASE, input),
  update: (id: string, patch: Partial<Pick<Connection, "label" | "host" | "organization" | "note" | "auth">>) => api.put<Connection>(one(id), patch),
  remove: (id: string) => api.delete<{ id: string; removed: boolean }>(one(id)),
  setCredential: (id: string, input: CredentialInput) => api.put<{ connection: Connection; backend: string | null }>(`${one(id)}/credential`, input),
  clearCredential: (id: string) => api.delete<Connection>(`${one(id)}/credential`),
  test: (id: string) => api.post<ConnectionTest>(`${one(id)}/test`),
  // A look at the session, a sign-in, a sign-out: each a POST, because a look asks a program and a sign-in opens a browser.
  // What comes back is how the session ended up -- no token, and not the prompt the program printed.
  auth: (id: string, run: AuthRun) => api.post<AuthState>(`${one(id)}/auth/${run.action}`, run.action === "sign-in" ? run.options : undefined),
};

export const connectionKeys = {
  all: ["connections"] as const,
  list: () => [...connectionKeys.all, "list"] as const,
  detail: (id: string) => [...connectionKeys.all, "detail", id] as const,
};

export const useConnections = () => useQuery({ queryKey: connectionKeys.list(), queryFn: connectionsApi.list });
export const useConnection = (id: string) => useQuery({ queryKey: connectionKeys.detail(id), queryFn: () => connectionsApi.get(id) });

// A change to a connection is a change the report pages show too.
export function useConnectionChange<I, O>(fn: (input: I) => Promise<O>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => Promise.all([client.invalidateQueries({ queryKey: connectionKeys.all }), client.invalidateQueries({ queryKey: ["reports"] })]),
  });
}

// The one mutation that carries a credential. It is never cached: gcTime 0
// drops its variables the moment it settles, so the value does not linger in
// the query client after it has gone to the server.
export function useSetCredential(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: CredentialInput) => connectionsApi.setCredential(id, input),
    gcTime: 0,
    onSuccess: () => Promise.all([client.invalidateQueries({ queryKey: connectionKeys.all }), client.invalidateQueries({ queryKey: ["reports"] })]),
  });
}
