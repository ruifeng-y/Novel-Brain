import Fastify from "fastify";
import { registerNovelBrainRoutes, type ApiDependencies } from "./routes";
import { createDevelopmentHttpBoundaryPipeline } from "./developmentHttpBoundaryPipeline";
import type { HttpBoundaryPipeline } from "./httpBoundaryPipeline";

export interface NovelBrainServerOptions {
  readonly httpBoundaryPipeline?: HttpBoundaryPipeline;
}

export type NovelBrainServer = ReturnType<typeof createNovelBrainServer>;

export function createNovelBrainServer(
  dependencies: ApiDependencies,
  options: NovelBrainServerOptions = {},
) {
  const app = Fastify({ logger: false });
  const httpBoundaryPipeline =
    options.httpBoundaryPipeline ?? createDevelopmentHttpBoundaryPipeline();
  app.decorate("httpBoundaryPipeline", httpBoundaryPipeline);
  registerNovelBrainRoutes(app, dependencies, httpBoundaryPipeline);
  return app as ReturnType<typeof Fastify> & {
    readonly httpBoundaryPipeline?: HttpBoundaryPipeline;
  };
}
