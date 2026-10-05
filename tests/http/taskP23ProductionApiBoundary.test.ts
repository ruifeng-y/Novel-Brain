import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import {
  InMemoryApiIdempotencyStore,
  createProductionApiBoundary,
  apiBoundaryContracts,
  getApiBoundaryContract,
  ApiAuthorizationError,
  ApiRequestValidationError,
  ApiIdempotencyConflictError,
} from "../../src/http/productionApiBoundary";
import {
  applicationBoundaryContracts,
  applicationCapabilityBoundaries,
} from "../../src/application/commandQueryBoundary";
import { longRunningProcessContracts } from "../../src/application/longRunningProcessBoundary";
import {
  InMemoryLongRunningProcessBoundary,
} from "../../src/application/longRunningProcessBoundary";

function domainImports(path: string): string[] {
  const source = readFileSync(path, "utf8");
  return [...source.matchAll(/from\s+["'](?:\.\.\/)+[^"']*domain[^"']*["']/g)].map(match => match[0]);
}

describe("[task:P2.3] [domain] production API boundary contracts", () => {
  it("exposes command, query, and process result channels without Domain imports", () => {
    const entry = fileURLToPath(new URL("../../src/http/productionApiBoundary.ts", import.meta.url));
    expect(domainImports(entry)).toEqual([]);
    expect(apiBoundaryContracts.map(contract => contract.id)).toEqual(
      expect.arrayContaining(applicationBoundaryContracts.map(contract => contract.id)),
    );
    expect(apiBoundaryContracts.map(contract => contract.id)).toEqual(
      expect.arrayContaining(longRunningProcessContracts.map(contract => contract.id)),
    );
    expect(applicationCapabilityBoundaries.generation.commands[0]?.id).toBe(
      "generation.command.create-generation-task",
    );
    expect(getApiBoundaryContract("api.command")).toMatchObject({
      id: "generation.command.create-generation-task",
      kind: "command",
      effect: "mutation",
      resultChannel: "command-result",
      validation: "required",
      authorization: "required",
      idempotency: "supported",
    });
    expect(getApiBoundaryContract("api.query")).toMatchObject({
      id: "generation.query.generation-task-status",
      kind: "query",
      effect: "read",
      resultChannel: "query-result",
      validation: "required",
      authorization: "required",
      idempotency: "not-applicable",
    });
    expect(getApiBoundaryContract("api.process")).toMatchObject({
      id: "process.generation",
      kind: "process",
      effect: "async",
      resultChannel: "process-result",
      validation: "required",
      authorization: "required",
      idempotency: "required",
    });
    expect(() => getApiBoundaryContract("api.unknown")).toThrow(
      "unknown production API boundary contract: api.unknown",
    );
  });

  it("validates requests before authorization and execution", async () => {
    const calls: string[] = [];
    const boundary = createProductionApiBoundary({
      requestValidation: () => {
        calls.push("validation");
        return { valid: false, issues: [{ code: "invalid", message: "invalid request" }] };
      },
      authorization: () => {
        calls.push("authorization");
        return { allowed: true };
      },
      commandHandler: () => {
        calls.push("command");
        return { ok: true };
      },
    });

    await expect(
      boundary.executeCommand("api.command", { payload: "invalid" }),
    ).rejects.toBeInstanceOf(ApiRequestValidationError);
    expect(calls).toEqual(["validation"]);
  });

  it("runs authorization hooks before command/query/process handlers", async () => {
    const calls: string[] = [];
    const boundary = createProductionApiBoundary({
      requestValidation: request => ({ valid: true, request }),
      authorization: () => {
        calls.push("authorization");
        return { allowed: false, reason: "forbidden" };
      },
      commandHandler: () => {
        calls.push("command");
        return { ok: true };
      },
      queryHandler: () => {
        calls.push("query");
        return { ok: true };
      },
      processHandler: () => {
        calls.push("process");
        return { id: "process-1", kind: "generation" };
      },
    });

    await expect(
      boundary.executeCommand("api.command", { payload: "command" }),
    ).rejects.toBeInstanceOf(ApiAuthorizationError);
    await expect(
      boundary.executeQuery("api.query", { payload: "query" }),
    ).rejects.toBeInstanceOf(ApiAuthorizationError);
    await expect(
      boundary.submitProcess("api.process", { payload: "process" }, "process-1"),
    ).rejects.toBeInstanceOf(ApiAuthorizationError);
    expect(calls).toEqual(["authorization", "authorization", "authorization"]);
  });

  it("returns exposed command/query/process result channels", async () => {
    const boundary = createProductionApiBoundary({
      requestValidation: request => ({ valid: true, request }),
      authorization: () => ({ allowed: true }),
      commandHandler: request => ({ echoed: request }),
      queryHandler: request => ({ echoed: request }),
      processHandler: (request, processId) => ({ id: processId, kind: "generation", request }),
      processBoundary: new InMemoryLongRunningProcessBoundary(),
    });

    const command = await boundary.executeCommand("api.command", { payload: "command" });
    const query = await boundary.executeQuery("api.query", { payload: "query" });
    const process = await boundary.submitProcess("api.process", { payload: "process" }, "process-1");

    expect(command).toMatchObject({
      channel: "command-result",
      contractId: "api.command",
      value: { echoed: { payload: "command" } },
    });
    expect(command.replayed).toBe(false);
    expect(query).toEqual({
      channel: "query-result",
      contractId: "api.query",
      value: { echoed: { payload: "query" } },
    });
    expect(process).toMatchObject({
      channel: "process-result",
      contractId: "api.process",
      process: {
        id: "process-1",
        kind: "generation",
        phase: "submitted",
        status: "submitted",
        cancellationRequested: false,
      },
    });
    expect(process.replayed).toBe(false);
  });

  it("validates and authorizes process result exposure before reading the process", async () => {
    const calls: string[] = [];
    const boundary = createProductionApiBoundary({
      requestValidation: request => {
        calls.push("validation");
        return request === "forbidden-process"
          ? { valid: false, issues: [{ code: "invalid-process", message: "invalid process" }] }
          : { valid: true, request };
      },
      authorization: () => {
        calls.push("authorization");
        return { allowed: false, reason: "forbidden" };
      },
      processBoundary: new InMemoryLongRunningProcessBoundary(),
    });

    await expect(boundary.processResult("forbidden-process")).rejects.toBeInstanceOf(
      ApiRequestValidationError,
    );
    await expect(boundary.processResult("denied-process")).rejects.toBeInstanceOf(
      ApiAuthorizationError,
    );
    expect(calls).toEqual(["validation", "validation", "authorization"]);
  });

  it("replays idempotent process submissions and rejects conflicting identities", async () => {
    let executions = 0;
    const boundary = createProductionApiBoundary({
      requestValidation: request => ({ valid: true, request }),
      authorization: () => ({ allowed: true }),
      processHandler: (request, processId) => {
        executions += 1;
        return { id: processId, kind: "generation", request };
      },
      processBoundary: new InMemoryLongRunningProcessBoundary(),
      idempotency: new InMemoryApiIdempotencyStore(),
    });

    const first = await boundary.submitProcess(
      "api.process",
      { payload: "same" },
      "process-idempotent",
      { idempotencyKey: "process-request-1" },
    );
    const second = await boundary.submitProcess(
      "api.process",
      { payload: "same" },
      "process-idempotent",
      { idempotencyKey: "process-request-1" },
    );

    expect(second.process).toEqual(first.process);
    expect(second.replayed).toBe(true);
    expect(executions).toBe(1);

    await expect(
      boundary.submitProcess(
        "api.process",
        { payload: "different" },
        "process-conflict",
        { idempotencyKey: "process-request-1" },
      ),
    ).rejects.toBeInstanceOf(ApiIdempotencyConflictError);
    expect(executions).toBe(1);
  });

  it("replays idempotent command submissions without invoking handlers twice", async () => {
    let executions = 0;
    const boundary = createProductionApiBoundary({
      requestValidation: request => ({ valid: true, request }),
      authorization: () => ({ allowed: true }),
      commandHandler: request => {
        executions += 1;
        return { echoed: request };
      },
      idempotency: new InMemoryApiIdempotencyStore(),
    });

    const first = await boundary.executeCommand(
      "api.command",
      { payload: "same" },
      { idempotencyKey: "request-1" },
    );
    const second = await boundary.executeCommand(
      "api.command",
      { payload: "same" },
      { idempotencyKey: "request-1" },
    );

    expect(second).toMatchObject({
      channel: "command-result",
      contractId: "api.command",
      value: first.value,
    });
    expect(executions).toBe(1);
    expect(first.replayed).toBe(false);
    expect(second.replayed).toBe(true);
  });
});

describe("[task:P2.3] [integration] production API boundary contracts", () => {
  it("keeps request validation, authorization, idempotency, and result exposure at the API boundary", async () => {
    const boundary = createProductionApiBoundary({
      requestValidation: request => ({ valid: true, request }),
      authorization: () => ({ allowed: true }),
      commandHandler: request => ({ echoed: request }),
      idempotency: new InMemoryApiIdempotencyStore(),
    });

    const result = await boundary.executeCommand(
      "api.command",
      { payload: "contract" },
      { idempotencyKey: "contract-1" },
    );
    expect(result).toMatchObject({
      channel: "command-result",
      contractId: "api.command",
      value: { echoed: { payload: "contract" } },
    });
    expect(Object.keys(result).sort()).toEqual([
      "channel",
      "contractId",
      "replayed",
      "value",
    ]);
  });

  it("[cross-system] returns process result exposure through the long-running process boundary", async () => {
    const processBoundary = new InMemoryLongRunningProcessBoundary<{ echoed: unknown }>();
    const boundary = createProductionApiBoundary({
      requestValidation: request => ({ valid: true, request }),
      authorization: () => ({ allowed: true }),
      processHandler: (request, processId) => ({ id: processId, kind: "generation", request }),
      processBoundary,
    });

    const submitted = await boundary.submitProcess(
      "api.process",
      { payload: "process" },
      "process-2",
    );
    expect(submitted.channel).toBe("process-result");
    await processBoundary.markRunning("process-2");
    await processBoundary.complete("process-2", {
      status: "succeeded",
      value: { echoed: { payload: "process" } },
    });
    expect(await boundary.processResult("process-2")).toEqual({
      channel: "process-result",
      contractId: "api.process",
      result: { status: "succeeded", value: { echoed: { payload: "process" } } },
    });
  });
});

describe("[task:P2.3] [regression] production API boundary contract registration", () => {
  it("keeps API boundary contracts primitive-only and Domain-free", () => {
    const entry = fileURLToPath(new URL("../../src/http/productionApiBoundary.ts", import.meta.url));
    expect(domainImports(entry)).toEqual([]);
    for (const contract of apiBoundaryContracts) {
      expect(Object.keys(contract)).toEqual(
        expect.arrayContaining([
          "authorization",
          "effect",
          "id",
          "idempotency",
          "kind",
          "resultChannel",
          "validation",
        ]),
      );
    }
  });
});
