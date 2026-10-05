import { parseProductionConfiguration } from "../src/platform/productionConfiguration.ts";
import type { DeploymentProcessController } from "../src/platform/deploymentTopology.ts";

export async function startApplicationProcess(
  controller: DeploymentProcessController,
  env: Readonly<Record<string, string | undefined>> = process.env,
): Promise<void> {
  parseProductionConfiguration(env);
  await controller.start("application");
}

export async function stopApplicationProcess(
  controller: DeploymentProcessController,
): Promise<void> {
  await controller.stop("application", "SIGTERM");
}
