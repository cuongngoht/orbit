import { useQuery } from '@tanstack/react-query';
import { api } from '../../shared/api/client';
export interface AgenticHost {
  id: string;
  name: string;
  installed: 'unknown';
  configured: 'unknown';
  observed: boolean;
  lastObserved: string | null;
  version: string | null;
  engineVersion: string | null;
  health: 'unknown';
  protocols: string[];
  capabilities: { promptRouter: boolean; sessionEnd: boolean; nativeMemory: boolean };
  desired: Record<string, boolean>;
  effective: Record<string, boolean>;
  revision: number;
  diagnostic: string | null;
}
export const useAgenticHosts = () => useQuery({ queryKey: ['agentic-hosts'], queryFn: () => api.get<{ version: 1; hosts: AgenticHost[] }>('/api/v1/agentic-hosts') });
