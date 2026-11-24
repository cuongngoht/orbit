// THE VIRTUAL OFFICE (ADR 0061), as one Nest module over its bounded contexts -- Workforce (office, departments,
// employees, their Personal Sandboxes), Work (missions, assignments, handoffs, Needs me), Execution (runs, admission,
// the worker, the tool plane's door, artifacts) and what they share (the outbox, the consumers, idempotency, the office
// governance of commands). The contexts talk through their ports (RUN_OUTCOMES, the sandbox provider, the connection
// secrets); this module only binds them.
//
// The sandbox provider and the connections' credential store are bound by whoever composes the application (the
// container provider in a deployment, a fake in tests); without a provider employees are hired and their work waits.
import { type DynamicModule, Module, type Provider } from "@nestjs/common";
import type { AppConfig } from "../config/config.js";
import { APP_CONFIG } from "../core/tokens.js";
import { CredentialStore } from "../infra/connections/credentials.js";
import { AGENT_PROCESS_PORT, type ProcessPort } from "../infra/process/process.port.js";
import { ConnectionsModule } from "../modules/connections/connections.module.js";
import { MissionRepositoryGrants } from "../modules/employee-access/mission-repositories.js";
import { RepositoryBundler } from "../modules/employee-access/repository-bundler.js";
import { EmployeeTools } from "../modules/employee-access/employee-tools.js";
import { EmployeeAccessModule } from "../modules/employee-access/employee-access.module.js";
import { GovernanceModule } from "../modules/governance/governance.module.js";
import { AccessWatch } from "./execution/application/access-watch.js";
import { AttemptInputs } from "./execution/application/attempt-inputs.js";
import { AttemptManifest } from "./execution/infrastructure/attempt-manifest.js";
import { CONNECTOR_TOOLS } from "./execution/application/connector-tools.port.js";
import { REPOSITORY_BUNDLES } from "./execution/application/repository-bundles.port.js";
import { MISSION_REPOSITORIES } from "./work/application/mission-repositories.port.js";
import { AdmissionService } from "./execution/application/admission.service.js";
import { CONNECTION_SECRETS } from "./execution/application/connection-secrets.port.js";
import { SANDBOX_PROVIDER } from "./execution/application/sandbox.port.js";
import { ConnectionWatch } from "./execution/application/connection-watch.js";
import { ExecutionWorker } from "./execution/application/execution.worker.js";
import { ResourcesService } from "./execution/application/resources.service.js";
import { ResearchInputs } from "./execution/application/research-inputs.js";
import { ATTEMPT_DATA, RUN_OUTCOMES } from "./execution/application/run-outcomes.port.js";
import { RunRequests } from "./execution/application/run-requests.js";
import { RunViews } from "./execution/application/run-views.js";
import { ToolsService } from "./execution/application/tools.service.js";
import { WorkspacePublisher } from "./execution/application/workspace-publisher.js";
import { ArtifactStore } from "./execution/infrastructure/artifact-store.js";
import { ModelPlaneEgress } from "./execution/infrastructure/model-plane-egress.js";
import { sandboxProviderOf } from "./execution/infrastructure/sandbox-provider.factory.js";
import { RunRepository } from "./execution/infrastructure/runs.repository.js";
import { ToolsController } from "./execution/presentation/tools.controller.js";
import { OfficeGovernance } from "./shared/application/commands.js";
import { EventDispatcher } from "./shared/infrastructure/consumers.js";
import { Idempotency } from "./shared/infrastructure/idempotency.js";
import { Outbox } from "./shared/infrastructure/outbox.js";
import { DeliveriesService } from "./work/application/deliveries.service.js";
import { MissionQueries } from "./work/application/mission.queries.js";
import { SchedulesService } from "./work/application/schedules.service.js";
import { AttemptDataService } from "./work/application/attempt-data.service.js";
import { ClarificationsService } from "./work/application/clarifications.service.js";
import { ClarificationRepository } from "./work/infrastructure/clarifications.repository.js";
import { OrgReader } from "./work/infrastructure/org.reader.js";
import { TeamService } from "./work/application/team.service.js";
import { MissionsService } from "./work/application/missions.service.js";
import { DecisionRepository } from "./work/infrastructure/decisions.js";
import { AssignmentRepository, HandoffRepository, MissionRepository } from "./work/infrastructure/repositories.js";
import { SourcesCheck } from "./work/infrastructure/sources.check.js";
import { MissionsController } from "./work/presentation/missions.controller.js";
import { SchedulesController } from "./work/presentation/schedules.controller.js";
import { AppointmentsService } from "./workforce/application/appointments.service.js";
import { EmployeeEligibility } from "./workforce/application/eligibility.js";
import { DeskService } from "./workforce/application/desk.service.js";
import { EmployeeQueries } from "./workforce/application/employee.queries.js";
import { HiringService } from "./workforce/application/hiring.service.js";
import { OfficeService } from "./workforce/application/office.service.js";
import { SandboxProvisioner } from "./workforce/application/sandbox-provisioner.js";
import { AppointmentRepository } from "./workforce/infrastructure/appointments.repository.js";
import { ConnectionsReader } from "./workforce/infrastructure/connections.reader.js";
import { DepartmentRepository, EmployeeRepository, OfficeRepository, SandboxRepository } from "./workforce/infrastructure/repositories.js";
import { AppointmentsController } from "./workforce/presentation/appointments.controller.js";
import { DeskController } from "./workforce/presentation/desk.controller.js";
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
  AppointmentRepository,
  ConnectionsReader,
  OfficeService,
  AppointmentsService,
  HiringService,
  EmployeeEligibility,
  EmployeeQueries,
  DeskService,
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
  TeamService,
  AttemptDataService,
  OrgReader,
  ClarificationRepository,
  ClarificationsService,
  // execution
  RunRepository,
  RunRequests,
  RunViews,
  ResourcesService,
  AdmissionService,
  ArtifactStore,
  ResearchInputs,
  AttemptManifest,
  ToolsService,
  WorkspacePublisher,
  ExecutionWorker,
  ConnectionWatch,
  AccessWatch,
  ModelPlaneEgress,
  { provide: RUN_OUTCOMES, useExisting: MissionsService },
  { provide: ATTEMPT_DATA, useExisting: AttemptDataService },
];

@Module({})
export class OfficeModule {
  // `bindings`: the sandbox provider (SANDBOX_PROVIDER) and the connections' secrets (CONNECTION_SECRETS), when there are.
  static forRoot(bindings: Provider[] = []): DynamicModule {
    const bound = new Set(bindings.map((b) => (typeof b === "object" && "provide" in b ? b.provide : b)));
    // The sandbox provider this configuration names (a test overrides it by its token); the connections' keys are read
    // from the Connections context's own credential store.
    const defaults: Provider[] = [
      ...(bound.has(SANDBOX_PROVIDER) ? [] : [{ provide: SANDBOX_PROVIDER, useFactory: (config: AppConfig, inputs: AttemptInputs, process: ProcessPort) => sandboxProviderOf(config, (p) => inputs.read(p), process), inject: [APP_CONFIG, AttemptInputs, AGENT_PROCESS_PORT] }]),
      ...(bound.has(CONNECTION_SECRETS) ? [] : [{ provide: CONNECTION_SECRETS, useExisting: CredentialStore }]),
      ...(bound.has(CONNECTOR_TOOLS) ? [] : [{ provide: CONNECTOR_TOOLS, useExisting: EmployeeTools }]),
      // A mission's repositories: held to its employee's grants, and brought into its attempts as git bundles.
      ...(bound.has(MISSION_REPOSITORIES) ? [] : [{ provide: MISSION_REPOSITORIES, useExisting: MissionRepositoryGrants }]),
      ...(bound.has(REPOSITORY_BUNDLES) ? [] : [{ provide: REPOSITORY_BUNDLES, useExisting: RepositoryBundler }]),
    ];
    return {
      module: OfficeModule,
      imports: [GovernanceModule, ConnectionsModule, EmployeeAccessModule],
      providers: [...PROVIDERS, AttemptInputs, ...defaults, ...bindings],
      controllers: [OfficeController, AppointmentsController, DeskController, MissionsController, SchedulesController, ToolsController],
      exports: [Outbox, EventDispatcher, ResourcesService, ExecutionWorker, SandboxProvisioner, MissionsService, SchedulesService, ArtifactStore, ResearchInputs, AttemptInputs],
    };
  }
}
