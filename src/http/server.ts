import Fastify from "fastify";
import { registerNovelBrainRoutes, type ApiDependencies } from "./routes";
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
  if (options.httpBoundaryPipeline !== undefined) {
    app.decorate("httpBoundaryPipeline", options.httpBoundaryPipeline);
  }
  registerNovelBrainRoutes(app, dependencies);
  return app as ReturnType<typeof Fastify> & {
    readonly httpBoundaryPipeline?: HttpBoundaryPipeline;
  };
}
