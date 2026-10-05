// ESM resolver hook used by the production process entrypoints.
//
// Node's native TypeScript support strips types but does not perform
// extensionless resolution, so the repository's relative imports (for example
// `./deploymentTopology`) cannot be resolved when a script is executed
// directly with `node script.ts`. This hook maps extensionless relative
// specifiers onto their `.ts` / `/index.ts` files.
import { existsSync } from "node:fs";
import { dirname, extname, resolve as resolvePath } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith(".") && context.parentURL !== undefined) {
    const base = resolvePath(dirname(fileURLToPath(context.parentURL)), specifier);
    if (extname(base) === "") {
      for (const candidate of [`${base}.ts`, `${base}.tsx`, resolvePath(base, "index.ts")]) {
        if (existsSync(candidate)) {
          return { url: pathToFileURL(candidate).href, shortCircuit: true };
        }
      }
    }
  }
  return nextResolve(specifier, context);
}
