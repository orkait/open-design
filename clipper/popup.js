// Open Design web clipper popup. Thin UI over the service worker message API.
//
// Zero-config: no pairing. The popup just probes whether Open Design is running
// and lets you capture. The daemon URL lives under "Advanced" for the rare case
// you ran the daemon on a non-default port.

const $ = (id) => document.getElementById(id);

function send(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (res) => resolve(res || { ok: false, error: 'no response' }));
  });
}

function activeTabId() {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => resolve(tabs && tabs[0] && tabs[0].id));
  });
}

function activeTab() {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => resolve((tabs && tabs[0]) || null));
  });
}

// Only http(s) pages can ever host the content script. chrome://, the Web Store,
// view-source:, and the like are off-limits — a refresh wouldn't help there.
function isInjectable(url) {
  return typeof url === 'string' && /^https?:\/\//i.test(url);
}

// Inject the content script into a tab that doesn't have it yet. This is the
// common state right after the extension is installed or updated: already-open
// tabs never received the auto-injected script. Re-injection is safe — content.js
// guards itself with window.__odClipperInjected. Returns true on success.
async function injectContentScript(tabId) {
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
    return true;
  } catch {
    return false;
  }
}

// Message the active tab's content script directly (the on-page bar lives
// there). Resolves undefined when there is no receiver (e.g. a chrome:// page).
function sendToTab(tabId, message) {
  return new Promise((resolve) => {
    try {
      chrome.tabs.sendMessage(tabId, message, (res) => {
        void chrome.runtime.lastError;
        resolve(res);
      });
    } catch {
      resolve(undefined);
    }
  });
}

// Liveness probe against the content script. A truthy answer means a live
// listener is attached — distinguishing a dead/missing script (recoverable by
// re-inject or reload) from a genuinely restricted page (nothing can attach).
function pingTab(tabId) {
  return sendToTab(tabId, { type: 'odClipper:ping' }).then((r) => Boolean(r && r.ok));
}

// Poll until the (reloaded) tab's content script answers, or time out.
async function waitForAttach(tabId, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await pingTab(tabId)) return true;
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

// Message the content script, attaching it first if the tab never received it.
// A tab that was already open when the extension was installed or reloaded has
// no content script, so the first sendMessage finds no receiver. Rather than
// dead-ending on "hasn't attached yet" and forcing a manual page refresh, inject
// content.js in place (no reload, no lost page state) and retry once — so the
// on-page actions just work. Re-injection is a no-op when the script is already
// there (content.js guards with window.__odClipperInjected).
async function sendToTabEnsuringScript(tabId, url, message) {
  const res = await sendToTab(tabId, message);
  if (res && res.ok) return res;
  if (!isInjectable(url)) return res;
  if (!(await injectContentScript(tabId))) return res;
  return sendToTab(tabId, message);
}

function setMsg(text, kind) {
  const el = $('msg');
  el.textContent = text || '';
  el.dataset.kind = kind || '';
  // Any fresh status replaces the previous one, so retire a stale refresh prompt.
  hideRefresh();
}

// Lock + dim the capture buttons while a capture is in flight, so the spinner
// status reads as the active state and the user can't double-fire a capture.
function setBusy(on) {
  document.body.classList.toggle('busy', Boolean(on));
}

// The "Refresh page" affordance and the action to retry once the page is ready.
let pendingRetry = null;

function showRefresh(retryFn) {
  pendingRetry = retryFn;
  const btn = $('refresh-page');
  if (btn) {
    btn.hidden = false;
    btn.classList.remove('spinning');
  }
}

function hideRefresh() {
  pendingRetry = null;
  const btn = $('refresh-page');
  if (btn) {
    btn.hidden = true;
    btn.classList.remove('spinning');
  }
}

function render(connected) {
  const status = $('status');
  status.textContent = connected ? 'Connected' : 'Offline';
  status.dataset.paired = connected ? 'true' : 'false';
  $('hint').hidden = connected;
  // Capture stays available even when disconnected; the buttons surface a clear
  // "Open Design not running" message instead of being hidden, so it never feels broken.
}

function renderToolbar(visible) {
  const btn = $('toolbar-toggle');
  if (!btn) return;
  btn.setAttribute('aria-checked', visible ? 'true' : 'false');
}

async function refresh() {
  const res = await send({ type: 'getStatus' });
  if (res.ok) {
    $('daemon').value = res.daemonUrl || '';
    render(Boolean(res.connected));
  }
  try {
    const { toolbarVisible, imageHoverCapture } = await chrome.storage.local.get([
      'toolbarVisible',
      'imageHoverCapture',
    ]);
    renderToolbar(Boolean(toolbarVisible));
    const hv = $('image-hover');
    // Default-on: only an explicit `false` turns the switch off.
    if (hv) hv.setAttribute('aria-checked', imageHoverCapture === false ? 'false' : 'true');
  } catch {
    renderToolbar(false);
  }
}

function reportCapture(res, okText) {
  setBusy(false);
  if (res.ok) {
    setMsg(okText(res), 'ok');
    return;
  }
  if (res.error === 'not running') {
    setMsg('Open Design isn’t running — start the app first.', 'err');
    void refresh();
  } else {
    setMsg(`Failed: ${res.error || 'unknown'}`, 'err');
  }
}

$('save-daemon').addEventListener('click', async () => {
  const url = $('daemon').value.trim();
  const res = await send({ type: 'setDaemonUrl', url });
  render(Boolean(res.connected));
  setMsg(res.connected ? 'Saved — connected.' : 'Saved, but Open Design wasn’t detected at that URL.', res.connected ? 'ok' : 'err');
});

// Capture options shared by the page / figma actions.
function captureOpts() {
  const el = $('include-images');
  return { includeImages: el ? el.checked : true };
}

$('page').addEventListener('click', async () => {
  setBusy(true);
  setMsg('Capturing page…', 'loading');
  const res = await send({ type: 'capturePageToLibrary', opts: captureOpts() });
  reportCapture(res, (r) => {
    if (r.deduped) return 'Page already in library.';
    // A very large page is captured at reduced fidelity rather than failing:
    // the layout (Figma IR) may be partial and/or some images stay as live
    // links. Tell the user when either happened so the result isn't surprising.
    const notes = [];
    if (r.truncated) notes.push('large page — partial layout');
    if (r.partialImages) {
      notes.push(`${r.partialImages} image${r.partialImages === 1 ? '' : 's'} left as links`);
    }
    const suffix = notes.length ? ` (${notes.join('; ')})` : '';
    return r.hasFigma
      ? `Saved page + Figma capture${suffix} to library.`
      : `Saved page${suffix} to library.`;
  });
});

$('figma').addEventListener('click', async () => {
  setBusy(true);
  setMsg('Building Figma capture…', 'loading');
  const res = await send({ type: 'downloadFigma', opts: captureOpts() });
  reportCapture(res, () => 'Figma file downloaded — import it with the Open Design Figma plugin.');
});

$('shot').addEventListener('click', async () => {
  setBusy(true);
  setMsg('Capturing screenshot…', 'loading');
  const res = await send({ type: 'captureScreenshot' });
  reportCapture(res, (r) => (r.deduped ? 'Already in library.' : 'Screenshot saved to library.'));
});

// Open an on-page surface (element picker / image picker) in the active tab,
// then close the popup so the page has focus for the interaction.
async function openOnPage(message, startedMsg, unavailableMsg) {
  const tab = await activeTab();
  const tabId = tab && tab.id;
  if (!tabId) {
    setMsg('Open a normal web page to use this.', 'err');
    return;
  }
  const res = await sendToTabEnsuringScript(tabId, tab.url, message);
  if (!res || !res.ok) {
    // We already tried to attach the content script in place and it still didn't
    // answer — fall back to a real reload, which is the last thing that can help
    // on an injectable page. On a restricted page (chrome://, the Web Store, …)
    // nothing can attach, so say so plainly.
    if (isInjectable(tab.url)) {
      setMsg('Open Design hasn’t attached to this page yet.', 'err');
      showRefresh(() => openOnPage(message, startedMsg, unavailableMsg));
    } else {
      setMsg(unavailableMsg, 'err');
    }
    return;
  }
  setMsg(startedMsg, 'ok');
  setTimeout(() => window.close(), 200);
}

$('element')?.addEventListener('click', () =>
  openOnPage(
    { type: 'odClipper:pickElement' },
    'Click an element on the page…',
    'The element picker isn’t available on this page — try a normal website.',
  ),
);

$('imgs')?.addEventListener('click', () =>
  openOnPage(
    { type: 'odClipper:pickImages' },
    'Pick images on the page…',
    'The image picker isn’t available on this page — try a normal website.',
  ),
);

$('region')?.addEventListener('click', () =>
  openOnPage(
    { type: 'odClipper:pickRegion' },
    'Drag a region on the page…',
    'Region capture isn’t available on this page — try a normal website.',
  ),
);

$('toolbar-toggle').addEventListener('click', async function toggleToolbar() {
  const tab = await activeTab();
  const tabId = tab && tab.id;
  if (!tabId) {
    setMsg('Open a normal web page to use the on-page bar.', 'err');
    return;
  }
  const res = await sendToTabEnsuringScript(tabId, tab.url, { type: 'odClipper:setToolbar', mode: 'toggle' });
  if (!res || !res.ok) {
    if (isInjectable(tab.url)) {
      setMsg('Open Design hasn’t attached to this page yet.', 'err');
      showRefresh(toggleToolbar);
    } else {
      setMsg('The on-page bar isn’t available on this page — try a normal website.', 'err');
    }
    return;
  }
  renderToolbar(Boolean(res.visible));
  setMsg(res.visible ? 'On-page bar shown.' : 'On-page bar hidden.', 'ok');
});

// Per-image hover capture toggle. Persisted to storage so it applies to every
// tab (including ones without a content script yet) and pushed to the active
// tab's content script for an immediate effect. No on-page surface is needed,
// so this works even where the content script can't attach.
$('image-hover')?.addEventListener('click', async () => {
  const btn = $('image-hover');
  const next = btn.getAttribute('aria-checked') !== 'true';
  btn.setAttribute('aria-checked', next ? 'true' : 'false');
  try {
    await chrome.storage.local.set({ imageHoverCapture: next });
  } catch {
    // storage unavailable — the per-tab message below still applies it live
  }
  const tab = await activeTab();
  if (tab && tab.id) void sendToTab(tab.id, { type: 'odClipper:setImageHover', enabled: next });
  setMsg(next ? 'Image hover button on.' : 'Image hover button off.', 'ok');
});

// Recover from a tab that never received the content script. Inject it in place
// (no reload, no lost page state) and re-run the action; fall back to a real
// reload only when the page is too restricted to inject into.
$('refresh-page')?.addEventListener('click', async () => {
  const btn = $('refresh-page');
  if (!btn || btn.classList.contains('spinning')) return;
  const retry = pendingRetry;
  btn.classList.add('spinning');
  const tabId = await activeTabId();
  if (!tabId) {
    hideRefresh();
    return;
  }
  // First try a no-reload re-injection (keeps page state). Verify with a ping
  // that a LIVE listener actually answered — a stale context can swallow the
  // executeScript without re-arming a listener, so its resolve alone isn't
  // proof the page is reachable.
  await injectContentScript(tabId);
  if (await pingTab(tabId)) {
    if (typeof retry === 'function') await retry();
    else setMsg('Ready — try again.', 'ok');
    return;
  }
  // Couldn't re-arm in place → genuinely reload and wait for the fresh content
  // script to attach, then resume the original action.
  setMsg('Reloading the page…');
  chrome.tabs.reload(tabId);
  if (await waitForAttach(tabId, 6000)) {
    if (typeof retry === 'function') await retry();
    else setMsg('Ready — try again.', 'ok');
  } else {
    hideRefresh();
    setMsg('Reloaded — reopen this popup to continue.', 'ok');
  }
});

void refresh();
