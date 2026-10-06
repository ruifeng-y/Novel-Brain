import { readFileSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { preProcessFile } from "typescript";
import { describe, expect, it } from "vitest";
import {
  applicationBoundaryContracts,
  applicationCapabilities,
  applicationCapabilityBoundaries,
  getApplicationBoundaryContract,
} from "../../src/application/commandQueryBoundary";

const expectedOperationIds = {
  generation: {
    commands: [
      "generation.command.create-generation-task",
      "generation.command.start-generation-task",
      "generation.command.submit-generation-candidate",
    ],
    queries: [
      "generation.query.generation-task-status",
      "generation.query.generation-candidate",
    ],
  },
  validation: {
    commands: ["validation.command.validate-candidate"],
    queries: [
      "validation.query.validation-outcome",
      "validation.query.validation-evidence",
    ],
  },
  approval: {
    commands: ["approval.command.record-review-decision"],
    queries: ["approval.query.approval-evidence"],
  },
  commit: {
    commands: [
      "commit.command.commit-change-set-revision",
      "commit.command.create-change-set-revision",
      "commit.command.rollback-scene",
    ],
    queries: [
      "commit.query.commit-evidence",
      "commit.query.change-set-revision-diff",
    ],
  },
  run: {
    commands: [
      "run.command.create-run-plan-revision",
      "run.command.approve-run-plan",
      "run.command.start-run",
      "run.command.pause-run",
      "run.command.resume-run",
      "run.command.cancel-run",
      "run.command.retry-attempt",
      "run.command.fallback-attempt",
      "run.command.record-checkpoint-decision",
    ],
    queries: ["run.query.run-status", "run.query.run-audit"],
  },
  recall: {
    commands: [
      "recall.command.record-recall-disposition",
      "recall.command.request-proposed-action",
    ],
    queries: ["recall.query.recall-attention"],
  },
  foundation: {
    commands: [
      "foundation.command.enter-foundation-idea",
      "foundation.command.extract-foundation-text",
      "foundation.command.create-blank-foundation",
      "foundation.command.create-proposal",
      "foundation.command.revise-proposal",
      "foundation.command.adopt-proposal-content",
    ],
    queries: [
      "foundation.query.workspace-focus",
      "foundation.query.proposal-comparison",
    ],
  },
  manuscript: {
    commands: [
      "manuscript.command.create-arc",
      "manuscript.command.create-chapter",
      "manuscript.command.reorder-structure",
    ],
    queries: [
      "manuscript.query.structural-navigation",
      "manuscript.query.scene",
      "manuscript.query.target-span-resolution",
    ],
  },
  workspace: {
    commands: [],
    queries: ["workspace.query.focus-resolution"],
  },
} as const;

function resolveImport(importer: string, specifier: string): string {
  const base = resolve(dirname(importer), specifier);
  const candidates = extname(base)
    ? [base]
    : [`${base}.ts`, `${base}.tsx`, resolve(base, "index.ts")];
  const resolved = candidates.find(candidate => {
    try {
      readFileSync(candidate);
      return true;
    } catch {
      return false;
    }
  });
  return resolved ?? base;
}

function findDomainImports(entry: string): readonly string[] {
  const seen = new Set<string>();
  const queue = [entry];
  const domainImports: string[] = [];

  while (queue.length > 0) {
    const file = queue.shift();
    if (file === undefined || seen.has(file)) continue;
    seen.add(file);

    const source = readFileSync(file, "utf8");
    for (const imported of preProcessFile(source, true, true).importedFiles) {
      const resolvedImport = resolveImport(file, imported.fileName);
      if (/[/\\]domain[/\\]/.test(resolvedImport)) domainImports.push(imported.fileName);
      if (!seen.has(resolvedImport)) queue.push(resolvedImport);
    }
  }

  return domainImports;
}

describe("[task:P2.1] command and query boundary contracts", () => {
  it("[integration] separates mutation commands from read queries for every application capability", () => {
    expect(applicationCapabilities).toEqual([
      "generation",
      "validation",
      "approval",
      "commit",
      "run",
      "recall",
      "foundation",
      "manuscript",
      "workspace",
    ]);

    const actualOperationIds = Object.fromEntries(
      applicationCapabilities.map(capability => [
        capability,
        {
          commands: applicationCapabilityBoundaries[capability].commands.map(contract => contract.id),
          queries: applicationCapabilityBoundaries[capability].queries.map(contract => contract.id),
        },
      ]),
    );
    expect(actualOperationIds).toEqual(expectedOperationIds);

    for (const contract of applicationBoundaryContracts) {
      if (contract.kind === "command") {
        expect(contract.effect).toBe("mutation");
        expect(contract.resultChannel).toBe("command-result");
      } else {
        expect(contract.effect).toBe("read");
        expect(contract.resultChannel).toBe("query-result");
      }
    }
  });

  it("[domain] keeps the application boundary graph decoupled from Domain modules", () => {
    const entry = fileURLToPath(
      new URL("../../src/application/commandQueryBoundary.ts", import.meta.url),
    );

    expect(findDomainImports(entry)).toEqual([]);
  });

  it("[cross-system] keeps command and query operation identities disjoint and enforceable", () => {
    const ids = applicationBoundaryContracts.map(contract => contract.id);
    expect(new Set(ids).size).toBe(ids.length);

    for (const contract of applicationBoundaryContracts) {
      expect(getApplicationBoundaryContract(contract.id, contract.kind)).toBe(contract);
      expect(() =>
        getApplicationBoundaryContract(
          contract.id,
          contract.kind === "command" ? "query" : "command",
        ),
      ).toThrow(`application boundary contract ${contract.id} is not a`);
    }
  });

  it("[regression] preserves stable primitive-only boundary descriptors without DTO or API parameter fields", () => {
    for (const contract of applicationBoundaryContracts) {
      expect(Object.keys(contract).sort()).toEqual([
        "capability",
        "effect",
        "id",
        "kind",
        "resultChannel",
      ]);
      expect(typeof contract.id).toBe("string");
      expect(typeof contract.capability).toBe("string");
    }
  });
});
