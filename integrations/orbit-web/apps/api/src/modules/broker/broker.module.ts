// THE BROKER: protected actions Orbit Web carries out for an agent or a person after a person's approval -- today a
// push to GitHub or Azure DevOps -- and the agent gateway through which an agent asks for them.
import { Module } from "@nestjs/common";
import { ChangesModule } from "../changes/changes.module.js";
import { GovernanceModule } from "../governance/governance.module.js";
import { SourcesModule } from "../sources/sources.module.js";
import { AgentGatewayController } from "./agent-gateway.controller.js";
import { PushBroker } from "./push.broker.js";
import { PushController } from "./push.controller.js";

@Module({
  imports: [GovernanceModule, SourcesModule, ChangesModule],
  providers: [PushBroker],
  controllers: [AgentGatewayController, PushController],
})
export class BrokerModule {}
