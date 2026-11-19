import { Module } from "@nestjs/common";
import { OrbitGateway } from "./orbit.gateway.js";
import { OrbitService } from "./orbit.service.js";

@Module({
  providers: [OrbitGateway, OrbitService],
  exports: [OrbitGateway, OrbitService],
})
export class OrbitModule {}
