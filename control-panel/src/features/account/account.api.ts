import { useQuery } from "@tanstack/react-query";
import { api } from "../../shared/api/client";

/**
 * Who is signed in to Claude Code on the machine Control runs on -- its profile
 * only (control-server/src/account.mjs). Never a token: the server never reads one.
 */
export interface HostAccount {
  host: string;
  signedIn: boolean;
  displayName?: string;
  email?: string;
  organization?: string;
  role?: string;
}

export const accountKeys = { all: ["account"] as const };

// Asked once a minute at most: signing in or out of Claude Code is rare, and the
// answer is one small file read on the server.
export const useHostAccount = () => useQuery({ queryKey: accountKeys.all, queryFn: () => api.get<HostAccount>("/api/v1/account"), staleTime: 60_000 });
