import type { PlatformSecurityBoundary } from "../platform/securityBoundary";
import type {
  AuditSubjectKind,
  ObservabilityCorrelation,
  PlatformObservabilityBoundary,
} from "../platform/observabilityBoundary";
import { canonicalJson, hashContent } from "../shared/domain/contentHash";
import {
  ApiRequestValidationError,
  InMemoryApiIdempotencyStore,
  type ApiRequestValidator,
} from "./productionApiBoundary";
import { getApiBoundaryContract } from "./productionApiBoundary";

export interface HttpRequestPrincipal {
  readonly subjectId: string;
  readonly workspaceId: string;
}

export interface HttpBoundaryContext {
  readonly requestId: string;
  readonly principal: HttpRequestPrincipal;
  readonly resource: { readonly kind: string; readonly id: string };
  readonly correlation: ObservabilityCorrelation;
}

export interface HttpBoundaryPipeline {
  execute<TValue>(
    contractId: string,
    context: HttpBoundaryContext,
    input: unknown,
    handler: (validated: unknown) => Promise<TValue>,
  ): Promise<TValue>;
}

export interface HttpBoundaryPipelineOptions {
  readonly security: PlatformSecurityBoundary;
  readonly observability: PlatformObservabilityBoundary;
  readonly validators: ReadonlyMap<string, ApiRequestValidator<unknown>>;
}

const auditSubjectKinds = new Set<AuditSubjectKind>(["run", "attempt", "commit", "recall"]);

function isAuditSubjectKind(value: string): value is AuditSubjectKind {
  return auditSubjectKinds.has(value as AuditSubjectKind);
}

export function createHttpBoundaryPipeline(
  options: HttpBoundaryPipelineOptions,
): HttpBoundaryPipeline {
  const idempotency = new InMemoryApiIdempotencyStore();

  return {
    async execute<TValue>(
      contractId: string,
      context: HttpBoundaryContext,
      input: unknown,
      handler: (validated: unknown) => Promise<TValue>,
    ): Promise<TValue> {
      const contract = getApiBoundaryContract(contractId);
      await options.security.protect({
        requestId: context.requestId,
        credentials: { token: context.principal.subjectId },
        action: {
          id: contract.id,
          operation: contract.kind,
          resource: {
            id: context.resource.id,
            kind: context.resource.kind as "workspace" | "run" | "attempt" | "commit" | "recall" | "secret",
            workspaceId: context.principal.workspaceId,
          },
        },
      });

      const validator = options.validators.get(contractId);
      if (!validator) throw new Error(`request validator is required: ${contractId}`);
      const validation = validator(input);
      if (!validation.valid) throw new ApiRequestValidationError(validation.issues);

      const execute = () => handler(validation.request);
      const outcome =
        contract.idempotency === "not-applicable"
          ? { value: await execute(), replayed: false }
          : await idempotency.run(
              `${contract.id}:${context.requestId}`,
              execute,
              hashContent(canonicalJson({ contractId: contract.id, input })),
            );

      const subjectKind = context.resource.kind;
      const correlatedId =
        subjectKind === "run"
          ? context.correlation.runId
          : subjectKind === "attempt"
            ? context.correlation.attemptId
            : subjectKind === "commit"
              ? context.correlation.commitId
              : subjectKind === "recall"
                ? context.correlation.recallId
                : undefined;
      if (isAuditSubjectKind(subjectKind) && correlatedId === context.resource.id) {
        options.observability.audit(context.correlation, {
          kind: subjectKind,
          id: context.resource.id,
        });
      } else {
        options.observability.log(context.correlation, {
          level: "info",
          message: "http boundary executed",
          fields: {
            contractId: contract.id,
            resourceKind: context.resource.kind,
            resourceId: context.resource.id,
            replayed: outcome.replayed,
          },
        });
      }

      return outcome.value;
    },
  };
}
