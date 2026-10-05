import { parseProductionConfiguration } from "../src/platform/productionConfiguration.ts";
import type { DeploymentProcessController } from "../src/platform/deploymentTopology.ts";

export async function startWorkerProcess(
  controller: DeploymentProcessController,
  env: Readonly<Record<string, string | undefined>> = process.env,
): Promise<void> {
  parseProductionConfiguration(env);
  await controller.start("worker");
}

export async function stopWorkerProcess(
  controller: DeploymentProcessController,
): Promise<void> {
  await controller.stop("worker", "SIGTERM");
}
