export interface SecurityBoundaryContract {
  readonly id: "platform.security.boundary";
  readonly owner: "platform-security";
  readonly authentication: "required";
  readonly authorization: "required";
  readonly resourceIsolation: "required";
  readonly secretManagement: "platform-security";
  readonly rateLimiting: "platform-security";
  readonly abuseProtection: "platform-security";
  readonly novelDomainOwnership: false;
}

export const securityBoundaryContract: SecurityBoundaryContract = Object.freeze({
  id: "platform.security.boundary",
  owner: "platform-security",
  authentication: "required",
  authorization: "required",
  resourceIsolation: "required",
  secretManagement: "platform-security",
  rateLimiting: "platform-security",
  abuseProtection: "platform-security",
  novelDomainOwnership: false,
});

export type SecurityOperation = "command" | "query" | "process" | "secret";
export type SecurityResourceKind = "workspace" | "run" | "attempt" | "commit" | "recall" | "secret";

export interface SecurityCredentials {
  readonly token: string;
}

export interface SecurityPrincipal {
  readonly id: string;
  readonly accountId: string;
  readonly workspaceId: string;
  readonly roles: readonly string[];
}

export interface SecurityResource {
  readonly id: string;
  readonly kind: SecurityResourceKind;
  readonly workspaceId: string;
}

export interface SecurityAction {
  readonly id: string;
  readonly operation: SecurityOperation;
  readonly resource: SecurityResource;
}

export interface SecurityRequest {
  readonly requestId: string;
  readonly credentials: SecurityCredentials;
  readonly action: SecurityAction;
}

export interface AuthenticationInput {
  readonly requestId: string;
  readonly credentials: SecurityCredentials;
}

export type AuthenticationDecision =
  | { readonly authenticated: true; readonly principal: SecurityPrincipal }
  | { readonly authenticated: false; readonly reason: string };

export interface AuthenticationHook {
  authenticate(input: AuthenticationInput): AuthenticationDecision | Promise<AuthenticationDecision>;
}

export interface AuthorizationInput {
  readonly requestId: string;
  readonly principal: SecurityPrincipal;
  readonly action: SecurityAction;
}

export interface AuthorizationDecision {
  readonly allowed: boolean;
  readonly reason?: string;
}

export interface AuthorizationHook {
  authorize(input: AuthorizationInput): AuthorizationDecision | Promise<AuthorizationDecision>;
}

export interface ResourceIsolationInput {
  readonly requestId: string;
  readonly principal: SecurityPrincipal;
  readonly resource: SecurityResource;
}

export interface ResourceIsolationDecision {
  readonly allowed: boolean;
  readonly reason?: string;
}

export interface ResourceIsolationHook {
  inspect(input: ResourceIsolationInput): ResourceIsolationDecision | Promise<ResourceIsolationDecision>;
}

export interface SecretReference {
  readonly key: string;
  readonly workspaceId: string;
}

export interface SecretAccessInput {
  readonly requestId: string;
  readonly principal: SecurityPrincipal;
  readonly reference: SecretReference;
}

export interface SecretProvider {
  resolve(input: SecretAccessInput): Promise<string>;
}

export interface RateLimitRequest {
  readonly key: string;
  readonly limit: number;
}

export interface RateLimitDecision {
  readonly allowed: boolean;
  readonly remaining: number;
  readonly resetAt: Date;
}

export interface RateLimiter {
  readonly limit: number;
  consume(input: RateLimitRequest): RateLimitDecision | Promise<RateLimitDecision>;
}

export interface PlatformSecurityBoundaryOptions {
  readonly authentication: AuthenticationHook;
  readonly authorization: AuthorizationHook;
  readonly resourceIsolation: ResourceIsolationHook;
  readonly secrets: SecretProvider;
  readonly rateLimiter: RateLimiter;
}

export interface SecurityPermit {
  readonly requestId: string;
  readonly principal: SecurityPrincipal;
  readonly action: SecurityAction;
  readonly rateLimit: RateLimitDecision;
}

export class SecurityAuthenticationError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "SecurityAuthenticationError";
  }
}

export class SecurityAuthorizationError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "SecurityAuthorizationError";
  }
}

export class ResourceIsolationError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "ResourceIsolationError";
  }
}

export class SecretAccessError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "SecretAccessError";
  }
}

export class RateLimitError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "RateLimitError";
  }
}

export class PlatformSecurityBoundary {
  private readonly options: PlatformSecurityBoundaryOptions;

  constructor(options: PlatformSecurityBoundaryOptions) {
    this.options = options;
  }

  async protect(request: SecurityRequest): Promise<SecurityPermit> {
    const rateLimit = await this.options.rateLimiter.consume({
      key: `${request.credentials.token}:${request.action.id}`,
      limit: this.options.rateLimiter.limit,
    });
    if (!rateLimit.allowed) {
      throw new RateLimitError(`rate limit exceeded for ${request.action.id}`);
    }

    const authentication = await this.options.authentication.authenticate({
      requestId: request.requestId,
      credentials: request.credentials,
    });
    if (!authentication.authenticated) {
      throw new SecurityAuthenticationError(authentication.reason);
    }

    const principal = authentication.principal;
    const isolation = await this.options.resourceIsolation.inspect({
      requestId: request.requestId,
      principal,
      resource: request.action.resource,
    });
    if (!isolation.allowed) {
      throw new ResourceIsolationError(isolation.reason ?? "resource isolation denied");
    }

    const authorization = await this.options.authorization.authorize({
      requestId: request.requestId,
      principal,
      action: request.action,
    });
    if (!authorization.allowed) {
      throw new SecurityAuthorizationError(authorization.reason ?? "authorization denied");
    }

    return {
      requestId: request.requestId,
      principal,
      action: request.action,
      rateLimit,
    };
  }

  async resolveSecret(permit: SecurityPermit, reference: SecretReference): Promise<string> {
    if (
      permit.action.operation !== "secret" ||
      permit.action.resource.kind !== "secret" ||
      reference.workspaceId !== permit.action.resource.workspaceId ||
      reference.key !== permit.action.resource.id
    ) {
      throw new SecretAccessError("secret reference is outside the permitted scope");
    }
    return this.options.secrets.resolve({
      requestId: permit.requestId,
      principal: permit.principal,
      reference,
    });
  }
}

const sensitiveKey = /(?:api[-_]?key|authorization|credential|password|secret|token)/i;

export function redactSensitiveValues(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSensitiveValues);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, nested]) => [
        key,
        sensitiveKey.test(key) ? "[REDACTED]" : redactSensitiveValues(nested),
      ]),
    );
  }
  return value;
}

export function createPlatformSecurityBoundary(
  options: PlatformSecurityBoundaryOptions,
): PlatformSecurityBoundary {
  return new PlatformSecurityBoundary(options);
}
