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
  };
}
