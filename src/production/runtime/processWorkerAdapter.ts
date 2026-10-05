import type {
  ScheduledWorkOrder,
  WorkerAdapter,
  WorkerExecutionControl,
  WorkerExecutionResult,
} from "./schedulerWorkerBoundary";
import type { RuntimeAdapter } from "./runtimeAdapter";

export interface ProcessWorkerAdapterOptions {
  readonly runtime: RuntimeAdapter;
}

export class ProcessWorkerAdapter implements WorkerAdapter {
  private readonly runtime: RuntimeAdapter;

  constructor(options: ProcessWorkerAdapterOptions) {
    this.runtime = options.runtime;
  }

  async execute(
    order: ScheduledWorkOrder,
    control: WorkerExecutionControl,
  ): Promise<WorkerExecutionResult> {
    if (control.signal.aborted) {
      return { status: "cancelled", reason: "aborted before execution" };
    }

    try {
      const runtimeResult = await this.runtime.execute(order.runtimeRequest);
      return { status: "succeeded", runtimeResult };
    } catch (error) {
      return {
        status: "failed",
        error: {
          code: "runtime-error",
          message: error instanceof Error ? error.message : String(error),
          retryable: false,
        },
      };
    }
  }
}
