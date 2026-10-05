import { readFileSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { preProcessFile } from "typescript";
import { describe, expect, it } from "vitest";
import {
  InMemoryLongRunningProcessBoundary,
  getLongRunningProcessContract,
  longRunningProcessContracts,
  longRunningProcessKinds,
} from "../../src/application/longRunningProcessBoundary";
import {
  applicationBoundaryContracts,
  type ApplicationCommandContract,
  type ApplicationQueryContract,
} from "../../src/application/commandQueryBoundary";

const expectedProcessContractIds = [
  "process.generation",
  "process.validation",
  "process.run",
  "process.impact-analysis",
  "process.projection-rebuild",
] as const;

function resolveImport(importer: string, specifier: string): string {
  const base = resolve(dirname(importer), specifier);
  const candidates = extname(base)
    ? [base]
    : [`${base}.ts`, `${base}.tsx`, resolve(base, "index.ts")];
  const resolved = candidates.find(candidate => {
    try {
      readFileSync(candidate);
      return true;
    } catch {
      return false;
    }
  });
  return resolved ?? base;
}

function findDomainImports(entry: string): readonly string[] {
  const seen = new Set<string>();
  const queue = [entry];
  const domainImports: string[] = [];

  while (queue.length > 0) {
    const file = queue.shift();
    if (file === undefined || seen.has(file)) continue;
    seen.add(file);

    const source = readFileSync(file, "utf8");
    for (const imported of preProcessFile(source, true, true).importedFiles) {
      const resolvedImport = resolveImport(file, imported.fileName);
      if (/[/\\]domain[/\\]/.test(resolvedImport)) domainImports.push(imported.fileName);
      if (!seen.has(resolvedImport)) queue.push(resolvedImport);
    }
  }

  return domainImports;
}

describe("[task:P2.2] long-running process boundary", () => {
  it("[integration] exposes submitted, running, and terminal process results asynchronously", async () => {
    const boundary = new InMemoryLongRunningProcessBoundary<string>();

    const submitted = await boundary.submit({ id: "process-1", kind: "generation" });
    expect(submitted).toEqual({
      id: "process-1",
      kind: "generation",
      phase: "submitted",
      status: "submitted",
      cancellationRequested: false,
    });

    const running = await boundary.markRunning("process-1");
    expect(running).toEqual({
      id: "process-1",
      kind: "generation",
      phase: "running",
      status: "running",
      cancellationRequested: false,
    });

    const resultPromise = boundary.result("process-1");
    let resultResolved = false;
    void resultPromise.then(() => {
      resultResolved = true;
    });
    await Promise.resolve();
    expect(resultResolved).toBe(false);

    const completed = await boundary.complete("process-1", {
      status: "succeeded",
      value: "generated",
    });
    expect(completed).toEqual({
      id: "process-1",
      kind: "generation",
      phase: "terminal",
      status: "succeeded",
      cancellationRequested: false,
      result: { status: "succeeded", value: "generated" },
    });
    expect(await resultPromise).toEqual({ status: "succeeded", value: "generated" });
    expect(await boundary.result("process-1")).toEqual({ status: "succeeded", value: "generated" });
  });

  it("[concurrency] reserves one process identity for duplicate concurrent submissions", async () => {
    const boundary = new InMemoryLongRunningProcessBoundary<string>();
    const submission = { id: "process-2", kind: "run" } as const;

    const [first, second] = await Promise.all([
      boundary.submit(submission),
      boundary.submit(submission),
    ]);
    expect(first).toEqual(second);

    await boundary.markRunning("process-2");
    const firstResult = boundary.result("process-2");
    const secondResult = boundary.result("process-2");

    await boundary.complete("process-2", { status: "failed", error: "provider-timeout" });
    expect(await firstResult).toEqual({ status: "failed", error: "provider-timeout" });
    expect(await secondResult).toEqual({ status: "failed", error: "provider-timeout" });
    await expect(
      boundary.submit({ id: "process-2", kind: "validation" }),
    ).rejects.toThrow("process identity process-2 is already reserved for run");
  });

  it("[regression] accepts idempotent cancellation and rejects conflicting terminal results", async () => {
    const boundary = new InMemoryLongRunningProcessBoundary<string>();
    await boundary.submit({ id: "process-3", kind: "projection-rebuild" });
    await boundary.markRunning("process-3");

    expect(await boundary.requestCancellation("process-3")).toEqual({
      id: "process-3",
      disposition: "requested",
      status: "running",
      cancellationRequested: true,
    });
    expect(await boundary.requestCancellation("process-3")).toEqual({
      id: "process-3",
      disposition: "already-requested",
      status: "running",
      cancellationRequested: true,
    });
    await expect(
      boundary.complete("process-3", { status: "succeeded", value: "rebuilt" }),
    ).rejects.toThrow("process process-3 requested cancellation");

    const cancelledResult = boundary.result("process-3");
    expect(await boundary.complete("process-3", { status: "cancelled" })).toEqual({
      id: "process-3",
      kind: "projection-rebuild",
      phase: "terminal",
      status: "cancelled",
      cancellationRequested: true,
      result: { status: "cancelled" },
    });
    expect(await cancelledResult).toEqual({ status: "cancelled" });
    expect(await boundary.requestCancellation("process-3")).toEqual({
      id: "process-3",
      disposition: "already-terminal",
      status: "cancelled",
      cancellationRequested: true,
    });
    await expect(
      boundary.complete("process-3", { status: "failed", error: "late-failure" }),
    ).rejects.toThrow("process process-3 is already terminal with cancelled");
  });

  it("[domain] keeps process lifecycle contracts independent of Domain state", () => {
    const entry = fileURLToPath(
      new URL("../../src/application/longRunningProcessBoundary.ts", import.meta.url),
    );
    expect(findDomainImports(entry)).toEqual([]);
  });

  it("[cross-system] reuses P2.1 command/query boundary semantics for process control", () => {
    const commandShape: Pick<
      ApplicationCommandContract,
      "kind" | "effect" | "resultChannel"
    > = { kind: "command", effect: "mutation", resultChannel: "command-result" };
    const queryShape: Pick<
      ApplicationQueryContract,
      "kind" | "effect" | "resultChannel"
    > = { kind: "query", effect: "read", resultChannel: "query-result" };

    for (const contract of longRunningProcessContracts) {
      expect(contract.submission).toEqual(commandShape);
      expect(contract.cancellation.request).toEqual(commandShape);
      expect(contract.status).toEqual(queryShape);
      expect(contract.result).toEqual({
        kind: "process-result",
        effect: "read",
        resultChannel: "process-result",
      });
    }

    const boundaryIds = applicationBoundaryContracts.map(contract => contract.id);
    expect(new Set(boundaryIds).size).toBe(boundaryIds.length);
  });

  it("[regression] preserves the five process kinds and primitive-only lifecycle descriptors", () => {
    expect(longRunningProcessKinds).toEqual([
      "generation",
      "validation",
      "run",
      "impact-analysis",
      "projection-rebuild",
    ]);
    expect(longRunningProcessContracts.map(contract => contract.id)).toEqual(
      expectedProcessContractIds,
    );

    for (const contract of longRunningProcessContracts) {
      expect(Object.keys(contract).sort()).toEqual([
        "cancellation",
        "id",
        "idempotency",
        "kind",
        "lifecycle",
        "result",
        "status",
        "submission",
      ]);
      expect(contract.lifecycle).toEqual({
        phases: ["submitted", "running", "terminal"],
        terminalStatuses: ["succeeded", "failed", "cancelled"],
      });
      expect(contract.cancellation).toEqual({
        request: { kind: "command", effect: "mutation", resultChannel: "command-result" },
        supported: true,
        terminalStatus: "cancelled",
        idempotent: true,
      });
      expect(contract.idempotency).toEqual({
        identity: "process-id",
        duplicateDisposition: "return-existing-process",
      });
    }

    expect(getLongRunningProcessContract("impact-analysis")).toBe(
      longRunningProcessContracts[3],
    );
    expect(() => getLongRunningProcessContract("approval")).toThrow(
      "unknown long-running process kind: approval",
    );
  });
});
