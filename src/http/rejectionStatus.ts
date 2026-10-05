import {
  RateLimitError,
  ResourceIsolationError,
  SecretAccessError,
  SecurityAuthenticationError,
  SecurityAuthorizationError,
} from "../platform/securityBoundary";
import { ApiRequestValidationError } from "./productionApiBoundary";

export type RejectionStatus = 400 | 401 | 403 | 429;

/**
 * Translates platform rejections into their HTTP status at the boundary. The
 * error types keep their domain meaning; only the transport status is derived
 * here, so no domain semantics are redefined.
 */
export function rejectionStatus(error: unknown): RejectionStatus | undefined {
  if (error instanceof SecurityAuthenticationError) return 401;
  if (error instanceof ResourceIsolationError) return 403;
  if (error instanceof SecurityAuthorizationError) return 403;
  if (error instanceof SecretAccessError) return 403;
  if (error instanceof RateLimitError) return 429;
  if (error instanceof ApiRequestValidationError) return 400;
  return undefined;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "request rejected";
}

/**
 * Response bodies name the rejected workspace or action only; secret values
 * are never part of a platform rejection message. The body keeps the default
 * Fastify error shape (`statusCode` / `error` / `message`) so existing clients
 * keep reading the same fields.
 */
export function rejectionPayload(error: unknown, status: RejectionStatus): Record<string, unknown> {
  if (error instanceof ApiRequestValidationError) {
    return { error: "Bad Request", details: error.issues };
  }
  const label =
    status === 401
      ? "Unauthorized"
      : status === 403
        ? "Forbidden"
        : status === 429
          ? "Too Many Requests"
          : "Bad Request";
  return { statusCode: status, error: label, message: messageOf(error) };
}
