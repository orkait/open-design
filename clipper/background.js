// Open Design web clipper service worker.
//
// Zero-config: there is no pairing and no token. The daemon is loopback-bound,
// and a web page cannot forge this extension's chrome-extension:// origin, so
// the daemon auto-trusts our requests to /api/library/*. All we need is the
// daemon URL (default below; overridable in the popup). host_permissions let
// the service worker reach the loopback daemon without CORS friction.
//
// The popup and the on-page toolbar both message this worker rather than
// talking to the daemon directly, so all daemon traffic lives in one place.

const DEFAULT_DAEMON_URL = 'http://127.0.0.1:7456';

async function getDaemonUrl() {
  const { daemonUrl } = await chrome.storage.local.get(['daemonUrl']);
  return daemonUrl || DEFAULT_DAEMON_URL;
}

// Is Open Design running and reachable? We probe a library route (the daemon
// auto-trusts our extension origin there) and treat any 2xx as connected.
async function probe() {
  const daemonUrl = await getDaemonUrl();
  try {
    const resp = await fetch(`${daemonUrl}/api/library/assets?limit=1`, { method: 'GET' });
    return resp.ok;
  } catch {
    return false;
  }
}

async function ingest(body) {
  const daemonUrl = await getDaemonUrl();
  let resp;
  try {
    resp = await fetch(`${daemonUrl}/api/library/ingest`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    // Network-level failure → the daemon almost certainly isn't running.
    throw new Error('not running');
  }
  if (!resp.ok) {
    // 413 means the capture is bigger than the daemon will accept — surface a
    // concise, actionable message instead of the server's full HTML error page.
    if (resp.status === 413) {
      throw new Error('capture too large — try unchecking “Inline images” in Advanced');
    }
    const raw = await resp.text().catch(() => '');
    // Strip any HTML (Express error pages) and collapse whitespace so the popup
    // never shows a wall of markup.
    const snippet = raw.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160);
    throw new Error(`ingest ${resp.status}${snippet ? `: ${snippet}` : ''}`);
  }
  return resp.json();
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) throw new Error('no active tab');
  return tab;
}

// Best-effort message to a tab's content script. Resolves regardless of whether
// a receiver exists (e.g. chrome:// pages have no content script).
function sendToTab(tabId, message) {
  return new Promise((resolve) => {
    try {
      chrome.tabs.sendMessage(tabId, message, (res) => {
        void chrome.runtime.lastError; // swallow "no receiving end"
        resolve(res);
      });
    } catch {
      resolve(undefined);
    }
  });
}

async function captureScreenshot() {
  const tab = await activeTab();
  // Pull our own on-page bar out of frame so it never lands in the screenshot.
  await sendToTab(tab.id, { type: 'odClipper:hideForCapture' });
  let dataUrl;
  try {
    dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
  } finally {
    await sendToTab(tab.id, { type: 'odClipper:restoreAfterCapture' });
  }
  return ingest({
    dataUrl,
    kind: 'image',
    sourceUrl: tab.url,
    sourceTitle: tab.title,
    tags: ['screenshot'],
  });
}

// Runs in the page context (serialized by executeScript) — keep self-contained.
function collectImages() {
  const out = [];
  const seen = new Set();
  for (const el of document.images) {
    const src = el.currentSrc || el.src;
    if (!src || seen.has(src)) continue;
    if (!/^https?:/i.test(src)) continue;
    if ((el.naturalWidth || 0) < 64 || (el.naturalHeight || 0) < 64) continue;
    seen.add(src);
    out.push({ src, alt: el.alt || '' });
  }
  return out;
}

async function grabImages() {
  const tab = await activeTab();
  const [first] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: collectImages,
  });
  const images = Array.isArray(first?.result) ? first.result.slice(0, 30) : [];
  let count = 0;
  for (const img of images) {
    try {
      await ingest({ url: img.src, kind: 'image', sourceUrl: tab.url, sourceTitle: img.alt || tab.title });
      count += 1;
    } catch {
      // skip individual failures (hotlink-protected / oversized)
    }
  }
  return { count, total: images.length };
}

// --- page capture (high-fidelity HTML + Figma IR) --------------------------
//
// capture.js runs in the page and returns the snapshot with cross-origin
// resource URLs left intact; only the service worker can fetch those without
// CORS, so it does the fetch-and-inline pass here. One fetch per resource feeds
// both the HTML string and the Figma IR's image fills.

const MAX_RESOURCE_BYTES = 6 * 1024 * 1024;

// The daemon accepts an ingest body up to 128MB. Every fetched resource is
// inlined as a base64 data URI into BOTH the HTML string and the Figma IR, so
// each one can contribute up to ~2× its data-URI length to the final body.
// Budget the cumulative data-URI size so that even with that doubling, plus the
// page's own markup and IR geometry, we stay comfortably under the limit. Once
// the budget is spent the remaining resources are left as live URLs — the
// capture still saves (at reduced image fidelity) instead of 413-failing the
// whole page, which is what an image-heavy site (news front pages) used to hit.
const MAX_TOTAL_INLINE_BYTES = 48 * 1024 * 1024;

// Service workers have no FileReader/createObjectURL — base64 the bytes by hand.
async function fetchAsDataUri(url) {
  const resp = await fetch(url, { redirect: 'follow' });
  if (!resp.ok) throw new Error(String(resp.status));
  const declared = Number(resp.headers.get('content-length') || '0');
  if (declared && declared > MAX_RESOURCE_BYTES) throw new Error('too large');
  const buf = await resp.arrayBuffer();
  if (buf.byteLength > MAX_RESOURCE_BYTES) throw new Error('too large');
  const bytes = new Uint8Array(buf);
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  const mime = (resp.headers.get('content-type') || 'application/octet-stream').split(';')[0].trim();
  return `data:${mime};base64,${btoa(bin)}`;
}

async function buildResourceMap(urls, includeImages) {
  const map = new Map();
  let skipped = 0;
  if (!includeImages || !Array.isArray(urls) || !urls.length) return { map, skipped };
  // Fetches run in parallel, but JS is single-threaded so the read-check-write
  // of `inlinedBytes` between awaits is atomic — no lost updates. Inlining order
  // is whichever fetch resolves first; once over budget the rest stay live.
  let inlinedBytes = 0;
  await Promise.all(
    urls.map(async (url) => {
      let dataUri;
      try {
        dataUri = await fetchAsDataUri(url);
      } catch {
        // hotlink-protected / oversized / offline — leave the original URL
        return;
      }
      if (inlinedBytes + dataUri.length > MAX_TOTAL_INLINE_BYTES) {
        skipped += 1; // budget spent — leave this resource as a live URL
        return;
      }
      inlinedBytes += dataUri.length;
      map.set(url, dataUri);
    }),
  );
  return { map, skipped };
}

function inlineHtml(html, map) {
  let out = html;
  for (const [url, data] of map) out = out.split(url).join(data);
  return out;
}

function inlineFigmaIr(ir, map) {
  const walk = (node) => {
    if (!node) return;
    if (Array.isArray(node.fills)) {
      node.fills = node.fills
        .map((f) => {
          if (f && f.type === 'IMAGE' && f.url) {
            const data = map.get(f.url);
            return data ? { type: 'IMAGE', scaleMode: f.scaleMode || 'FILL', dataUri: data } : null;
          }
          return f;
        })
        .filter(Boolean);
      if (!node.fills.length) delete node.fills;
    }
    if (Array.isArray(node.children)) node.children.forEach(walk);
  };
  if (ir && ir.root) walk(ir.root);
  return ir;
}

function slugify(title) {
  const slug = String(title || '')
    .slice(0, 60)
    .replace(/[^a-z0-9._-]+/gi, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'capture';
}

// Run capture.js in the active tab and inline its cross-origin resources.
async function capturePage(opts) {
  const includeImages = !opts || opts.includeImages !== false;
  const tab = await activeTab();
  await sendToTab(tab.id, { type: 'odClipper:hideForCapture' });
  let cap;
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['capture.js'] });
    const [out] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (o) => window.__odCapture(o),
      args: [{ includeImages }],
    });
    cap = out && out.result;
  } finally {
    await sendToTab(tab.id, { type: 'odClipper:restoreAfterCapture' });
  }
  if (!cap || !cap.html) throw new Error('capture failed');
  const { map, skipped } = await buildResourceMap(cap.resources, includeImages);
  return {
    html: inlineHtml(cap.html, map),
    figmaIr: cap.figmaIr ? inlineFigmaIr(cap.figmaIr, map) : null,
    figmaNodeCount: cap.figmaNodeCount || 0,
    truncated: Boolean(cap.figmaTruncated),
    partialImages: skipped, // resources left as live URLs to fit the size budget
    title: cap.title || tab.title,
    url: cap.url || tab.url,
  };
}

async function capturePageToLibrary(opts) {
  const cap = await capturePage(opts);
  const figmaCapture = cap.figmaIr ? JSON.stringify(cap.figmaIr) : undefined;
  const r = await ingest({
    text: cap.html,
    kind: 'html',
    mime: 'text/html',
    sourceUrl: cap.url,
    sourceTitle: cap.title,
    tags: ['page-capture'],
    figmaCapture,
    figmaNodeCount: cap.figmaNodeCount,
  });
  return {
    deduped: Boolean(r.deduped),
    hasFigma: Boolean(figmaCapture),
    truncated: cap.truncated,
    partialImages: cap.partialImages || 0,
  };
}

async function downloadFigma(opts) {
  const cap = await capturePage(opts);
  if (!cap.figmaIr) throw new Error('no figma capture produced');
  const json = JSON.stringify(cap.figmaIr, null, 2);
  const dataUrl = `data:application/json;charset=utf-8,${encodeURIComponent(json)}`;
  await chrome.downloads.download({
    url: dataUrl,
    filename: `${slugify(cap.title)}.od-figma.json`,
    saveAs: false,
  });
  return { truncated: cap.truncated, partialImages: cap.partialImages || 0 };
}

// --- element + selected-image capture --------------------------------------

// Blob → base64 data URL (service workers have no FileReader).
async function blobToDataUrl(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return `data:${blob.type || 'image/png'};base64,${btoa(bin)}`;
}

// Crop a captured-tab PNG (data URL) to a viewport rect given in CSS pixels.
// The captured image is the visible viewport scaled by the device/zoom factor,
// so we derive the scale from the real image width vs the reported viewport
// width (robust against retina + page zoom, which a raw devicePixelRatio is
// not) and fall back to dpr when the viewport width is unknown.
async function cropToRect(tabDataUrl, rect, viewportWidth, dpr) {
  const blob = await (await fetch(tabDataUrl)).blob();
  const bmp = await createImageBitmap(blob);
  const scale = viewportWidth && bmp.width ? bmp.width / viewportWidth : dpr || 1;
  const sx = Math.max(0, Math.round((rect.x || 0) * scale));
  const sy = Math.max(0, Math.round((rect.y || 0) * scale));
  const sw = Math.max(1, Math.min(Math.round((rect.width || 0) * scale), bmp.width - sx));
  const sh = Math.max(1, Math.min(Math.round((rect.height || 0) * scale), bmp.height - sy));
  const canvas = new OffscreenCanvas(sw, sh);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bmp, sx, sy, sw, sh, 0, 0, sw, sh);
  bmp.close();
  const out = await canvas.convertToBlob({ type: 'image/png' });
  return blobToDataUrl(out);
}

// Screenshot the picked element (cropped from the visible tab) + store its
// outerHTML + metadata as one enriched image asset.
async function captureElement(payload) {
  const tab = await activeTab();
  // Only pull the bar out of frame when it overlaps the crop region (the content
  // script decides). Otherwise it stays visible with its spinner — no blink —
  // while the bar is hidden for just the screenshot itself, not the whole save.
  const hideBar = Boolean(payload.hideBar);
  if (hideBar) await sendToTab(tab.id, { type: 'odClipper:hideForCapture' });
  let tabDataUrl;
  try {
    tabDataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
  } finally {
    if (hideBar) await sendToTab(tab.id, { type: 'odClipper:restoreAfterCapture' });
  }
  const cropped = await cropToRect(tabDataUrl, payload.rect || {}, payload.viewportWidth, payload.dpr);
  const meta = payload.meta || {};
  const r = await ingest({
    dataUrl: cropped,
    kind: 'image',
    sourceUrl: payload.sourceUrl || tab.url,
    sourceTitle: payload.sourceTitle || tab.title,
    tags: ['element', meta.tag].filter(Boolean),
    elementHtml: typeof payload.elementHtml === 'string' ? payload.elementHtml : undefined,
    metadata: { element: meta },
  });
  return { deduped: Boolean(r.deduped) };
}

// Screenshot a user-dragged region (cropped from the visible tab). Same crop
// path as element capture, minus the element markup/metadata.
async function captureRegion(payload) {
  const tab = await activeTab();
  // Same as captureElement: hide the bar for the screenshot only if it would
  // land inside the cropped region.
  const hideBar = Boolean(payload.hideBar);
  if (hideBar) await sendToTab(tab.id, { type: 'odClipper:hideForCapture' });
  let tabDataUrl;
  try {
    tabDataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
  } finally {
    if (hideBar) await sendToTab(tab.id, { type: 'odClipper:restoreAfterCapture' });
  }
  const cropped = await cropToRect(tabDataUrl, payload.rect || {}, payload.viewportWidth, payload.dpr);
  const r = await ingest({
    dataUrl: cropped,
    kind: 'image',
    sourceUrl: payload.sourceUrl || tab.url,
    sourceTitle: payload.sourceTitle || tab.title,
    tags: ['region', 'screenshot'],
  });
  return { deduped: Boolean(r.deduped) };
}

// Ingest a user-chosen subset of page images (from the on-page picker).
async function ingestImages(payload) {
  const tab = await activeTab().catch(() => null);
  const images = Array.isArray(payload.images) ? payload.images.slice(0, 100) : [];
  let count = 0;
  for (const img of images) {
    if (!img || !img.src) continue;
    try {
      await ingest({
        url: img.src,
        kind: 'image',
        sourceUrl: payload.sourceUrl || (tab && tab.url),
        sourceTitle: img.alt || payload.sourceTitle || (tab && tab.title),
      });
      count += 1;
    } catch {
      // skip individual failures (hotlink-protected / oversized)
    }
  }
  return { count, total: images.length };
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    try {
      switch (msg && msg.type) {
        case 'getStatus': {
          const [daemonUrl, connected] = await Promise.all([getDaemonUrl(), probe()]);
          sendResponse({ ok: true, connected, daemonUrl });
          break;
        }
        case 'setDaemonUrl': {
          await chrome.storage.local.set({ daemonUrl: msg.url || DEFAULT_DAEMON_URL });
          const connected = await probe();
          sendResponse({ ok: true, connected });
          break;
        }
        case 'captureScreenshot': {
          const r = await captureScreenshot();
          sendResponse({ ok: true, deduped: Boolean(r.deduped) });
          break;
        }
        case 'grabImages': {
          const r = await grabImages();
          sendResponse({ ok: true, count: r.count, total: r.total });
          break;
        }
        case 'capturePageToLibrary': {
          const r = await capturePageToLibrary(msg.opts);
          sendResponse({
            ok: true,
            deduped: r.deduped,
            hasFigma: r.hasFigma,
            truncated: r.truncated,
            partialImages: r.partialImages,
          });
          break;
        }
        case 'downloadFigma': {
          const r = await downloadFigma(msg.opts);
          sendResponse({ ok: true, truncated: r.truncated, partialImages: r.partialImages });
          break;
        }
        case 'captureElement': {
          const r = await captureElement(msg);
          sendResponse({ ok: true, deduped: r.deduped });
          break;
        }
        case 'captureRegion': {
          const r = await captureRegion(msg);
          sendResponse({ ok: true, deduped: r.deduped });
          break;
        }
        case 'ingestImages': {
          const r = await ingestImages(msg);
          sendResponse({ ok: true, count: r.count, total: r.total });
          break;
        }
        default:
          sendResponse({ ok: false, error: 'unknown message' });
      }
    } catch (err) {
      sendResponse({ ok: false, error: (err && err.message) || String(err) });
    }
  })();
  return true; // keep the message channel open for the async response
});

// Right-click any image → save straight to the library.
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'od-save-image',
    title: 'Save image to Open Design Library',
    contexts: ['image'],
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== 'od-save-image' || !info.srcUrl) return;
  try {
    await ingest({
      url: info.srcUrl,
      kind: 'image',
      sourceUrl: tab && tab.url,
      sourceTitle: tab && tab.title,
    });
  } catch {
    // best-effort; the popup surfaces detailed errors
  }
});
