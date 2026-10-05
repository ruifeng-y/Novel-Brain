import type { ProductionConfiguration } from "../src/platform/productionConfiguration.ts";
import {
  failProcessEntrypoint,
  isProcessEntrypoint,
  runProductionProcessEntrypoint,
} from "./processEntrypoint.ts";

export async function startApplicationEntry(
  configuration: ProductionConfiguration,
): Promise<void> {
  const { startDeploymentProcess } = await import("./productionProcessComposition.ts");
  await startDeploymentProcess("application", configuration);
}

if (isProcessEntrypoint(import.meta.url)) {
  runProductionProcessEntrypoint(import.meta.url, startApplicationEntry).catch(
    failProcessEntrypoint,
  );
}
