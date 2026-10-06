import {
  diffChangeSets,
  type ChangeDiffEntry,
} from "../production/domain/changeSetDiff";
import {
  changeSetRevisionOf,
  type ChangeSetRevisionRepository,
} from "../production/application/changeSetPersistence";

export interface ChangeSetDiffQuery {
  diffRevisions(input: {
    readonly changeSetId: string;
    readonly fromRevisionId: string;
    readonly toRevisionId: string;
  }): Promise<readonly ChangeDiffEntry[] | undefined>;
}

/**
 * Diffing is only defined between two revisions of the same Change Set. A
 * revision that does not exist in the addressed Change Set yields `undefined`,
 * so a cross change set comparison can never be answered.
 */
export function createChangeSetDiffQuery(dependencies: {
  readonly changeSets: ChangeSetRevisionRepository;
}): ChangeSetDiffQuery {
  return {
    async diffRevisions(input) {
      const from = await dependencies.changeSets.getRevision(input.changeSetId, input.fromRevisionId);
      const to = await dependencies.changeSets.getRevision(input.changeSetId, input.toRevisionId);
      if (!from || !to) return undefined;
      return diffChangeSets(changeSetRevisionOf(from).changes, changeSetRevisionOf(to).changes);
    },
  };
}
