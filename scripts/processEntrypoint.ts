import { spawn } from "node:child_process";
import { resolve as resolvePath } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  parseProductionConfiguration,
  type ProductionConfiguration,
} from "../src/platform/productionConfiguration.ts";

const transformTypesFlag = "--experimental-transform-types";

function samePath(left: string, right: string): boolean {
  const normalizedLeft = resolvePath(left);
  const normalizedRight = resolvePath(right);
  return process.platform === "win32"
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight;
}

export function isProcessEntrypoint(moduleUrl: string): boolean {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  return samePath(entry, fileURLToPath(moduleUrl));
}

/**
 * Restarts the current script with the TypeScript transform runtime and the
 * extensionless resolver hook, because Node's type stripping alone cannot load
 * the application graph.
 */
function relaunchWithTypescriptRuntime(moduleUrl: string): Promise<never> {
  const registerPath = fileURLToPath(new URL("./tsRuntimeRegister.mjs", import.meta.url));
  const child = spawn(
    process.execPath,
    [
      transformTypesFlag,
      "--import",
      pathToFileURL(registerPath).href,
      fileURLToPath(moduleUrl),
      ...process.argv.slice(2),
    ],
    { stdio: "inherit", env: process.env },
  );

  const forward = (signal: NodeJS.Signals) => {
    child.kill(signal);
  };
  process.on("SIGINT", forward);
  process.on("SIGTERM", forward);

  return new Promise<never>((_resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal !== null) {
        process.kill(process.pid, signal);
        return;
      }
      process.exit(code ?? 1);
    });
  });
}

/**
 * Shared entrypoint for the production process scripts. Configuration is
 * validated before anything else so a missing or invalid environment fails
 * fast with a non-zero exit code.
 */
export async function runProductionProcessEntrypoint(
  moduleUrl: string,
  start: (configuration: ProductionConfiguration) => Promise<void>,
): Promise<void> {
  const configuration = parseProductionConfiguration(process.env);
  if (!process.execArgv.includes(transformTypesFlag)) {
    await relaunchWithTypescriptRuntime(moduleUrl);
    return;
  }
  await start(configuration);
}

export function failProcessEntrypoint(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}
