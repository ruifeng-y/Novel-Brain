/**
 * Scene read surface: the manuscript surface of a Scene Focus.
 *
 * W2 renders read-only. It opens the scene through `GET
 * /novels/:novelId/scenes/:sceneId` and resolves a selected span through `POST
 * /novels/:novelId/scenes/:sceneId/span-resolution`. It holds no canonical
 * truth of its own: the text it draws is the answer of the scene read query,
 * and the span outcome it shows is the answer of the span resolution query.
 * The three-state classification (resolvable / drifted / missing) is decided by
 * the server and is never recomputed here.
 *
 * A span is addressed by the scene revision, a stable anchor identity, and the
 * content hash of its text (Spec 10.3). The read view exposes the scene text
 * but not the persisted anchors' positions, so a fresh selection is addressed
 * by a content-derived selection id: the same selected text always yields the
 * same address, and a selection only resolves to `resolvable` or `drifted`
 * when a persisted anchor carries that address. Until one does, the honest
 * answer is `missing` and the surface says so; it never claims the span will
 * apply. This convention is recorded for W3, which creates anchors.
 *
 * The module is DOM-free at import time, so it can be imported and driven in
 * Node. DOM work happens only inside renderSceneSurface.
 */

const SPAN_STATE_LABELS = {
  resolvable: "片段可解析",
  drifted: "片段已漂移，不可用",
  missing: "片段无法解析，不可用",
};

const boundRoots = new WeakSet();
const selectionHandlers = new WeakMap();

function escapeText(value) {
  return String(value === undefined || value === null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function stateBlock(stateName, label, detail) {
  const extra =
    detail === undefined || detail === ""
      ? ""
      : `<span class="ws-state-detail">${escapeText(detail)}</span>`;
  return `<div class="ws-state" data-state="${stateName}"><span class="ws-state-label">${escapeText(
    label,
  )}</span>${extra}</div>`;
}

function chip(label) {
  return `<span class="ws-chip">${escapeText(label)}</span>`;
}

/** UTF-8 bytes of a string, matching node's `update(value, "utf8")`. */
function utf8Bytes(value) {
  const bytes = [];
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x80) {
      bytes.push(code);
    } else if (code < 0x800) {
      bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else if (code >= 0xd800 && code <= 0xdbff && index + 1 < value.length) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        const point = 0x10000 + ((code - 0xd800) << 10) + (next - 0xdc00);
        bytes.push(
          0xf0 | (point >> 18),
          0x80 | ((point >> 12) & 0x3f),
          0x80 | ((point >> 6) & 0x3f),
          0x80 | (point & 0x3f),
        );
        index += 1;
      } else {
        bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
      }
    } else {
      bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    }
  }
  return bytes;
}

const SHA256_INITIAL = [
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
];

const SHA256_ROUND = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

function rotateRight(value, bits) {
  return (value >>> bits) | (value << (32 - bits));
}

/**
 * SHA-256 of the UTF-8 bytes, hex encoded. It reproduces the same digest as the
 * server's `hashContent`, so a selection's content hash means the same thing on
 * both sides of the boundary.
 */
function sha256Hex(value) {
  const bytes = utf8Bytes(String(value));
  const bitLength = bytes.length * 8;
  const padded = bytes.concat([0x80]);
  while (padded.length % 64 !== 56) padded.push(0);
  const high = Math.floor(bitLength / 0x100000000);
  const low = bitLength >>> 0;
  for (let shift = 24; shift >= 0; shift -= 8) padded.push((high >>> shift) & 0xff);
  for (let shift = 24; shift >= 0; shift -= 8) padded.push((low >>> shift) & 0xff);

  let h0 = SHA256_INITIAL[0];
  let h1 = SHA256_INITIAL[1];
  let h2 = SHA256_INITIAL[2];
  let h3 = SHA256_INITIAL[3];
  let h4 = SHA256_INITIAL[4];
  let h5 = SHA256_INITIAL[5];
  let h6 = SHA256_INITIAL[6];
  let h7 = SHA256_INITIAL[7];
  const words = new Array(64);

  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      const base = offset + index * 4;
      words[index] =
        ((padded[base] << 24) |
          (padded[base + 1] << 16) |
          (padded[base + 2] << 8) |
          padded[base + 3]) >>>
        0;
    }
    for (let index = 16; index < 64; index += 1) {
      const previous = words[index - 15];
      const recent = words[index - 2];
      const s0 = rotateRight(previous, 7) ^ rotateRight(previous, 18) ^ (previous >>> 3);
      const s1 = rotateRight(recent, 17) ^ rotateRight(recent, 19) ^ (recent >>> 10);
      words[index] = (words[index - 16] + s0 + words[index - 7] + s1) >>> 0;
    }

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;

    for (let index = 0; index < 64; index += 1) {
      const sum1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
      const choose = (e & f) ^ (~e & g);
      const temp1 = (h + sum1 + choose + SHA256_ROUND[index] + words[index]) >>> 0;
      const sum0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (sum0 + majority) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
    h5 = (h5 + f) >>> 0;
    h6 = (h6 + g) >>> 0;
    h7 = (h7 + h) >>> 0;
  }

  return [h0, h1, h2, h3, h4, h5, h6, h7]
    .map((word) => word.toString(16).padStart(8, "0"))
    .join("");
}

/**
 * Addresses a selection of the manuscript text as a target span descriptor:
 * the selected text, its content hash, and a content-derived selection id.
 * Returns undefined when the bounds do not describe a non-empty selection, so
 * an empty or out-of-range selection never becomes a request.
 */
export function spanDescriptorFromSelection(text, bounds) {
  if (typeof text !== "string" || bounds === null || typeof bounds !== "object") {
    return undefined;
  }
  const start = bounds.start;
  const end = bounds.end;
  if (!Number.isInteger(start) || !Number.isInteger(end)) return undefined;
  if (start < 0 || end <= start || end > text.length) return undefined;

  const selected = text.slice(start, end);
  if (selected.length === 0) return undefined;

  const sourceContentHash = sha256Hex(selected);
  return Object.freeze({
    anchorId: `span:${sourceContentHash}`,
    text: selected,
    sourceContentHash: sourceContentHash,
  });
}

function sceneMarkup(scene, selection, options) {
  if (options.error) {
    return (
      stateBlock("error", "场景加载失败", String(options.error)) +
      `<button type="button" class="ws-button" data-ws-action="scene-retry" title="重新加载场景">重试</button>`
    );
  }
  if (!scene) return stateBlock("loading", "加载中");

  const head =
    `<div class="ws-facts">` +
    chip(`标题：${scene.title}`) +
    chip(`修订：${scene.revisionId}`) +
    `<span class="ws-badge" data-role="scene-readonly">只读</span>` +
    `</div>`;
  const text = typeof scene.text === "string" ? scene.text : "";

  if (text.trim().length === 0) {
    return head + stateBlock("empty", "该场景暂无正文");
  }

  return (
    head +
    `<div class="ws-scene-text" data-role="scene-text" data-readonly="true">${escapeText(text)}</div>` +
    spanMarkup(selection)
  );
}

function spanMarkup(selection) {
  if (!selection) return "";
  if (selection.error) {
    return (
      `<div class="ws-span-result ws-span-unavailable" data-span-state="error">` +
      stateBlock("error", "片段解析失败", String(selection.error)) +
      `</div>`
    );
  }
  if (selection.pending || !selection.resolution) {
    return (
      `<div class="ws-span-result" data-span-state="pending">` +
      stateBlock("loading", "解析片段中") +
      `</div>`
    );
  }

  const resolution = selection.resolution;
  const state = typeof resolution.state === "string" ? resolution.state : "";
  const reason = typeof resolution.reason === "string" ? resolution.reason : "";

  if (state === "resolvable") {
    const span = resolution.span;
    const detail = span && typeof span.text === "string" ? span.text : "";
    return (
      `<div class="ws-span-result" data-span-state="resolvable">` +
      stateBlock("success", SPAN_STATE_LABELS.resolvable, detail) +
      `</div>`
    );
  }
  if (state === "drifted") {
    return (
      `<div class="ws-span-result ws-span-unavailable" data-span-state="drifted">` +
      stateBlock("degraded", SPAN_STATE_LABELS.drifted, reason) +
      `</div>`
    );
  }
  if (state === "missing") {
    return (
      `<div class="ws-span-result ws-span-unavailable" data-span-state="missing">` +
      stateBlock("disabled", SPAN_STATE_LABELS.missing, reason) +
      `</div>`
    );
  }
  return "";
}

/** Offsets of the current DOM selection inside the scene text element. */
function boundsFromSelection(textElement) {
  if (!textElement) return undefined;
  if (typeof window === "undefined" || typeof window.getSelection !== "function") return undefined;
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return undefined;
  const range = selection.getRangeAt(0);
  if (
    typeof textElement.contains === "function" &&
    (!textElement.contains(range.startContainer) || !textElement.contains(range.endContainer))
  ) {
    return undefined;
  }
  const prefix = range.cloneRange();
  prefix.selectNodeContents(textElement);
  prefix.setEnd(range.startContainer, range.startOffset);
  const start = prefix.toString().length;
  return { start: start, end: start + range.toString().length };
}

function bindSelection(root, onSelectSpan) {
  if (typeof onSelectSpan !== "function") return;
  if (typeof root.addEventListener !== "function") return;

  selectionHandlers.set(root, onSelectSpan);
  if (boundRoots.has(root)) return;
  boundRoots.add(root);

  const report = () => {
    const handler = selectionHandlers.get(root);
    if (typeof handler !== "function") return;
    const textElement =
      typeof root.querySelector === "function" ? root.querySelector('[data-role="scene-text"]') : null;
    const bounds = boundsFromSelection(textElement);
    if (!bounds) return;
    handler(bounds);
  };
  // A selection can be made with the mouse or with the keyboard, so both paths
  // report; a collapsed selection reports nothing.
  for (const eventName of ["mouseup", "keyup"]) root.addEventListener(eventName, report);
}

/**
 * Renders the scene read surface into `root`. `scene` is the scene read view
 * (or null while it is loading), `selection` is the current span attempt
 * (`{ descriptor, resolution, pending, error }` or null), and `handlers`
 * carries the scene load `error`, `onSelectSpan`, which receives the selection
 * bounds, and `onRetry`.
 */
export function renderSceneSurface(root, scene, selection, handlers) {
  if (!root) return;
  const options = handlers && typeof handlers === "object" ? handlers : {};
  root.innerHTML = sceneMarkup(scene, selection, options);
  bindSelection(root, options.onSelectSpan);
}
