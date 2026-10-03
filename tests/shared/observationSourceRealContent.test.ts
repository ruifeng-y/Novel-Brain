import { describe, expect, it } from "vitest";
import { canonicalJson, hashContent } from "../../src/shared/domain/contentHash";
import {
  createObservation,
  createObservationSnapshot,
  type ObservationSnapshot,
  type ObservationSource,
  type SourceReference,
} from "../../src/shared/domain/observationSource";
import {
  runMutableObservationSourceContract,
  type MutableObservationSourceContractEnvironment,
} from "../support/observationSourceContract";

interface MutablePayload {
  readonly value: string;
}

class MutablePayloadObservationSource implements ObservationSource<MutablePayload> {
  constructor(private readonly state: { version: string; payload: MutablePayload }) {}

  async snapshot(): Promise<ObservationSnapshot<MutablePayload>> {
    const sourceReference: SourceReference = {
      identity: "mutable-payload-source-1",
      version: this.state.version,
      hash: hashContent(canonicalJson(this.state.payload)),
    };
    return createObservationSnapshot({
      sourceReference,
      observations: [
        createObservation({
          evidenceReference: "mutable-payload-evidence-1",
          sourceReference,
          ordinal: 1,
          data: this.state.payload,
        }),
      ],
    });
  }
}

describe("real content source reference contract", () => {
  runMutableObservationSourceContract<MutablePayload>(
    "mutable payload source",
    async (): Promise<MutableObservationSourceContractEnvironment<MutablePayload>> => {
      const state = {
        version: "revision-1",
        payload: { value: "initial" },
      };
      return {
        source: new MutablePayloadObservationSource(state),
        evidenceReference: "mutable-payload-evidence-1",
        expectedInitialSourceReference: {
          identity: "mutable-payload-source-1",
          version: "revision-1",
          hash: hashContent('{"value":"initial"}'),
        },
        expectedVersionChangedSourceReference: {
          identity: "mutable-payload-source-1",
          version: "revision-2",
          hash: hashContent('{"value":"initial"}'),
        },
        expectedContentChangedSourceReference: {
          identity: "mutable-payload-source-1",
          version: "revision-1",
          hash: hashContent('{"value":"changed"}'),
        },
        changeSourceVersion: async () => {
          state.version = "revision-2";
        },
        changeSourceContent: async () => {
          state.payload = { value: "changed" };
        },
      };
    },
  );
});
