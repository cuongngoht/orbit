import { useQuery } from "@tanstack/react-query";
import { api } from "../../shared/api/client";
import type { WorkList, WorkRef, WorkResponse } from "./work.types";
import { workApiPath, worksApiPath } from "./workWords";

// A work is READ in Control: the one view the terminal and Orbit Live read too. Nothing here writes a work, approves
// anything or runs a workflow -- the host's own `cli/track.mjs` is the only writer.
export const workApi = {
  list: (key: string, checkout: string) => api.get<WorkList>(worksApiPath(key, checkout)),
  work: (ref: WorkRef) => api.get<WorkResponse>(workApiPath(ref)),
};

export const workKeys = {
  all: ["work"] as const,
  list: (key: string, checkout: string) => [...workKeys.all, "list", key, checkout] as const,
  work: (ref: WorkRef) => [...workKeys.all, "work", ref.key, ref.checkout, ref.work] as const,
};

/** How often a work that is not closed is read again. A closed one is not. */
export const WORK_REFRESH_MS = 5000;

export const useWorks = (key: string, checkout: string) => useQuery({ queryKey: workKeys.list(key, checkout), queryFn: () => workApi.list(key, checkout), refetchInterval: WORK_REFRESH_MS });

export const useWork = (ref: WorkRef) =>
  useQuery({ queryKey: workKeys.work(ref), queryFn: () => workApi.work(ref), refetchInterval: (query) => (query.state.data?.work.lifecycle.terminal === false ? WORK_REFRESH_MS : false) });
