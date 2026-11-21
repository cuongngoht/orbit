// THE VIRTUAL OFFICE (ADR 0067), as one Nest module over its bounded contexts -- Workforce (office, departments,
// employees, their Personal Sandboxes), Work (missions, assignments, handoffs, Needs me), Execution (runs, admission,
// the worker, the tool plane's door, artifacts) and what they share (the outbox, the consumers, idempotency, the office
// governance of commands). The contexts talk through their ports (RUN_OUTCOMES, the sandbox provider, the connection
// secrets); this module only binds them.
//
// The sandbox provider and the connections' credential store are bound by whoever composes the application (the
// container provider in a deployment, a fake in tests); without a provider employees are hired and their work waits.
import { type DynamicModule, Module, type Provider } from "@nestjs/common";
import { GovernanceModule } from "../modules/governance/governance.module.js";
import { AdmissionService } from "./execution/application/admission.service.js";
import { CONNECTION_SECRETS } from "./execution/application/connection-secrets.port.js";
import { SANDBOX_PROVIDER } from "./execution/application/sandbox.port.js";
import { ExecutionWorker } from "./execution/application/execution.worker.js";
import { ResourcesService } from "./execution/application/resources.service.js";
import { ResearchInputs } from "./execution/application/research-inputs.js";
import { RUN_OUTCOMES } from "./execution/application/run-outcomes.port.js";
import { RunRequests } from "./execution/application/run-requests.js";
import { RunViews } from "./execution/application/run-views.js";
import { ToolsService } from "./execution/application/tools.service.js";
import { WorkspacePublisher } from "./execution/application/workspace-publisher.js";
import { ArtifactStore } from "./execution/infrastructure/artifact-store.js";
import { RunRepository } from "./execution/infrastructure/runs.repository.js";
import { ToolsController } from "./execution/presentation/tools.controller.js";
import { OfficeGovernance } from "./shared/application/commands.js";
import { EventDispatcher } from "./shared/infrastructure/consumers.js";
import { Idempotency } from "./shared/infrastructure/idempotency.js";
import { Outbox } from "./shared/infrastructure/outbox.js";
import { DeliveriesService } from "./work/application/deliveries.service.js";
import { MissionQueries } from "./work/application/mission.queries.js";
import { SchedulesService } from "./work/application/schedules.service.js";
import { MissionsService } from "./work/application/missions.service.js";
import { DecisionRepository } from "./work/infrastructure/decisions.js";
import { AssignmentRepository, HandoffRepository, MissionRepository } from "./work/infrastructure/repositories.js";
import { SourcesCheck } from "./work/infrastructure/sources.check.js";
import { MissionsController } from "./work/presentation/missions.controller.js";
import { SchedulesController } from "./work/presentation/schedules.controller.js";
import { EmployeeEligibility } from "./workforce/application/eligibility.js";
import { EmployeeQueries } from "./workforce/application/employee.queries.js";
import { HiringService } from "./workforce/application/hiring.service.js";
import { OfficeService } from "./workforce/application/office.service.js";
import { SandboxProvisioner } from "./workforce/application/sandbox-provisioner.js";
import { ConnectionsReader } from "./workforce/infrastructure/connections.reader.js";
import { DepartmentRepository, EmployeeRepository, OfficeRepository, SandboxRepository } from "./workforce/infrastructure/repositories.js";
import { OfficeController } from "./workforce/presentation/office.controller.js";

const PROVIDERS: Provider[] = [
  // shared
  Outbox,
  Idempotency,
  EventDispatcher,
  OfficeGovernance,
  // workforce
  OfficeRepository,
  DepartmentRepository,
  EmployeeRepository,
  SandboxRepository,
  ConnectionsReader,
  OfficeService,
  HiringService,
  EmployeeEligibility,
  EmployeeQueries,
  SandboxProvisioner,
  // work
  MissionRepository,
  AssignmentRepository,
  HandoffRepository,
  DecisionRepository,
  SourcesCheck,
  MissionsService,
  MissionQueries,
  SchedulesService,
  DeliveriesService,
  // execution
  RunRepository,
  RunRequests,
  RunViews,
  ResourcesService,
  AdmissionService,
  ArtifactStore,
  ResearchInputs,
  ToolsService,
  WorkspacePublisher,
  ExecutionWorker,
  { provide: RUN_OUTCOMES, useExisting: MissionsService },
];

@Module({})
export class OfficeModule {
  // `bindings`: the sandbox provider (SANDBOX_PROVIDER) and the connections' secrets (CONNECTION_SECRETS), when there are.
  static forRoot(bindings: Provider[] = []): DynamicModule {
    const bound = new Set(bindings.map((b) => (typeof b === "object" && "provide" in b ? b.provide : b)));
    // Unbound ports are bound to nothing (null), so a composition -- or a test -- can override them by their token.
    const defaults: Provider[] = [SANDBOX_PROVIDER, CONNECTION_SECRETS].filter((t) => !bound.has(t)).map((t) => ({ provide: t, useValue: null }));
    return {
      module: OfficeModule,
      imports: [GovernanceModule],
      providers: [...PROVIDERS, ...defaults, ...bindings],
      controllers: [OfficeController, MissionsController, SchedulesController, ToolsController],
      exports: [Outbox, EventDispatcher, ResourcesService, ExecutionWorker, SandboxProvisioner, MissionsService, SchedulesService, ArtifactStore, ResearchInputs],
    };
  }
}
