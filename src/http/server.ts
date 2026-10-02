import Fastify from "fastify";
import { registerNovelBrainRoutes, type ApiDependencies } from "./routes";

export function createNovelBrainServer(dependencies: ApiDependencies) {
  const app = Fastify({ logger: false });
  registerNovelBrainRoutes(app, dependencies);
  return app;
}
