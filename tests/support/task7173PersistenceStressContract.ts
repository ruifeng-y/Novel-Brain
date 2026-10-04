import { describe, expect, it } from "vitest";
import {
  capabilityRecord,
  capabilityRevision,
  type CapabilityPersistenceEnvironment,
} from "./capabilityPersistenceContract";
import { describeVerificationGate } from "./capabilityVerificationContract";

export function runTask7173PersistenceStressContract(
  adapterName: string,
  createEnvironment: () => Promise<CapabilityPersistenceEnvironment>,
): void {
  describe(`${adapterName} [task:7.1-7.3] persistence and transaction stress`, () => {
    describeVerificationGate("persistence", "keeps unique, immutable, and CAS state consistent under mixed load", async () => {
      const environment = await createEnvironment();
      await environment.transaction.run((work) =>
        work.revisions.saveRevisionIfAbsent(
          capabilityRevision("revision-7173-stress", "rev-1", "base"),
        ),
      );

      const uniqueWrites = Array.from({ length: 12 }, (_, index) =>
        environment.external.records.saveIfAbsent(
          capabilityRecord(`record-7173-${index}`, `record-${index}`),
        ),
      );
      const historyWrites = Array.from({ length: 12 }, (_, index) =>
        environment.external.revisions.saveRevisionIfAbsent(
          capabilityRevision(`history-7173-${index}`, "rev-1", `history-${index}`),
        ),
      );
      const casWrites = Array.from({ length: 12 }, (_, index) =>
        environment.external.revisions.saveIfCurrent(
          "rev-1",
          capabilityRevision("revision-7173-stress", `cas-${index}`, `cas-${index}`),
        ),
      );

      const uniqueResultsPromise = Promise.allSettled(uniqueWrites);
      const historyResultsPromise = Promise.allSettled(historyWrites);
      const casResultsPromise = Promise.allSettled(casWrites);
      const [uniqueResults, historyResults, casResults] = await Promise.all([
        uniqueResultsPromise,
        historyResultsPromise,
        casResultsPromise,
      ]);

      expect(uniqueResults.filter(({ status }) => status === "fulfilled")).toHaveLength(12);
      expect(historyResults.filter(({ status }) => status === "fulfilled")).toHaveLength(12);
      expect(casResults.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
      expect(casResults.filter(({ status }) => status === "rejected")).toHaveLength(11);

      expect(await environment.external.records.listByNovel("novel-contract")).toHaveLength(12);
      for (let index = 0; index < 12; index += 1) {
        expect(
          await environment.external.revisions.getRevision(`history-7173-${index}`, "rev-1"),
        ).toEqual(capabilityRevision(`history-7173-${index}`, "rev-1", `history-${index}`));
      }
      const current = await environment.external.revisions.findById("revision-7173-stress");
      expect(current?.currentRevisionId).toMatch(/^cas-\d+$/);
      const retainedCasHistory = (
        await Promise.all(
          Array.from({ length: 12 }, (_, index) =>
            environment.external.revisions.getRevision(
              "revision-7173-stress",
              `cas-${index}`,
            ),
          ),
        )
      ).filter(Boolean);
      expect(retainedCasHistory).toHaveLength(1);
      expect(retainedCasHistory[0]).toEqual(current);
    });

    describeVerificationGate("transaction", "rolls back mixed nested writes without touching successful siblings", async () => {
      const environment = await createEnvironment();
      await environment.transaction.run(async (outer) => {
        await outer.records.saveIfAbsent(capabilityRecord("record-7173-outer", "outer"));
        await outer.revisions.saveRevisionIfAbsent(
          capabilityRevision("revision-7173-outer", "rev-outer", "outer"),
        );

        const failed = environment.transaction.run(async (nested) => {
          for (let index = 0; index < 8; index += 1) {
            await nested.records.saveIfAbsent(
              capabilityRecord(`record-7173-failed-${index}`, `failed-${index}`),
            );
            await nested.revisions.saveRevisionIfAbsent(
              capabilityRevision(`revision-7173-failed-${index}`, "rev-1", `failed-${index}`),
            );
          }
          throw new Error("7173 nested rollback");
        });
        const successful = environment.transaction.run(async (nested) => {
          for (let index = 0; index < 8; index += 1) {
            await nested.records.saveIfAbsent(
              capabilityRecord(`record-7173-success-${index}`, `success-${index}`),
            );
            await nested.revisions.saveRevisionIfAbsent(
              capabilityRevision(`revision-7173-success-${index}`, "rev-1", `success-${index}`),
            );
          }
        });

        await expect(failed).rejects.toThrow("7173 nested rollback");
        await successful;
      });

      expect(await environment.external.records.findById("record-7173-outer")).toBeDefined();
      expect(await environment.external.records.findById("record-7173-failed-0")).toBeUndefined();
      expect(await environment.external.records.findById("record-7173-success-0")).toBeDefined();
      expect(
        await environment.external.revisions.getRevision("revision-7173-failed-0", "rev-1"),
      ).toBeUndefined();
      expect(
        await environment.external.revisions.getRevision("revision-7173-success-0", "rev-1"),
      ).toBeDefined();
    });

    describeVerificationGate("concurrency", "reserves one immutable payload and one current CAS winner", async () => {
      const environment = await createEnvironment();
      const immutable = capabilityRevision("revision-7173-reserve", "rev-same", "same");
      const reservations = await Promise.allSettled(
        Array.from({ length: 10 }, () =>
          environment.external.revisions.saveRevisionIfAbsent({ ...immutable }),
        ),
      );
      expect(reservations.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
      expect(reservations.filter(({ status }) => status === "rejected")).toHaveLength(9);

      await environment.transaction.run((work) =>
        work.revisions.saveRevisionIfAbsent(
          capabilityRevision("revision-7173-cas", "rev-1", "base"),
        ),
      );
      const cas = await Promise.allSettled(
        Array.from({ length: 10 }, (_, index) =>
          environment.external.revisions.saveIfCurrent(
            "rev-1",
            capabilityRevision("revision-7173-cas", `rev-${index}`, `cas-${index}`),
          ),
        ),
      );

      expect(
        await environment.external.revisions.getRevision("revision-7173-reserve", "rev-same"),
      ).toEqual(immutable);
      expect(cas.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
      expect(cas.filter(({ status }) => status === "rejected")).toHaveLength(9);
    });

    describeVerificationGate("recovery", "continues after caught uniqueness and CAS conflicts", async () => {
      const environment = await createEnvironment();
      await environment.external.records.saveIfAbsent(
        capabilityRecord("record-7173-recovery", "original"),
      );
      await environment.transaction.run((work) =>
        work.revisions.saveRevisionIfAbsent(
          capabilityRevision("revision-7173-recovery", "rev-1", "original"),
        ),
      );

      await expect(
        environment.external.records.saveIfAbsent(
          capabilityRecord("record-7173-recovery", "changed"),
        ),
      ).rejects.toThrow("Record already exists: record-7173-recovery");
      await expect(
        environment.external.revisions.saveIfCurrent(
          "rev-stale",
          capabilityRevision("revision-7173-recovery", "rev-2", "changed"),
        ),
      ).rejects.toThrow("CAS revision conflict: revision-7173-recovery");

      await environment.external.records.saveIfAbsent(
        capabilityRecord("record-7173-recovery-next", "next"),
      );
      await environment.external.revisions.saveIfCurrent(
        "rev-1",
        capabilityRevision("revision-7173-recovery", "rev-2", "recovered"),
      );
      expect(await environment.external.records.findById("record-7173-recovery-next")).toBeDefined();
      expect(
        (await environment.external.revisions.findById("revision-7173-recovery"))
          ?.currentRevisionId,
      ).toBe("rev-2");
    });

    describeVerificationGate("replay", "replays identical immutable saves and rejects stale CAS replay without duplicates", async () => {
      const environment = await createEnvironment();
      const revision = capabilityRevision("revision-7173-replay", "rev-1", "same");
      await environment.transaction.run(async (work) => {
        await environment.saveRevision(work, revision);
        await environment.saveRevision(work, { ...revision });
      });

      await environment.transaction.run((work) =>
        work.revisions.saveRevisionIfAbsent(
          capabilityRevision("revision-7173-cas-replay", "rev-1", "base"),
        ),
      );
      await environment.external.revisions.saveIfCurrent(
        "rev-1",
        capabilityRevision("revision-7173-cas-replay", "rev-2", "next"),
      );
      await expect(
        environment.external.revisions.saveIfCurrent(
          "rev-1",
          capabilityRevision("revision-7173-cas-replay", "rev-2", "next"),
        ),
      ).rejects.toThrow("CAS revision conflict: revision-7173-cas-replay");

      expect(await environment.external.otherRevisions.getRevision("revision-7173-replay", "rev-1"))
        .toEqual(revision);
      expect(await environment.external.revisions.findById("revision-7173-cas-replay"))
        .toEqual(capabilityRevision("revision-7173-cas-replay", "rev-2", "next"));
      expect(
        await environment.external.revisions.getRevision("revision-7173-cas-replay", "rev-2"),
      ).toEqual(capabilityRevision("revision-7173-cas-replay", "rev-2", "next"));
    });

    describeVerificationGate("regression", "never exposes half-written state after transaction failure", async () => {
      const environment = await createEnvironment();
      await expect(
        environment.transaction.run(async (work) => {
          await work.records.saveIfAbsent(capabilityRecord("record-7173-half", "half"));
          await work.revisions.saveRevisionIfAbsent(
            capabilityRevision("revision-7173-half", "rev-1", "half"),
          );
          throw new Error("7173 full rollback");
        }),
      ).rejects.toThrow("7173 full rollback");

      expect(await environment.external.records.findById("record-7173-half")).toBeUndefined();
      expect(await environment.external.revisions.findById("revision-7173-half")).toBeUndefined();
      expect(
        await environment.external.revisions.getRevision("revision-7173-half", "rev-1"),
      ).toBeUndefined();
    });
  });
}
