import { spawnSync } from "node:child_process";
import { parseProductionConfiguration } from "../src/platform/productionConfiguration.ts";

export type MigrationCommandRunner = (
  command: string,
  args: readonly string[],
  options: { readonly env: Readonly<Record<string, string | undefined>> },
) => { readonly status: number | null };

export function runMigrationEntry(
  env: Readonly<Record<string, string | undefined>> = process.env,
  run: MigrationCommandRunner = (command, args, options) =>
    spawnSync(command, [...args], {
      stdio: "inherit",
      env: { ...process.env, ...options.env },
      shell: process.platform === "win32",
    }),
): void {
  const configuration = parseProductionConfiguration(env);
  const result = run(
    process.platform === "win32" ? "npx.cmd" : "npx",
    ["prisma", "migrate", "deploy"],
    { env },
  );
  if (result.status !== 0) {
    throw new Error(`migration failed with exit code ${result.status ?? "unknown"}`);
  }
  void configuration;
}
