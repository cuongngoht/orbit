// THE REPOSITORIES A MISSION BRINGS IN: each one held, when the work is given, to what its employee may use (its Access
// tab), kept with the mission, and read back for its attempts and its page. Bound by the composition (office.module.ts)
// to the employee-access module; with none bound, a mission brings no repository.
import type { MissionRepositoryRequest } from "@orbit-web/contracts";
import type { AttemptRepository } from "../../execution/application/repository-bundles.port.js";

export const MISSION_REPOSITORIES = Symbol("MISSION_REPOSITORIES");

// What an attempt brings in is what its mission was granted.
export type MissionRepository = AttemptRepository;

export interface MissionRepositories {
  // Each repository asked, as the connector lists it, if the employee may use it (or when a lead delegates the mission
  // down to teammates whose own Access grants are verified at attempt start) -- else refused, saying why.
  resolve(orbitId: string, employeeId: string, asked: readonly MissionRepositoryRequest[], allowDelegated?: boolean): Promise<MissionRepository[]>;
  keep(orbitId: string, missionId: string, repositories: readonly MissionRepository[], by: string): Promise<void>;
  of(orbitId: string, missionId: string): Promise<MissionRepository[]>;
}
