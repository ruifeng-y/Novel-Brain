export interface ObservabilityBoundaryContract {
  readonly id: "platform.observability.boundary";
  readonly owner: "operational-platform";
  readonly structuredLogging: "required";
  readonly metrics: "required";
  readonly tracing: "required";
  readonly health: readonly ["liveness", "readiness"];
  readonly auditCorrelation: readonly ["run", "attempt", "commit", "recall"];
  readonly changesNovelDomain: false;
}

export const observabilityBoundaryContract: ObservabilityBoundaryContract = Object.freeze({
  id: "platform.observability.boundary",
  owner: "operational-platform",
  structuredLogging: "required",
  metrics: "required",
  tracing: "required",
  health: Object.freeze(["liveness", "readiness"] as const),
  auditCorrelation: Object.freeze(["run", "attempt", "commit", "recall"] as const),
  changesNovelDomain: false,
});

export interface ObservabilityCorrelation {
  readonly requestId: string;
  readonly traceId: string;
  readonly auditId: string;
  readonly runId?: string;
  readonly attemptId?: string;
  readonly commitId?: string;
  readonly recallId?: string;
}

export type LogLevel = "debug" | "info" | "warn" | "error";
export type MetricUnit = "count" | "milliseconds" | "bytes";
export type HealthStatus = "healthy" | "degraded" | "unhealthy";
export type AuditSubjectKind = "run" | "attempt" | "commit" | "recall";

interface ObservabilityEventBase {
  readonly id: string;
  readonly occurredAt: Date;
  readonly correlation: ObservabilityCorrelation;
}

export interface StructuredLogEvent extends ObservabilityEventBase {
  readonly kind: "log";
  readonly level: LogLevel;
  readonly message: string;
  readonly fields: Readonly<Record<string, unknown>>;
}

export interface MetricEvent extends ObservabilityEventBase {
  readonly kind: "metric";
  readonly name: string;
  readonly value: number;
  readonly unit: MetricUnit;
}

export interface TraceStartEvent extends ObservabilityEventBase {
  readonly kind: "trace-start";
  readonly operation: string;
  readonly spanId: string;
}

export interface TraceEndEvent extends ObservabilityEventBase {
  readonly kind: "trace-end";
  readonly operation: string;
  readonly spanId: string;
  readonly status: "ok" | "error";
  readonly error?: string;
}

export interface HealthEvent extends ObservabilityEventBase {
  readonly kind: "health";
  readonly liveness: HealthStatus;
  readonly readiness: HealthStatus;
  readonly checks: Readonly<Record<string, HealthStatus>>;
}

export interface AuditEvent extends ObservabilityEventBase {
  readonly kind: "audit";
  readonly subjectKind: AuditSubjectKind;
  readonly subjectId: string;
}

export type ObservabilityEvent =
  | StructuredLogEvent
  | MetricEvent
  | TraceStartEvent
  | TraceEndEvent
  | HealthEvent
  | AuditEvent;

type ObservabilityEventPayload =
  | Omit<StructuredLogEvent, keyof ObservabilityEventBase>
  | Omit<MetricEvent, keyof ObservabilityEventBase>
  | Omit<TraceStartEvent, keyof ObservabilityEventBase>
  | Omit<TraceEndEvent, keyof ObservabilityEventBase>
  | Omit<HealthEvent, keyof ObservabilityEventBase>
  | Omit<AuditEvent, keyof ObservabilityEventBase>;

export interface StructuredLogInput {
  readonly level: LogLevel;
  readonly message: string;
  readonly fields?: Readonly<Record<string, unknown>>;
}

export interface MetricInput {
  readonly name: string;
  readonly value: number;
  readonly unit: MetricUnit;
}

export interface HealthInput {
  readonly liveness: HealthStatus;
  readonly readiness: HealthStatus;
  readonly checks: Readonly<Record<string, HealthStatus>>;
}

export interface AuditSubject {
  readonly kind: AuditSubjectKind;
  readonly id: string;
}

export interface PlatformObservabilityBoundaryOptions {
  readonly sink: (event: ObservabilityEvent) => void;
  readonly now: () => Date;
  readonly idGenerator: () => string;
}

export class PlatformObservabilityBoundary {
  private readonly options: PlatformObservabilityBoundaryOptions;
  private nextSpan = 0;

  constructor(options: PlatformObservabilityBoundaryOptions) {
    this.options = options;
  }

  log(correlation: ObservabilityCorrelation, input: StructuredLogInput): void {
    this.emit(
      {
        kind: "log",
        level: input.level,
        message: input.message,
        fields: input.fields ?? {},
      },
      correlation,
    );
  }

  metric(correlation: ObservabilityCorrelation, input: MetricInput): void {
    this.emit(
      {
        kind: "metric",
        name: input.name,
        value: input.value,
        unit: input.unit,
      },
      correlation,
    );
  }

  health(correlation: ObservabilityCorrelation, input: HealthInput): void {
    this.emit(
      {
        kind: "health",
        liveness: input.liveness,
        readiness: input.readiness,
        checks: input.checks,
      },
      correlation,
    );
  }

  audit(correlation: ObservabilityCorrelation, subject: AuditSubject): void {
    const correlatedId =
      subject.kind === "run"
        ? correlation.runId
        : subject.kind === "attempt"
          ? correlation.attemptId
          : subject.kind === "commit"
            ? correlation.commitId
            : correlation.recallId;
    if (!correlatedId || correlatedId !== subject.id) {
      throw new Error(`audit subject ${subject.kind} does not match correlation identity`);
    }

    this.emit(
      {
        kind: "audit",
        subjectKind: subject.kind,
        subjectId: subject.id,
      },
      correlation,
    );
  }

  async trace<T>(
    correlation: ObservabilityCorrelation,
    operation: string,
    execute: () => T | Promise<T>,
  ): Promise<T> {
    const spanId = `span-${++this.nextSpan}`;
    this.emit({ kind: "trace-start", operation, spanId }, correlation);
    try {
      const value = await execute();
      this.emit({ kind: "trace-end", operation, spanId, status: "ok" }, correlation);
      return value;
    } catch (error) {
      this.emit(
        {
          kind: "trace-end",
          operation,
          spanId,
          status: "error",
          error: error instanceof Error ? error.message : String(error),
        },
        correlation,
      );
      throw error;
    }
  }

  private emit(
    event: ObservabilityEventPayload,
    correlation: ObservabilityCorrelation,
  ): void {
    this.options.sink({
      ...event,
      id: this.options.idGenerator(),
      occurredAt: this.options.now(),
      correlation,
    } as ObservabilityEvent);
  }
}

export function createPlatformObservabilityBoundary(
  options: PlatformObservabilityBoundaryOptions,
): PlatformObservabilityBoundary {
  return new PlatformObservabilityBoundary(options);
}
