import type {
  ApplicationCommandContract,
  ApplicationQueryContract,
} from "../application/commandQueryBoundary";
import { applicationCapabilityBoundaries } from "../application/commandQueryBoundary";
import type {
  LongRunningProcessIdentity,
  LongRunningProcessResult,
  LongRunningProcessSnapshot,
} from "../application/longRunningProcessBoundary";
import { longRunningProcessContracts } from "../application/longRunningProcessBoundary";

export type ApiBoundaryKind = "command" | "query" | "process";
export type ApiBoundaryEffect = "mutation" | "read" | "async";
export type ApiResultChannel = "command-result" | "query-result" | "process-result";
export type ApiRequestValidationPolicy = "required";
export type ApiAuthorizationPolicy = "required";
export type ApiIdempotencyPolicy = "required" | "supported" | "not-applicable";

export interface ApiBoundaryPolicy {
  readonly validation: ApiRequestValidationPolicy;
  readonly authorization: ApiAuthorizationPolicy;
  readonly idempotency: ApiIdempotencyPolicy;
}

export type ApiApplicationBoundaryContract = (
  | ApplicationCommandContract
  | ApplicationQueryContract
) &
  ApiBoundaryPolicy;

export interface ApiProcessBoundaryContract extends ApiBoundaryPolicy {
  readonly id: string;
  readonly kind: "process";
  readonly effect: "async";
  readonly resultChannel: "process-result";
}

export type ApiBoundaryContract =
  | ApiApplicationBoundaryContract
  | ApiProcessBoundaryContract;

const requiredPolicy: ApiBoundaryPolicy = Object.freeze({
  validation: "required",
  authorization: "required",
  idempotency: "supported",
});

const queryPolicy: ApiBoundaryPolicy = Object.freeze({
  validation: "required",
  authorization: "required",
  idempotency: "not-applicable",
});

const processPolicy: ApiBoundaryPolicy = Object.freeze({
  validation: "required",
  authorization: "required",
  idempotency: "required",
});

const applicationApiContracts: readonly ApiApplicationBoundaryContract[] =
  Object.freeze(
    Object.values(applicationCapabilityBoundaries).flatMap(boundary => [
      ...boundary.commands.map(contract => ({
        ...contract,
        ...requiredPolicy,
      })),
      ...boundary.queries.map(contract => ({
        ...contract,
        ...queryPolicy,
      })),
    ]),
  );

const processApiContracts: readonly ApiProcessBoundaryContract[] = Object.freeze(
  longRunningProcessContracts.map(contract => ({
    id: contract.id,
    kind: "process" as const,
    effect: "async" as const,
    resultChannel: "process-result" as const,
    ...processPolicy,
  })),
);

export const apiBoundaryContracts: readonly ApiBoundaryContract[] = Object.freeze([
  ...applicationApiContracts,
  ...processApiContracts,
]);

const aliasCommand = applicationApiContracts.find(contract => contract.kind === "command");
const aliasQuery = applicationApiContracts.find(contract => contract.kind === "query");
const aliasProcess = processApiContracts[0];

if (!aliasCommand || !aliasQuery || !aliasProcess) {
  throw new Error("production API boundary aliases are unavailable");
}

const apiBoundaryAliases: Readonly<Record<string, ApiBoundaryContract>> = Object.freeze({
  "api.command": aliasCommand,
  "api.query": aliasQuery,
  "api.process": aliasProcess,
});

export function getApiBoundaryContract(id: string): ApiBoundaryContract {
  const alias = apiBoundaryAliases[id];
  if (alias) return alias;
  const contract = apiBoundaryContracts.find(candidate => candidate.id === id);
  if (!contract) throw new Error(`unknown production API boundary contract: ${id}`);
  return contract;
}

export interface ApiRequestValidationIssue {
  readonly code: string;
  readonly message: string;
}

export type ApiRequestValidationResult<TRequest> =
  | { readonly valid: true; readonly request: TRequest }
  | { readonly valid: false; readonly issues: readonly ApiRequestValidationIssue[] };

export type ApiRequestValidator<TRequest> = (
  input: unknown,
) => ApiRequestValidationResult<TRequest>;

export interface ApiAuthorizationContext<TRequest> {
  readonly requestId: string;
  readonly request: TRequest;
}

export type ApiAuthorizationDecision =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly reason: string };

export type ApiAuthorizationHook<TRequest> = (
  context: ApiAuthorizationContext<TRequest>,
) => ApiAuthorizationDecision | Promise<ApiAuthorizationDecision>;

export interface ApiCommandResult<TValue> {
  readonly channel: "command-result";
  readonly contractId: string;
  readonly value: TValue;
  readonly replayed: boolean;
}

export interface ApiQueryResult<TValue> {
  readonly channel: "query-result";
  readonly contractId: string;
  readonly value: TValue;
}

export interface ApiProcessSubmissionResult<TValue> {
  readonly channel: "process-result";
  readonly contractId: string;
  readonly process: LongRunningProcessSnapshot<TValue>;
  readonly replayed: boolean;
}

export interface ApiProcessResultExposure<TValue> {
  readonly channel: "process-result";
  readonly contractId: string;
  readonly result: LongRunningProcessResult<TValue>;
}

export interface ApiExecutionOptions {
  readonly idempotencyKey?: string;
}

export type ApiProcessSubmission = LongRunningProcessIdentity & {
  readonly [key: string]: unknown;
};

export interface ApiProcessBoundary<TValue = unknown> {
  submit(identity: LongRunningProcessIdentity): Promise<LongRunningProcessSnapshot<TValue>>;
  result(id: string): Promise<LongRunningProcessResult<TValue>>;
}

export interface ApiIdempotencyStore {
  run<TValue>(
    key: string,
    execute: () => Promise<TValue>,
    fingerprint?: string,
  ): Promise<{ readonly value: TValue; readonly replayed: boolean }>;
}

interface IdempotencyEntry {
  readonly fingerprint: string | undefined;
  readonly promise: Promise<unknown>;
}

export class ApiIdempotencyConflictError extends Error {
  constructor(key: string) {
    super(`idempotency key ${key} is already reserved for a different request`);
    this.name = "ApiIdempotencyConflictError";
  }
}

export class InMemoryApiIdempotencyStore implements ApiIdempotencyStore {
  private readonly entries = new Map<string, IdempotencyEntry>();

  async run<TValue>(
    key: string,
    execute: () => Promise<TValue>,
    fingerprint?: string,
  ): Promise<{ readonly value: TValue; readonly replayed: boolean }> {
    const normalizedKey = key.trim();
    if (normalizedKey.length === 0) throw new Error("idempotency key is required");
    const existing = this.entries.get(normalizedKey);
    if (existing) {
      if (existing.fingerprint !== fingerprint) {
        throw new ApiIdempotencyConflictError(normalizedKey);
      }
      return { value: (await existing.promise) as TValue, replayed: true };
    }

    const pending = execute();
    this.entries.set(normalizedKey, { fingerprint, promise: pending });
    try {
      return { value: await pending, replayed: false };
    } catch (error) {
      this.entries.delete(normalizedKey);
      throw error;
    }
  }
}

export class ApiRequestValidationError extends Error {
  readonly issues: readonly ApiRequestValidationIssue[];

  constructor(issues: readonly ApiRequestValidationIssue[]) {
    super("API request validation failed");
    this.name = "ApiRequestValidationError";
    this.issues = issues;
  }
}

export class ApiAuthorizationError extends Error {
  readonly reason: string;

  constructor(reason: string) {
    super(`API authorization failed: ${reason}`);
    this.name = "ApiAuthorizationError";
    this.reason = reason;
  }
}

export interface ProductionApiBoundaryOptions<TRequest, TCommandValue, TQueryValue, TProcessValue> {
  readonly requestValidation: ApiRequestValidator<TRequest>;
  readonly authorization: ApiAuthorizationHook<TRequest>;
  readonly commandHandler?: (
    request: TRequest,
    context: ApiAuthorizationContext<TRequest>,
  ) => TCommandValue | Promise<TCommandValue>;
  readonly queryHandler?: (
    request: TRequest,
    context: ApiAuthorizationContext<TRequest>,
  ) => TQueryValue | Promise<TQueryValue>;
  readonly processHandler?: (
    request: TRequest,
    processId: string,
    context: ApiAuthorizationContext<TRequest>,
  ) => ApiProcessSubmission | Promise<ApiProcessSubmission>;
  readonly processBoundary?: ApiProcessBoundary<TProcessValue>;
  readonly idempotency?: ApiIdempotencyStore;
}

export class ProductionApiBoundary<
  TRequest = unknown,
  TCommandValue = unknown,
  TQueryValue = unknown,
  TProcessValue = unknown,
> {
  private readonly options: ProductionApiBoundaryOptions<
    TRequest,
    TCommandValue,
    TQueryValue,
    TProcessValue
  >;
  private readonly idempotency: ApiIdempotencyStore;

  constructor(
    options: ProductionApiBoundaryOptions<TRequest, TCommandValue, TQueryValue, TProcessValue>,
  ) {
    this.options = options;
    this.idempotency = options.idempotency ?? new InMemoryApiIdempotencyStore();
  }

  async executeCommand(
    contractId: string,
    input: unknown,
    options: ApiExecutionOptions = {},
  ): Promise<ApiCommandResult<TCommandValue>> {
    this.requireContract(contractId, "command");
    const context = await this.prepare(contractId, input);
    const execute = async () => {
      if (!this.options.commandHandler) throw new Error("command handler is required");
      return this.options.commandHandler(context.request, context);
    };
    const outcome =
      options.idempotencyKey === undefined
        ? { value: await execute(), replayed: false }
        : await this.idempotency.run(
            options.idempotencyKey,
            execute,
            requestFingerprint(contractId, input),
          );
    return {
      channel: "command-result",
      contractId,
      value: outcome.value,
      replayed: outcome.replayed,
    };
  }

  async executeQuery(
    contractId: string,
    input: unknown,
  ): Promise<ApiQueryResult<TQueryValue>> {
    this.requireContract(contractId, "query");
    const context = await this.prepare(contractId, input);
    return {
      channel: "query-result",
      contractId,
      value: await this.requireQueryHandler()(context.request, context),
    };
  }

  async submitProcess(
    contractId: string,
    input: unknown,
    processId: string,
    options: ApiExecutionOptions = {},
  ): Promise<ApiProcessSubmissionResult<TProcessValue>> {
    this.requireContract(contractId, "process");
    const context = await this.prepare(contractId, input);
    const processBoundary = this.options.processBoundary;
    if (!processBoundary) throw new Error("process boundary is required");
    if (!this.options.processHandler) throw new Error("process handler is required");
    const execute = async () => {
      const submission = await this.options.processHandler!(
        context.request,
        processId,
        context,
      );
      return processBoundary.submit(submission);
    };
    const idempotencyKey = options.idempotencyKey ?? `process:${processId}`;
    const outcome = await this.idempotency.run(
      idempotencyKey,
      execute,
      requestFingerprint(contractId, input, processId),
    );
    return {
      channel: "process-result",
      contractId,
      process: outcome.value,
      replayed: outcome.replayed,
    };
  }

  async processResult(
    processId: string,
  ): Promise<ApiProcessResultExposure<TProcessValue>> {
    this.requireContract("api.process", "process");
    await this.prepare("api.process", processId);
    const processBoundary = this.options.processBoundary;
    if (!processBoundary) throw new Error("process boundary is required");
    return {
      channel: "process-result",
      contractId: "api.process",
      result: await processBoundary.result(processId),
    };
  }

  private requireQueryHandler(): NonNullable<
    ProductionApiBoundaryOptions<TRequest, TCommandValue, TQueryValue, TProcessValue>["queryHandler"]
  > {
    if (!this.options.queryHandler) throw new Error("query handler is required");
    return this.options.queryHandler;
  }

  private requireContract(contractId: string, kind: ApiBoundaryKind): void {
    const contract = getApiBoundaryContract(contractId);
    if (contract.kind !== kind) {
      throw new Error(`production API boundary contract ${contractId} is not a ${kind}`);
    }
  }

  private async prepare(
    contractId: string,
    input: unknown,
  ): Promise<ApiAuthorizationContext<TRequest>> {
    const validation = this.options.requestValidation(input);
    if (!validation.valid) throw new ApiRequestValidationError(validation.issues);
    const context: ApiAuthorizationContext<TRequest> = {
      requestId: `${contractId}:${crypto.randomUUID()}`,
      request: validation.request,
    };
    const decision = await this.options.authorization(context);
    if (!decision.allowed) throw new ApiAuthorizationError(decision.reason);
    return context;
  }
}

function requestFingerprint(...parts: readonly unknown[]): string {
  return JSON.stringify(parts);
}

export function createProductionApiBoundary<
  TRequest = unknown,
  TCommandValue = unknown,
  TQueryValue = unknown,
  TProcessValue = unknown,
>(
  options: ProductionApiBoundaryOptions<TRequest, TCommandValue, TQueryValue, TProcessValue>,
): ProductionApiBoundary<TRequest, TCommandValue, TQueryValue, TProcessValue> {
  return new ProductionApiBoundary(options);
}
