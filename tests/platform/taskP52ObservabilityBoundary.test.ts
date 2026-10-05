import { readFileSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { preProcessFile } from "typescript";
import { describe, expect, it } from "vitest";
import {
  createPlatformObservabilityBoundary,
  observabilityBoundaryContract,
  type ObservabilityCorrelation,
  type ObservabilityEvent,
} from "../../src/platform/observabilityBoundary";

function domainImports(entry: string): readonly string[] {
  const seen = new Set<string>();
  const queue = [entry];
  const found: string[] = [];
  while (queue.length > 0) {
    const file = queue.shift();
    if (file === undefined || seen.has(file)) continue;
    seen.add(file);
    for (const imported of preProcessFile(readFileSync(file, "utf8"), true, true).importedFiles) {
      const base = resolve(dirname(file), imported.fileName);
      const resolved = extname(base)
        ? base
        : [`${base}.ts`, `${base}.tsx`, resolve(base, "index.ts")].find(candidate => {
            try {
              readFileSync(candidate);
              return true;
            } catch {
              return false;
            }
          }) ?? base;
      if (/[/\\]domain[/\\]/.test(resolved)) found.push(imported.fileName);
      if (!seen.has(resolved)) queue.push(resolved);
    }
  }
  return found;
}

const correlation: ObservabilityCorrelation = {
  requestId: "request-1",
  traceId: "trace-1",
  auditId: "audit-1",
  runId: "run-1",
  attemptId: "attempt-1",
  commitId: "commit-1",
  recallId: "recall-1",
};

function observed(): {
  events: ObservabilityEvent[];
  boundary: ReturnType<typeof createPlatformObservabilityBoundary>;
} {
  const events: ObservabilityEvent[] = [];
  let next = 0;
  const boundary = createPlatformObservabilityBoundary({
    sink: event => {
      events.push(event);
    },
    now: () => new Date("2026-10-05T12:00:00.000Z"),
    idGenerator: () => `event-${++next}`,
  });
  return { events, boundary };
}

describe("[task:P5.2] [domain] Observability boundary ownership", () => {
  it("owns logs, metrics, traces, health, and audit correlation outside Novel Domain", () => {
    expect(observabilityBoundaryContract).toEqual({
      id: "platform.observability.boundary",
      owner: "operational-platform",
      structuredLogging: "required",
      metrics: "required",
      tracing: "required",
      health: ["liveness", "readiness"],
      auditCorrelation: ["run", "attempt", "commit", "recall"],
      changesNovelDomain: false,
    });
    const entry = fileURLToPath(
      new URL("../../src/platform/observabilityBoundary.ts", import.meta.url),
    );
    expect(domainImports(entry)).toEqual([]);
  });
});

describe("[task:P5.2] [integration] Logs, metrics, traces, and health", () => {
  it("emits structured operational signals with shared request and trace identity", async () => {
    const { events, boundary } = observed();

    boundary.log(correlation, {
      level: "info",
      message: "run started",
      fields: { runId: correlation.runId },
    });
    boundary.metric(correlation, { name: "run.started", value: 1, unit: "count" });
    await boundary.trace(correlation, "execute-run", async () => undefined);
    boundary.health(correlation, {
      liveness: "healthy",
      readiness: "degraded",
      checks: { database: "healthy", worker: "degraded" },
    });

    expect(events.map(event => event.kind)).toEqual([
      "log",
      "metric",
      "trace-start",
      "trace-end",
      "health",
    ]);
    for (const event of events) {
      expect(event.correlation).toEqual(correlation);
      expect(event.id).toMatch(/^event-/);
      expect(event.occurredAt).toEqual(new Date("2026-10-05T12:00:00.000Z"));
    }
    expect(events[2]).toMatchObject({
      kind: "trace-start",
      operation: "execute-run",
      spanId: "span-1",
    });
    expect(events[3]).toMatchObject({
      kind: "trace-end",
      operation: "execute-run",
      spanId: "span-1",
      status: "ok",
    });
    expect(events[4]).toMatchObject({
      kind: "health",
      liveness: "healthy",
      readiness: "degraded",
    });
  });
});

describe("[task:P5.2] [integration] Trace failure diagnostics", () => {
  it("ends failed traces with error status while preserving correlation", async () => {
    const { events, boundary } = observed();

    await expect(
      boundary.trace(correlation, "execute-run", async () => {
        throw new Error("execution failed");
      }),
    ).rejects.toThrow("execution failed");

    expect(events).toMatchObject([
      { kind: "trace-start", operation: "execute-run", spanId: "span-1" },
      {
        kind: "trace-end",
        operation: "execute-run",
        spanId: "span-1",
        status: "error",
        error: "execution failed",
        correlation,
      },
    ]);
  });
});
describe("[task:P5.2] [cross-system] Audit correlation", () => {
  it("rejects forged or missing audit subject correlation identity", () => {
    const { events, boundary } = observed();
    const { runId: _runId, ...withoutRun } = correlation;

    expect(() =>
      boundary.audit(correlation, { kind: "run", id: "forged-run" }),
    ).toThrow();
    expect(() =>
      boundary.audit(withoutRun, { kind: "run", id: "run-1" }),
    ).toThrow();
    expect(events).toEqual([]);
  });

  it("correlates Run, attempt, commit, and Recall audit records to one request trace", () => {
    const { events, boundary } = observed();

    boundary.audit(correlation, { kind: "run", id: correlation.runId! });
    boundary.audit(correlation, { kind: "attempt", id: correlation.attemptId! });
    boundary.audit(correlation, { kind: "commit", id: correlation.commitId! });
    boundary.audit(correlation, { kind: "recall", id: correlation.recallId! });

    expect(events).toMatchObject([
      { kind: "audit", subjectKind: "run", subjectId: "run-1" },
      { kind: "audit", subjectKind: "attempt", subjectId: "attempt-1" },
      { kind: "audit", subjectKind: "commit", subjectId: "commit-1" },
      { kind: "audit", subjectKind: "recall", subjectId: "recall-1" },
    ]);
    for (const event of events) {
      expect(event.correlation).toMatchObject({
        requestId: "request-1",
        traceId: "trace-1",
        auditId: "audit-1",
      });
    }
  });
});

describe("[task:P5.2] [concurrency] Trace isolation", () => {
  it("assigns distinct spans while preserving each operation's correlation", async () => {
    const { events, boundary } = observed();
    const otherCorrelation: ObservabilityCorrelation = {
      ...correlation,
      requestId: "request-2",
      traceId: "trace-2",
      auditId: "audit-2",
      runId: "run-2",
      attemptId: "attempt-2",
      commitId: "commit-2",
      recallId: "recall-2",
    };

    await Promise.all([
      boundary.trace(correlation, "execute-run-a", async () => undefined),
      boundary.trace(otherCorrelation, "execute-run-b", async () => undefined),
    ]);

    const starts = events.filter(event => event.kind === "trace-start");
    expect(starts).toHaveLength(2);
    expect(starts[0]).toMatchObject({ spanId: "span-1", correlation });
    expect(starts[1]).toMatchObject({ spanId: "span-2", correlation: otherCorrelation });
    expect(starts[0]!.spanId).not.toBe(starts[1]!.spanId);
  });
});
