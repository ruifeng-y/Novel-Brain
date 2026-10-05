import { describe, expect, it } from "vitest";
import {
  postgresPersistenceMappingBoundary,
  validatePostgresPersistenceMappingBoundary,
  type PostgresPersistenceMappingBoundary,
} from "../../src/shared/application/postgresPersistenceMapping";

describe("[task:P1.2] PostgreSQL persistence mapping boundary", () => {
  it("[domain] [regression] maps every P1.1 authoritative role without projections", () => {
    expect(postgresPersistenceMappingBoundary).toEqual({
      source: "canonical-persistence-mapping-contract",
      migrationCompatibility: "additive",
      rollbackRecovery: "transactional",
      projection: "excluded",
      mappings: {
        canonicalState: { storage: "CurrentObject", role: "canonical-state" },
        versionedSnapshot: { storage: "RevisionRecord", role: "versioned-snapshot" },
        eventAudit: { storage: "DomainEvent", role: "event-audit" },
        idempotencyReservation: {
          storage: "IdempotencyReservation",
          role: "idempotency-reservation",
        },
      },
    });
    expect(() =>
      validatePostgresPersistenceMappingBoundary(postgresPersistenceMappingBoundary),
    ).not.toThrow();
  });

  it("[regression] rejects uncovered authoritative roles and projection participation", () => {
    const missingReservation = {
      ...postgresPersistenceMappingBoundary,
      mappings: {
        canonicalState: postgresPersistenceMappingBoundary.mappings.canonicalState,
        versionedSnapshot: postgresPersistenceMappingBoundary.mappings.versionedSnapshot,
        eventAudit: postgresPersistenceMappingBoundary.mappings.eventAudit,
      },
    } as unknown as PostgresPersistenceMappingBoundary;
    expect(() => validatePostgresPersistenceMappingBoundary(missingReservation)).toThrow(
      "PostgreSQL mapping is missing role: idempotency-reservation",
    );

    const projectionMapped = {
      ...postgresPersistenceMappingBoundary,
      projection: "mapped",
    } as unknown as PostgresPersistenceMappingBoundary;
    expect(() => validatePostgresPersistenceMappingBoundary(projectionMapped)).toThrow(
      "PostgreSQL mapping must exclude projections",
    );
  });
});
