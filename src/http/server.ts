import Fastify from "fastify";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { registerNovelBrainRoutes, type ApiDependencies } from "./routes";
import { createDevelopmentHttpBoundaryPipeline } from "./developmentHttpBoundaryPipeline";
import type { HttpBoundaryPipeline } from "./httpBoundaryPipeline";

export interface NovelBrainServerOptions {
  readonly httpBoundaryPipeline?: HttpBoundaryPipeline;
}

export type NovelBrainServer = ReturnType<typeof createNovelBrainServer>;

/**
 * Static workspace assets are presentation files, not production API
 * boundaries, so they are served directly and never enter the request
 * boundary pipeline.
 */
const PUBLIC_DIRECTORY = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "public");

const staticAssets: readonly {
  readonly route: string;
  readonly file: string;
  readonly contentType: string;
}[] = [
  { route: "/", file: "index.html", contentType: "text/html; charset=utf-8" },
  { route: "/index.html", file: "index.html", contentType: "text/html; charset=utf-8" },
  { route: "/styles.css", file: "styles.css", contentType: "text/css; charset=utf-8" },
  { route: "/app.js", file: "app.js", contentType: "text/javascript; charset=utf-8" },
];

export function createNovelBrainServer(
  dependencies: ApiDependencies,
  options: NovelBrainServerOptions = {},
) {
  const app = Fastify({ logger: false });
  const httpBoundaryPipeline =
    options.httpBoundaryPipeline ?? createDevelopmentHttpBoundaryPipeline();
  app.decorate("httpBoundaryPipeline", httpBoundaryPipeline);
  registerStaticAssets(app);
  registerNovelBrainRoutes(app, dependencies, httpBoundaryPipeline);
  return app as ReturnType<typeof Fastify> & {
    readonly httpBoundaryPipeline?: HttpBoundaryPipeline;
  };
}

function registerStaticAssets(app: FastifyInstance): void {
  for (const asset of staticAssets) {
    app.get(asset.route, async (_request: FastifyRequest, reply: FastifyReply) => {
      try {
        const body = await readFile(join(PUBLIC_DIRECTORY, asset.file), "utf8");
        return reply.code(200).type(asset.contentType).send(body);
      } catch {
        return reply.code(404).send({ error: "Not Found" });
      }
    });
  }
}
