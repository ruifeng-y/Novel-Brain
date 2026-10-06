/**
 * Transport for the workspace shell.
 *
 * It speaks the product HTTP surface and keeps no policy: the Mode, surface,
 * panels, and Lens of a Focus are decided by the server and returned to the
 * caller untouched. Nothing here decides what a Focus is.
 */

function newRequestId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `ws-${Date.now()}-${Math.floor(Math.random() * 1000000)}`;
}

async function readPayload(response) {
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  return payload;
}

function messageOf(payload, status) {
  if (payload && typeof payload === "object") {
    if (typeof payload.message === "string" && payload.message.length > 0) return payload.message;
    if (typeof payload.error === "string" && payload.error.length > 0) return payload.error;
  }
  return `请求失败（${status}）`;
}

export function createApiClient(options) {
  const settings = options || {};
  const baseUrl = typeof settings.baseUrl === "string" ? settings.baseUrl : "";

  async function request(path, init) {
    const response = await fetch(`${baseUrl}${path}`, init);
    const payload = await readPayload(response);
    if (!response.ok) {
      const failure = new Error(messageOf(payload, response.status));
      failure.status = response.status;
      failure.payload = payload;
      throw failure;
    }
    return payload;
  }

  return {
    /**
     * Asks the server how a requested object resolves. The response is the
     * resolved Focus plus its surface, panels, and default Lens.
     */
    resolveFocus(request_) {
      const query = [
        `workspaceId=${encodeURIComponent(request_.workspaceId)}`,
        `kind=${encodeURIComponent(request_.kind)}`,
      ];
      if (typeof request_.mode === "string" && request_.mode.length > 0) {
        query.push(`mode=${encodeURIComponent(request_.mode)}`);
      }
      const requestId = newRequestId();
      return request(`/workspace/resolution?${query.join("&")}`, {
        method: "GET",
        headers: {
          accept: "application/json",
          "x-author-id": request_.authorId,
          "x-request-id": requestId,
        },
      });
    },

    /**
     * The persisted Novel -> Arc -> Chapter -> Scene structure of one Novel.
     * The client renders this answer; it never assembles structure from an
     * independent source and never invents a node of its own.
     */
    getStructure(request_) {
      const requestId = newRequestId();
      return request(`/novels/${encodeURIComponent(request_.novelId)}/structure`, {
        method: "GET",
        headers: {
          accept: "application/json",
          "x-author-id": request_.authorId,
          "x-request-id": requestId,
        },
      });
    },

    /**
     * The current read view of one Scene: its identity, placement, title, and
     * manuscript revision. The client draws this answer; it never assembles a
     * scene or its text from an independent source.
     */
    getScene(request_) {
      const requestId = newRequestId();
      return request(
        `/novels/${encodeURIComponent(request_.novelId)}/scenes/${encodeURIComponent(
          request_.sceneId,
        )}`,
        {
          method: "GET",
          headers: {
            accept: "application/json",
            "x-author-id": request_.authorId,
            "x-request-id": requestId,
          },
        },
      );
    },

    /**
     * Resolves a target span against the scene's current revision. The
     * resolvable / drifted / missing classification is the server's answer; the
     * client only carries the descriptor and renders the reply.
     */
    resolveSpan(request_) {
      const requestId = newRequestId();
      return request(
        `/novels/${encodeURIComponent(request_.novelId)}/scenes/${encodeURIComponent(
          request_.sceneId,
        )}/span-resolution`,
        {
          method: "POST",
          headers: {
            accept: "application/json",
            "content-type": "application/json",
            "x-author-id": request_.authorId,
            "x-request-id": requestId,
          },
          body: JSON.stringify(request_.descriptor),
        },
      );
    },

    /**
     * Adoption: a Candidate becomes a persisted Change Set Revision. This is
     * the only write the Candidate Review surface performs; a Candidate is
     * never committed.
     */
    adoptCandidate(request_) {
      const requestId = newRequestId();
      const body = {
        candidateId: request_.candidateId,
        revisionId: request_.revisionId,
      };
      if (typeof request_.parentRevisionId === "string" && request_.parentRevisionId.length > 0) {
        body.parentRevisionId = request_.parentRevisionId;
      }
      return request(`/change-sets/${encodeURIComponent(request_.changeSetId)}/revisions`, {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          "x-author-id": request_.authorId,
          "x-request-id": requestId,
        },
        body: JSON.stringify(body),
      });
    },

    /** The gate answer of the server, for one revision and its named evidence. */
    getCommitGate(request_) {
      const requestId = newRequestId();
      const query = [
        `validationRunIds=${encodeURIComponent((request_.validationRunIds || []).join(","))}`,
        `unresolvedConflict=${request_.unresolvedConflict === true ? "true" : "false"}`,
        `stale=${request_.stale === true ? "true" : "false"}`,
      ];
      return request(
        `/change-sets/${encodeURIComponent(request_.changeSetId)}/revisions/${encodeURIComponent(
          request_.revisionId,
        )}/commit-gate?${query.join("&")}`,
        {
          method: "GET",
          headers: {
            accept: "application/json",
            "x-author-id": request_.authorId,
            "x-request-id": requestId,
          },
        },
      );
    },

    /** Runs validation for one revision against its recorded content source. */
    runValidationForRevision(request_) {
      const requestId = newRequestId();
      return request(
        `/change-sets/${encodeURIComponent(request_.changeSetId)}/revisions/${encodeURIComponent(
          request_.revisionId,
        )}/validation-runs`,
        {
          method: "POST",
          headers: {
            accept: "application/json",
            "content-type": "application/json",
            "x-author-id": request_.authorId,
            "x-request-id": requestId,
          },
          body: JSON.stringify({
            validationId: request_.validationId,
            planVersionId: request_.planVersionId,
            candidateId: request_.candidateId,
            mustPreserve: request_.mustPreserve || [],
          }),
        },
      );
    },

    /** The recorded decision events of one revision: the approval evidence. */
    getApprovalEvidence(request_) {
      const requestId = newRequestId();
      return request(
        `/change-sets/${encodeURIComponent(request_.changeSetId)}/revisions/${encodeURIComponent(
          request_.revisionId,
        )}/review-decisions`,
        {
          method: "GET",
          headers: {
            accept: "application/json",
            "x-author-id": request_.authorId,
            "x-request-id": requestId,
          },
        },
      );
    },

    /**
     * Commits a revision by referencing real artefacts. The request carries no
     * candidate, no client-supplied validation id, and no review template.
     */
    commitRevision(request_) {
      const requestId = newRequestId();
      return request(`/change-sets/${encodeURIComponent(request_.changeSetId)}/commit`, {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          "x-author-id": request_.authorId,
          "x-request-id": requestId,
        },
        body: JSON.stringify(request_.body),
      });
    },

    /** What a commit was made of, and what it recorded. */
    getCommitProvenance(request_) {
      const requestId = newRequestId();
      return request(
        `/novels/${encodeURIComponent(request_.novelId)}/commits/${encodeURIComponent(
          request_.commitId,
        )}`,
        {
          method: "GET",
          headers: {
            accept: "application/json",
            "x-author-id": request_.authorId,
            "x-request-id": requestId,
          },
        },
      );
    },
  };
}
