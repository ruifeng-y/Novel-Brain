import { describe, expect, expectTypeOf, it } from "vitest";
import type {
  CompareAndSwapRevisionedRepository,
  PersistenceTransaction,
  Repository,
  RevisionedRepository,
  UniqueRepository,
} from "../../src/shared/application/repository";

export interface CapabilityRecord {
  readonly id: string;
  readonly novelId: string;
  readonly state: {
    readonly label: string;
    readonly flags: readonly number[];
    readonly date?: Date;
    readonly value?: unknown;
  };
}

export interface CapabilityRevisionRecord {
  readonly id: string;
  readonly novelId: string;
  readonly currentRevisionId: string;
  readonly state: {
    readonly label: string;
    readonly flags: readonly number[];
    readonly date?: Date;
    readonly value?: unknown;
  };
}

export interface CapabilityRecordPort extends UniqueRepository<CapabilityRecord> {
  save(entity: CapabilityRecord): Promise<void>;
}

export interface CapabilityRevisionPort
  extends CompareAndSwapRevisionedRepository<CapabilityRevisionRecord> {
  save(entity: CapabilityRevisionRecord): Promise<void>;
  saveRevisionIfAbsent(entity: CapabilityRevisionRecord): Promise<void>;
}

export interface CapabilityRepositoryEnvironment {
  readonly records: CapabilityRecordPort;
  readonly revisions: CapabilityRevisionPort;
}

export interface CapabilityBusinessWork {
  readonly records: UniqueRepository<CapabilityRecord>;
  readonly revisions: CompareAndSwapRevisionedRepository<CapabilityRevisionRecord> & {
    saveRevisionIfAbsent(entity: CapabilityRevisionRecord): Promise<void>;
  };
  readonly otherRecords: UniqueRepository<CapabilityRecord>;
  readonly otherRevisions: CompareAndSwapRevisionedRepository<CapabilityRevisionRecord> & {
    saveRevisionIfAbsent(entity: CapabilityRevisionRecord): Promise<void>;
  };
}

export type CapabilityPersistenceWork = CapabilityBusinessWork;

export interface CapabilityPersistenceEnvironment {
  readonly transaction: PersistenceTransaction<CapabilityBusinessWork>;
  readonly external: CapabilityBusinessWork;
  readonly saveRevision: (work: CapabilityBusinessWork, entity: CapabilityRevisionRecord) => Promise<void>;
}

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

export function capabilityRecord(
  id: string,
  label = "initial",
  novelId = "novel-contract",
): CapabilityRecord {
  return {
    id,
    novelId,
    state: { label, flags: [1, 2] },
  };
}

export function capabilityRevision(
  id: string,
  revisionId: string,
  label = "initial",
  novelId = "novel-contract",
  value?: unknown,
): CapabilityRevisionRecord {
  const state =
    arguments.length >= 5
      ? { label, flags: [1, 2], value }
      : { label, flags: [1, 2] };
  return {
    id,
    novelId,
    currentRevisionId: revisionId,
    state,
  };
}

export function runCapabilityRepositoryContract(
  adapterName: string,
  createEnvironment: () => Promise<CapabilityRepositoryEnvironment>,
): void {
  describe(`${adapterName} capability repository contract`, () => {
    it("round-trips a capability record and lists it by novel", async () => {
      const environment = await createEnvironment();
      const input = capabilityRecord("record-1", "persisted");
      await environment.records.save(input);

      const loaded = await environment.records.findById("record-1");
      expect(loaded).toEqual(input);
      expect(await environment.records.listByNovel("novel-contract")).toEqual([input]);
      expect(await environment.records.findById("missing")).toBeUndefined();
    });

    it("isolates capability record snapshots from caller mutation", async () => {
      const environment = await createEnvironment();
      const input = capabilityRecord("record-isolated", "persisted");
      await environment.records.save(input);
      (input.state.flags as number[]).push(3);

      const loaded = await environment.records.findById("record-isolated");
      expect(loaded?.state.flags).toEqual([1, 2]);
      expect(() => (loaded?.state.flags as number[]).push(4)).toThrow();
    });

    it("keeps immutable revision history while advancing the current record", async () => {
      const environment = await createEnvironment();
      const first = capabilityRevision("revision-1", "rev-1", "first");
      const second = capabilityRevision("revision-1", "rev-2", "second");

      await environment.revisions.save(first);
      await environment.revisions.save(second);

      expect(await environment.revisions.findById("revision-1")).toEqual(second);
      expect(await environment.revisions.getRevision("revision-1", "rev-1")).toEqual(first);
      expect(await environment.revisions.getRevision("revision-1", "rev-2")).toEqual(second);
      expect(await environment.revisions.listByNovel("novel-contract")).toEqual([second]);
    });

    it("reserves plain capability record identity atomically", async () => {
      const environment = await createEnvironment();
      const original = capabilityRecord("record-unique", "original");
      await environment.records.saveIfAbsent(original);

      await expect(
        environment.records.saveIfAbsent(capabilityRecord("record-unique", "replacement")),
      ).rejects.toThrow("Record already exists: record-unique");
      expect(await environment.records.findById("record-unique")).toEqual(original);
    });

    it("compares the current revision before replacing a capability record", async () => {
      const environment = await createEnvironment();
      const original = capabilityRevision("revision-cas", "rev-1", "original");
      const next = capabilityRevision("revision-cas", "rev-2", "next");
      await environment.revisions.save(original);

      await expect(
        environment.revisions.saveIfCurrent("missing-rev", next),
      ).rejects.toThrow("CAS revision conflict: revision-cas");
      expect(await environment.revisions.findById("revision-cas")).toEqual(original);

      await environment.revisions.saveIfCurrent("rev-1", next);
      expect(await environment.revisions.findById("revision-cas")).toEqual(next);
    });

    it("treats semantically equal revision payloads as the same immutable revision", async () => {
      const environment = await createEnvironment();
      const first = {
        id: "revision-order",
        novelId: "novel-contract",
        currentRevisionId: "rev-1",
        state: { label: "same", flags: [1, 2] },
      } satisfies CapabilityRevisionRecord;
      const reordered = {
        state: { flags: [1, 2], label: "same" },
        currentRevisionId: "rev-1",
        novelId: "novel-contract",
        id: "revision-order",
      } satisfies CapabilityRevisionRecord;

      await environment.revisions.save(first);
      await expect(environment.revisions.save(reordered)).resolves.toBeUndefined();
      expect(await environment.revisions.getRevision("revision-order", "rev-1")).toEqual(first);
    });

    it("round-trips Date values consistently for records and revisions", async () => {
      const environment = await createEnvironment();
      const date = new Date("2026-10-04T04:45:00.000Z");
      const record = capabilityRecord("record-date", "date");
      const datedRecord = {
        ...record,
        state: { ...record.state, date },
      };
      const revision = capabilityRevision("revision-date", "rev-1", "date");
      const datedRevision = {
        ...revision,
        state: { ...revision.state, date },
      };

      await environment.records.save(datedRecord);
      await environment.revisions.save(datedRevision);

      const loadedRecord = await environment.records.findById("record-date");
      const loadedRevision = await environment.revisions.getRevision("revision-date", "rev-1");
      expect(loadedRecord?.state.date).toBeInstanceOf(Date);
      expect(loadedRecord?.state.date?.getTime()).toBe(date.getTime());
      expect(loadedRevision?.state.date).toBeInstanceOf(Date);
      expect(loadedRevision?.state.date?.getTime()).toBe(date.getTime());
    });

    it("validates every capability persistence write against the supported payload shape", async () => {
      const environment = await createEnvironment();
      const sparse = new Array(3);
      sparse[1] = "value";
      const unsupported: readonly unknown[] = [
        undefined,
        Number.NaN,
        -0,
        new Map([["key", "value"]]),
        new Set(["value"]),
        new (class UnsupportedValue {})(),
        { $date: "2026-10-04T00:00:00.000Z" },
        sparse,
      ];

      for (const [index, value] of unsupported.entries()) {
        const record = {
          ...capabilityRecord(`record-unsupported-${index}`),
          state: { label: "bad", flags: [1], value },
        };
        const revision = {
          ...capabilityRevision(`revision-unsupported-${index}`, "rev-1"),
          state: { label: "bad", flags: [1], value },
        };

        await expect(environment.records.save(record)).rejects.toThrow(
          "Unsupported persistence payload",
        );
        await expect(environment.records.saveIfAbsent(record)).rejects.toThrow(
          "Unsupported persistence payload",
        );
        await expect(environment.revisions.save(revision)).rejects.toThrow(
          "Unsupported persistence payload",
        );
        await expect(environment.revisions.saveRevisionIfAbsent(revision)).rejects.toThrow(
          "Unsupported persistence payload",
        );

        await environment.revisions.save(
          capabilityRevision(`revision-cas-unsupported-${index}`, "rev-1"),
        );
        await expect(
          environment.revisions.saveIfCurrent("rev-1", {
            ...revision,
            currentRevisionId: "rev-2",
          }),
        ).rejects.toThrow("Unsupported persistence payload");
      }
    });

    it("rejects concurrent ordinary saves with different payloads for one immutable revision", async () => {
      const environment = await createEnvironment();
      const attempts = Array.from({ length: 12 }, (_, index) =>
        environment.revisions.save(
          capabilityRevision("revision-save-race", "rev-same", `payload-${index}`),
        ),
      );

      const results = await Promise.allSettled(attempts);
      expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      const rejected = results.filter(
        (result): result is PromiseRejectedResult => result.status === "rejected",
      );
      expect(rejected).toHaveLength(attempts.length - 1);
      expect((rejected[0]?.reason as Error).message).toBe(
        "Revision already exists: revision-save-race:rev-same",
      );
      const saved = await environment.revisions.getRevision(
        "revision-save-race",
        "rev-same",
      );
      expect(saved?.state.label).toMatch(/^payload-/);
    });

    it("treats concurrent ordinary saves of the same immutable payload as a no-op", async () => {
      const environment = await createEnvironment();
      const payload = capabilityRevision("revision-save-idempotent", "rev-same", "same");
      await Promise.all([
        environment.revisions.save({ ...payload }),
        environment.revisions.save({ ...payload }),
      ]);

      expect(await environment.revisions.getRevision("revision-save-idempotent", "rev-same")).toEqual(
        payload,
      );
    });

    it("allows exactly one winner for concurrent record identity reservations", async () => {
      const environment = await createEnvironment();
      const attempts = [
        environment.records.saveIfAbsent(capabilityRecord("record-race", "first")),
        environment.records.saveIfAbsent(capabilityRecord("record-race", "second")),
      ];

      const results = await Promise.allSettled(attempts);
      expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
      expect(await environment.records.findById("record-race")).toBeDefined();
    });

    it("allows exactly one winner for concurrent current revision comparisons", async () => {
      const environment = await createEnvironment();
      await environment.revisions.save(capabilityRevision("revision-race", "rev-1"));

      const attempts = [
        environment.revisions.saveIfCurrent(
          "rev-1",
          capabilityRevision("revision-race", "rev-a"),
        ),
        environment.revisions.saveIfCurrent(
          "rev-1",
          capabilityRevision("revision-race", "rev-b"),
        ),
      ];

      const results = await Promise.allSettled(attempts);
      expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      const rejected = results.filter(
        (result): result is PromiseRejectedResult => result.status === "rejected",
      );
      expect(rejected).toHaveLength(1);
      expect((rejected[0]?.reason as Error).message).toBe(
        "CAS revision conflict: revision-race",
      );

      const current = await environment.revisions.findById("revision-race");
      expect(["rev-a", "rev-b"]).toContain(current?.currentRevisionId);
      const retainedHistory = [
        await environment.revisions.getRevision("revision-race", "rev-a"),
        await environment.revisions.getRevision("revision-race", "rev-b"),
      ].filter(Boolean);
      expect(retainedHistory).toHaveLength(1);
    });

    it("rejects conflicting reuse of an immutable revision id", async () => {
      const environment = await createEnvironment();
      const original = capabilityRevision("revision-history", "rev-1", "original");
      await environment.revisions.save(original);

      await expect(
        environment.revisions.save(capabilityRevision("revision-history", "rev-1", "changed")),
      ).rejects.toThrow("Revision already exists: revision-history:rev-1");
      expect(await environment.revisions.getRevision("revision-history", "rev-1")).toEqual(original);
    });

    it("rejects unsupported revision payload shapes consistently", async () => {
      const environment = await createEnvironment();
      const sparse = new Array(3);
      sparse[1] = "value";
      const unsupported: readonly unknown[] = [
        undefined,
        Number.NaN,
        -0,
        new Map([["key", "value"]]),
        new Set(["value"]),
        new (class UnsupportedValue {})(),
        { $date: "2026-10-04T00:00:00.000Z" },
        sparse,
      ];

      for (const [index, value] of unsupported.entries()) {
        await expect(
          environment.revisions.saveRevisionIfAbsent(
            capabilityRevision(`revision-unsupported-${index}`, "rev-1", "bad", "novel-contract", value),
          ),
        ).rejects.toThrow("Unsupported persistence payload");
        await expect(
          environment.revisions.save(
            capabilityRevision(`revision-unsupported-save-${index}`, "rev-1", "bad", "novel-contract", value),
          ),
        ).rejects.toThrow("Unsupported persistence payload");
      }
    });
  });
}

export function runCapabilityPersistenceTransactionContract(
  adapterName: string,
  createEnvironment: () => Promise<CapabilityPersistenceEnvironment>,
): void {
  describe(`${adapterName} capability persistence transaction contract`, () => {
    it("does not expose generic save bypasses to capability business work", async () => {
      type RecordBypass = Extract<keyof CapabilityBusinessWork["records"], "save" | "saveIfCurrent">;
      type RevisionBypass = Extract<keyof CapabilityBusinessWork["revisions"], "save">;
      expectTypeOf<RecordBypass>().toEqualTypeOf<never>();
      expectTypeOf<RevisionBypass>().toEqualTypeOf<never>();

      const environment = await createEnvironment();
      await environment.transaction.run(async (work) => {
        expect(work.records).not.toHaveProperty("save");
        expect(work.records).not.toHaveProperty("saveIfCurrent");
        expect(work.revisions).not.toHaveProperty("save");
      });
    });

    it("keeps mixed nested transaction rollback from covering sibling repository commits", async () => {
      const environment = await createEnvironment();
      await environment.external.revisions.saveRevisionIfAbsent(
        capabilityRevision("revision-mixed-seed", "rev-seed", "seed"),
      );

      await environment.transaction.run(async (work) => {
        const failedNested = environment.transaction.run(async (nested) => {
          await nested.records.saveIfAbsent(capabilityRecord("record-mixed-failed"));
          await nested.otherRecords.saveIfAbsent(capabilityRecord("other-record-mixed-failed"));
          await nested.otherRevisions.saveRevisionIfAbsent(
            capabilityRevision("revision-mixed-failed", "rev-failed", "failed"),
          );
          throw new Error("mixed nested transaction must roll back");
        });
        await Promise.resolve();

        const siblingUnique = work.records.saveIfAbsent(capabilityRecord("record-mixed-success"));
        const siblingSave = environment.saveRevision(
          work,
          capabilityRevision("revision-mixed-save", "rev-save", "save"),
        );
        const siblingCas = work.revisions.saveIfCurrent(
          "rev-seed",
          capabilityRevision("revision-mixed-seed", "rev-success", "success"),
        );

        await expect(failedNested).rejects.toThrow(
          "mixed nested transaction must roll back",
        );
        await Promise.all([siblingUnique, siblingSave, siblingCas]);
      });

      await environment.transaction.run(async (work) => {
        expect(await work.records.findById("record-mixed-success")).toBeDefined();
        expect(await work.records.findById("record-mixed-failed")).toBeUndefined();
        expect(await work.otherRecords.findById("other-record-mixed-failed")).toBeUndefined();
        expect(await work.otherRevisions.findById("revision-mixed-save")).toBeDefined();
        expect((await work.revisions.findById("revision-mixed-seed"))?.currentRevisionId).toBe(
          "rev-success",
        );
        expect(await work.otherRevisions.getRevision("revision-mixed-failed", "rev-failed")).toBeUndefined();
      });
    });

    it("keeps caught plain unique conflicts from poisoning the outer transaction", async () => {
      const environment = await createEnvironment();

      await environment.transaction.run(async (work) => {
        await work.records.saveIfAbsent(capabilityRecord("record-poison", "original"));
        await expect(
          work.records.saveIfAbsent(capabilityRecord("record-poison", "duplicate")),
        ).rejects.toThrow("Record already exists: record-poison");
        await work.records.saveIfAbsent(capabilityRecord("record-after-unique-conflict"));
        await work.revisions.saveRevisionIfAbsent(
          capabilityRevision("revision-after-unique-conflict", "rev-1"),
        );
      });

      await environment.transaction.run(async (work) => {
        expect(await work.records.findById("record-poison")).toBeDefined();
        expect(await work.records.findById("record-after-unique-conflict")).toBeDefined();
        expect(await work.revisions.findById("revision-after-unique-conflict")).toBeDefined();
      });
    });

    it("uses unique repository savepoint names across one transaction", async () => {
      const environment = await createEnvironment();
      await environment.external.otherRevisions.saveRevisionIfAbsent(
        capabilityRevision("revision-savepoint-seed", "rev-seed", "seed"),
      );

      await environment.transaction.run(async (work) => {
        await environment.transaction.run(async (nested) => {
          const conflicting = nested.otherRevisions.saveRevisionIfAbsent(
            capabilityRevision("revision-savepoint-seed", "rev-seed", "conflict"),
          );
          const successful = nested.revisions.saveRevisionIfAbsent(
            capabilityRevision("revision-savepoint-success", "rev-success"),
          );

          await expect(conflicting).rejects.toThrow(
            "Revision already exists: revision-savepoint-seed:rev-seed",
          );
          await successful;
        });
      });

      await environment.transaction.run(async (work) => {
        expect(await work.revisions.findById("revision-savepoint-success")).toBeDefined();
        expect(
          (await work.otherRevisions.getRevision("revision-savepoint-seed", "rev-seed"))
            ?.state.label,
        ).toBe("seed");
      });
    });

    it("rolls back multiple repositories in one nested savepoint", async () => {
      const environment = await createEnvironment();

      await environment.transaction.run(async (outer) => {
        await outer.records.saveIfAbsent(capabilityRecord("record-outer-multi"));
        await outer.otherRecords.saveIfAbsent(capabilityRecord("other-record-outer-multi"));
        await environment.transaction
          .run(async (nested) => {
            await nested.records.saveIfAbsent(capabilityRecord("record-nested-multi"));
            await nested.otherRecords.saveIfAbsent(capabilityRecord("other-record-nested-multi"));
            await nested.revisions.saveRevisionIfAbsent(
              capabilityRevision("revision-nested-multi", "rev-nested"),
            );
            await nested.otherRevisions.saveRevisionIfAbsent(
              capabilityRevision("other-revision-nested-multi", "rev-other-nested"),
            );
            throw new Error("multi-repository savepoint must roll back");
          })
          .catch((error: unknown) => {
            expect(error).toBeInstanceOf(Error);
            expect((error as Error).message).toBe("multi-repository savepoint must roll back");
          });
      });

      await environment.transaction.run(async (work) => {
        expect(await work.records.findById("record-outer-multi")).toBeDefined();
        expect(await work.otherRecords.findById("other-record-outer-multi")).toBeDefined();
        expect(await work.records.findById("record-nested-multi")).toBeUndefined();
        expect(await work.otherRecords.findById("other-record-nested-multi")).toBeUndefined();
        expect(await work.revisions.findById("revision-nested-multi")).toBeUndefined();
        expect(await work.otherRevisions.findById("other-revision-nested-multi")).toBeUndefined();
      });
    });

    it("rolls back record and revision writes when the transaction fails", async () => {
      const environment = await createEnvironment();

      await expect(
        environment.transaction.run(async (work) => {
          await work.records.saveIfAbsent(capabilityRecord("record-rollback"));
          await work.revisions.saveRevisionIfAbsent(capabilityRevision("revision-rollback", "rev-1"));
          throw new Error("transaction must roll back");
        }),
      ).rejects.toThrow("transaction must roll back");

      await environment.transaction.run(async (work) => {
        expect(await work.records.findById("record-rollback")).toBeUndefined();
        expect(await work.revisions.findById("revision-rollback")).toBeUndefined();
        expect(await work.revisions.getRevision("revision-rollback", "rev-1")).toBeUndefined();
      });
    });

    it("recovers from a caught CAS conflict and commits later work without failed history", async () => {
      const environment = await createEnvironment();
      await environment.external.revisions.saveRevisionIfAbsent(
        capabilityRevision("revision-recovery", "rev-1", "initial"),
      );

      await environment.transaction.run(async (work) => {
        await expect(
          work.revisions.saveIfCurrent(
            "missing-rev",
            capabilityRevision("revision-recovery", "rev-failed", "failed"),
          ),
        ).rejects.toThrow("CAS revision conflict: revision-recovery");
        await work.records.saveIfAbsent(capabilityRecord("record-after-conflict"));
      });

      await environment.transaction.run(async (work) => {
        expect(await work.records.findById("record-after-conflict")).toBeDefined();
        expect((await work.revisions.findById("revision-recovery"))?.currentRevisionId).toBe("rev-1");
        expect(await work.revisions.getRevision("revision-recovery", "rev-failed")).toBeUndefined();
      });
    });

    it("keeps a successful nested commit after the outer transaction completes", async () => {
      const environment = await createEnvironment();

      await environment.transaction.run(async (outer) => {
        await outer.records.saveIfAbsent(capabilityRecord("record-outer"));
        await environment.transaction.run(async (nested) => {
          await nested.records.saveIfAbsent(capabilityRecord("record-nested-success"));
          await nested.revisions.saveRevisionIfAbsent(
            capabilityRevision("revision-nested-success", "rev-nested"),
          );
        });
      });

      await environment.transaction.run(async (work) => {
        expect(await work.records.findById("record-nested-success")).toBeDefined();
        expect(await work.revisions.findById("revision-nested-success")).toBeDefined();
      });
    });

    it("rolls back only a failed nested savepoint and preserves outer writes", async () => {
      const environment = await createEnvironment();

      await environment.transaction.run(async (outer) => {
        await outer.records.saveIfAbsent(capabilityRecord("record-outer"));
        await outer.revisions.saveRevisionIfAbsent(capabilityRevision("revision-outer", "rev-outer"));

        await environment.transaction
          .run(async (nested) => {
            await nested.records.saveIfAbsent(capabilityRecord("record-nested"));
            await nested.revisions.saveRevisionIfAbsent(
              capabilityRevision("revision-nested", "rev-nested"),
            );
            throw new Error("nested savepoint must roll back");
          })
          .catch((error: unknown) => {
            expect(error).toBeInstanceOf(Error);
            expect((error as Error).message).toBe("nested savepoint must roll back");
          });

        await outer.records.saveIfAbsent(capabilityRecord("record-after-savepoint"));
      });

      await environment.transaction.run(async (work) => {
        expect(await work.records.findById("record-outer")).toBeDefined();
        expect(await work.records.findById("record-after-savepoint")).toBeDefined();
        expect(await work.records.findById("record-nested")).toBeUndefined();
        expect(await work.revisions.findById("revision-outer")).toBeDefined();
        expect(await work.revisions.findById("revision-nested")).toBeUndefined();
        expect(await work.revisions.getRevision("revision-nested", "rev-nested")).toBeUndefined();
      });
    });

    it("provides snapshot isolation between concurrent nested savepoints", async () => {
      const environment = await createEnvironment();

      await environment.transaction.run(async (outer) => {
        const failed = environment.transaction.run(async (nested) => {
          await nested.records.saveIfAbsent(capabilityRecord("record-nested-failed"));
          await nested.revisions.saveRevisionIfAbsent(
            capabilityRevision("revision-nested-failed", "rev-failed"),
          );
          throw new Error("concurrent nested savepoint must roll back");
        });
        const successful = environment.transaction.run(async (nested) => {
          await nested.records.saveIfAbsent(capabilityRecord("record-nested-success"));
          await nested.revisions.saveRevisionIfAbsent(
            capabilityRevision("revision-nested-success", "rev-success"),
          );
        });

        await expect(failed).rejects.toThrow("concurrent nested savepoint must roll back");
        await successful;
      });

      await environment.transaction.run(async (work) => {
        expect(await work.records.findById("record-nested-failed")).toBeUndefined();
        expect(await work.records.findById("record-nested-success")).toBeDefined();
        expect(await work.revisions.findById("revision-nested-failed")).toBeUndefined();
        expect(await work.revisions.findById("revision-nested-success")).toBeDefined();
      });
    });

    it("rejects concurrent immutable history writes with a stable mapped conflict", async () => {
      const environment = await createEnvironment();
      const attempts = [
        environment.external.revisions.saveRevisionIfAbsent(
          capabilityRevision("revision-immutable-race", "rev-same", "first"),
        ),
        environment.external.revisions.saveRevisionIfAbsent(
          capabilityRevision("revision-immutable-race", "rev-same", "second"),
        ),
      ];

      const results = await Promise.allSettled(attempts);
      expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      const rejected = results.filter(
        (result): result is PromiseRejectedResult => result.status === "rejected",
      );
      expect(rejected).toHaveLength(1);
      expect((rejected[0]?.reason as Error).message).toBe(
        "Revision already exists: revision-immutable-race:rev-same",
      );
      const saved = await environment.external.revisions.getRevision(
        "revision-immutable-race",
        "rev-same",
      );
      expect(["first", "second"]).toContain(saved?.state.label);
    });
  });
}
