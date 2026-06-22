import { BrowserWindow, nativeImage } from "electron";
import type { DesktopRenderSlidesInput, DesktopRenderSlidesResult } from "@open-design/sidecar-proto";

import { waitForPrintableContent } from "./pdf-export.js";

// Deck slides are authored at 1920x1080 (16:9). We render at that logical size
// and let Electron's capturePage emit the display's native pixel scale (2x on
// retina => 3840x2160), so the PNGs are at least FHD and pixel-perfect to the
// browser. This reuses the bundled Electron Chromium — no second headless
// engine, so the packaged app does not grow.
const SLIDE_W = 1920;
const SLIDE_H = 1080;

// Chrome the live deck adds (presenter overlays, the auto-managed progress bar,
// nav hints) must not bleed into a captured slide. Mirrors the print-hide list
// in design-templates/html-ppt/assets/runtime.js.
const HIDE_CHROME_SELECTOR =
  ".progress-bar, .notes-overlay, .overview, .notes, aside.notes, .speaker-notes, .deck-nav, .deck-hint, .deck-counter";

// Real deck slides only. runtime.js clones zero-size `.slide` nodes into
// `.mini-slide` for presenter mode; capturing those would emit blank pages, so
// we scope to direct children of the deck root.
const SLIDE_SELECTOR = ".deck > .slide, body > .slide";

/**
 * Renders an HTML deck to one PNG per slide using a hidden Electron window.
 * The window is shown fully transparent and inactive so the GPU compositor
 * paints it (capturePage needs a live frame) without any visible flash or
 * focus theft, then destroyed.
 */
export async function renderDeckSlides(
  input: DesktopRenderSlidesInput,
): Promise<DesktopRenderSlidesResult> {
  const window = new BrowserWindow({
    width: SLIDE_W,
    height: SLIDE_H,
    useContentSize: true,
    show: false,
    // The deck is 1920x1080. Without this, macOS clamps a window taller than
    // the work area (laptop displays), so the content viewport comes back
    // shorter than 1080 and slides capture at the wrong aspect ratio.
    enableLargerThanScreen: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event) => event.preventDefault());

  try {
    const doc = injectBaseHref(input.html, input.baseHref);
    await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(doc)}`);
    await waitForPrintableContent(window);

    // Force the exact content surface so the capture viewport is a true
    // 1920x1080 regardless of the host display size.
    window.setContentSize(SLIDE_W, SLIDE_H);

    // Paint invisibly: opacity 0 before showInactive => compositor renders the
    // page (so capturePage returns real pixels) with zero on-screen flash.
    window.setOpacity(0);
    window.showInactive();

    const count = (await window.webContents.executeJavaScript(
      `(${prepareDeck.toString()})(${JSON.stringify(SLIDE_SELECTOR)}, ${JSON.stringify(HIDE_CHROME_SELECTOR)})`,
      true,
    )) as number;

    // No `.slide` sections — this is an ordinary page (e.g. a website), not a
    // deck. Capture the whole document at its natural size instead of forcing a
    // 1920x1080 slide. This is what image export of a non-deck artifact wants.
    if (!Number.isInteger(count) || count < 1) {
      return await capturePage(window);
    }

    // Deck: pin the 1920x1080 stage, then render every slide (or just the one
    // requested by image export).
    await window.webContents.executeJavaScript(`(${pinDeckStage.toString()})()`, true);
    const indices =
      input.index != null && input.index >= 0 && input.index < count ? [input.index] : range(count);
    const slides: string[] = [];
    let width = SLIDE_W;
    let height = SLIDE_H;
    for (const i of indices) {
      await window.webContents.executeJavaScript(
        `(${showSlide.toString()})(${JSON.stringify(SLIDE_SELECTOR)}, ${i})`,
        true,
      );
      // Let the style change + layout settle for two frames before capture.
      await window.webContents.executeJavaScript(
        "new Promise(function(r){requestAnimationFrame(function(){requestAnimationFrame(function(){r(true)})})})",
        true,
      );
      // Clip to the exact 16:9 slide rect (DIP) so the PNG aspect is always
      // correct even if the window content rounds differently.
      const image = await window.webContents.capturePage({ x: 0, y: 0, width: SLIDE_W, height: SLIDE_H });
      const size = image.getSize();
      width = size.width;
      height = size.height;
      slides.push(image.toDataURL());
    }
    return { ok: true, slides, width, height, mode: "deck" };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  } finally {
    if (!window.isDestroyed()) window.destroy();
  }
}

// Ordinary (non-deck) page: capture the WHOLE document as one long image at a
// fixed desktop width, viewport-independent.
const PAGE_W = 1440;
// Logical viewport height used for the scroll-segment fallback.
const PAGE_VIEW_H = 1000;
// RAM budget for the stitched output buffer (~RGBA). Bounds the worst-case
// output height regardless of how tall the page is.
const PAGE_RAM_BUDGET_BYTES = 320 * 1024 * 1024;
// Conservative floor for the per-machine GPU texture limit if we cannot query
// it (older/integrated GPUs can be as low as this).
const FALLBACK_MAX_TEXTURE = 8192;

/**
 * Captures an ordinary page as one long, viewport-independent image. Picks the
 * technique automatically (the caller and the user only ever see "full page"):
 *  1) Chromium's `captureBeyondViewport` — one clean off-screen pass; fixed
 *     elements are NOT duplicated. Used when the output fits the machine's real
 *     GPU texture limit AND below-the-fold content actually rendered.
 *  2) scroll-segment stitch — when (1) would exceed the texture limit, errors,
 *     or comes back blank below the fold (scroll-driven pages). RAM-bound, so it
 *     handles arbitrarily long pages; capped by a memory budget.
 */
async function capturePage(window: BrowserWindow): Promise<DesktopRenderSlidesResult> {
  // Lay the document out at a desktop width first so width-dependent content
  // (responsive layouts) renders the way a desktop visitor sees it.
  window.setContentSize(PAGE_W, PAGE_VIEW_H);
  await nextFrames(window);

  const maxTexture = await queryMaxTextureSize(window);
  // The window's device-pixel-ratio already scales the capture (2 on retina),
  // exactly like the deck path's capturePage. Report real px via it.
  const dpr = await queryDevicePixelRatio(window);
  const outW = PAGE_W * dpr;
  const ramMaxOutH = Math.floor(PAGE_RAM_BUDGET_BYTES / (outW * 4));

  const dbg = window.webContents.debugger;
  let attached = false;
  try {
    dbg.attach("1.3");
    attached = true;
  } catch {
    // already attached or unavailable — scroll-segment fallback below
  }

  try {
    if (attached) {
      await dbg.sendCommand("Page.enable");
      // Measure the document height in CSS px directly (CDP contentSize is in
      // device px in this Electron, which would double-scale). Clip width to the
      // desktop viewport we laid out at — horizontal overflow is rare and a
      // desktop-width capture is what we want.
      const measuredH = (await window.webContents.executeJavaScript(
        "Math.ceil(Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0))",
        true,
      )) as number;
      const docW = PAGE_W;
      const docH = Math.max(1, Number.isFinite(measuredH) ? measuredH : PAGE_VIEW_H);
      const outWpx = docW * dpr;
      const outHpx = docH * dpr;

      // captureBeyondViewport is viable only when the single output texture fits
      // the machine's real limit on BOTH axes and within the RAM budget.
      const fitsSinglePass =
        outWpx <= maxTexture && outHpx <= maxTexture && outHpx <= ramMaxOutH;
      if (fitsSinglePass && !(await isBelowFoldBlank(dbg, docW, docH))) {
        // scale:1 — the window DPR already provides the pixel scale, so this
        // avoids double-scaling (DPR x clip.scale).
        const shot = (await dbg.sendCommand("Page.captureScreenshot", {
          format: "png",
          captureBeyondViewport: true,
          clip: { x: 0, y: 0, width: docW, height: docH, scale: 1 },
        })) as { data: string };
        return {
          ok: true,
          slides: [`data:image/png;base64,${shot.data}`],
          width: outWpx,
          height: outHpx,
          mode: "page",
        };
      }
      // Otherwise fall through to scroll-segment (too tall, or blank below fold).
      const cappedLogicalH = Math.min(docH, Math.floor(ramMaxOutH / dpr));
      return await scrollSegmentStitch(window, cappedLogicalH);
    }
  } catch {
    // CDP path failed — fall through to scroll-segment.
  } finally {
    if (attached) {
      try {
        dbg.detach();
      } catch {
        // ignore
      }
    }
  }

  // No debugger available: measure + scroll-segment.
  const measured = (await window.webContents.executeJavaScript(
    "Math.ceil(Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0))",
    true,
  )) as number;
  const totalLogical = Math.max(
    PAGE_VIEW_H,
    Math.min(Number.isFinite(measured) ? measured : PAGE_VIEW_H, Math.floor(ramMaxOutH / dpr)),
  );
  return await scrollSegmentStitch(window, totalLogical);
}

// Window device-pixel-ratio (2 on retina). capturePage / captureScreenshot both
// scale the output by it, so we use it to compute real output pixel sizes.
async function queryDevicePixelRatio(window: BrowserWindow): Promise<number> {
  try {
    const v = (await window.webContents.executeJavaScript("window.devicePixelRatio || 1", true)) as number;
    return Number.isFinite(v) && v > 0 ? v : 1;
  } catch {
    return 1;
  }
}

// Reads the GPU's real max texture size so the single-pass/stitch threshold
// adapts to the user's hardware instead of a hard-coded guess.
async function queryMaxTextureSize(window: BrowserWindow): Promise<number> {
  try {
    const v = (await window.webContents.executeJavaScript(
      `(function(){try{var c=document.createElement('canvas');var gl=c.getContext('webgl2')||c.getContext('webgl');return gl?gl.getParameter(gl.MAX_TEXTURE_SIZE):0}catch(e){return 0}})()`,
      true,
    )) as number;
    return Number.isFinite(v) && v > 0 ? v : FALLBACK_MAX_TEXTURE;
  } catch {
    return FALLBACK_MAX_TEXTURE;
  }
}

// Probes whether everything below the first viewport came back as one flat
// (near-)uniform color — the signature of a scroll-driven page that renders
// blank below the fold under captureBeyondViewport. Uses a tiny low-res capture
// so we never decode the full image.
async function isBelowFoldBlank(
  dbg: Electron.Debugger,
  docW: number,
  docH: number,
): Promise<boolean> {
  const fold = PAGE_VIEW_H;
  if (docH <= fold * 2) return false; // too short for below-fold blanking to matter
  try {
    const probeScale = 0.05;
    const shot = (await dbg.sendCommand("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: true,
      clip: { x: 0, y: fold, width: docW, height: docH - fold, scale: probeScale },
    })) as { data: string };
    // Decode the tiny probe with Electron's native decoder (well within Skia
    // limits at this size); toBitmap() returns BGRA — channel order is irrelevant
    // for a uniformity check.
    const data = nativeImage.createFromBuffer(Buffer.from(shot.data, "base64")).toBitmap();
    if (data.length < 16) return false;
    const c0 = data[0]!;
    const c1 = data[1]!;
    const c2 = data[2]!;
    let uniform = 0;
    const total = data.length / 4;
    for (let i = 0; i < data.length; i += 4) {
      if (
        Math.abs(data[i]! - c0) <= 6 &&
        Math.abs(data[i + 1]! - c1) <= 6 &&
        Math.abs(data[i + 2]! - c2) <= 6
      ) {
        uniform++;
      }
    }
    // >92% of the below-fold area is one flat color => it did not render.
    return uniform / total > 0.92;
  } catch {
    return false;
  }
}

// Scrolls the page one viewport at a time, captures each frame, and stitches
// them by real scroll offset into one tall BGRA buffer, then encodes once with
// Electron's native PNG encoder. Stitching is a single Buffer.copy per chunk
// (no per-pixel JS, no channel swap — capturePage already gives BGRA, which is
// what createFromBitmap wants) and the encode is native C++, so this is fast
// even for long pages. createFromBitmap is a CPU bitmap, so it is NOT bound by
// the GPU texture limit; height is bounded only by the caller's RAM cap.
async function scrollSegmentStitch(
  window: BrowserWindow,
  totalLogical: number,
): Promise<DesktopRenderSlidesResult> {
  window.setContentSize(PAGE_W, PAGE_VIEW_H);
  await nextFrames(window);
  const maxScroll = Math.max(0, totalLogical - PAGE_VIEW_H);

  // Scale (DPR) is derived from the first captured chunk so placement is correct
  // regardless of the display's pixel ratio.
  let scale = 0;
  let W = 0;
  let H = 0;
  let bgra: Buffer | null = null;

  for (let y = 0; ; y += PAGE_VIEW_H) {
    const target = Math.min(y, maxScroll);
    const actualY = (await window.webContents.executeJavaScript(
      `(function(){window.scrollTo(0, ${target});return new Promise(function(r){requestAnimationFrame(function(){requestAnimationFrame(function(){setTimeout(function(){r(Math.round(window.scrollY||window.pageYOffset||0))},180)})})})})()`,
      true,
    )) as number;
    const image = await window.webContents.capturePage({ x: 0, y: 0, width: PAGE_W, height: PAGE_VIEW_H });
    const bmp = image.toBitmap(); // BGRA
    const size = image.getSize();
    if (!bgra) {
      scale = Math.max(1, Math.round(size.width / PAGE_W));
      W = PAGE_W * scale;
      H = totalLogical * scale;
      bgra = Buffer.alloc(W * H * 4);
    }
    // Chunk width matches W (captured at PAGE_W), so each chunk's rows are
    // contiguous and full-width — copy the whole block in one native memcpy.
    if (size.width === W) {
      const destStart = actualY * scale * W * 4;
      const rows = Math.min(size.height, H - actualY * scale);
      bmp.copy(bgra, destStart, 0, rows * W * 4);
    } else {
      // Defensive: width mismatch — copy row by row (still native per-row copy).
      const rows = Math.min(size.height, H - actualY * scale);
      for (let r = 0; r < rows; r++) {
        bmp.copy(bgra, (actualY * scale + r) * W * 4, r * size.width * 4, r * size.width * 4 + Math.min(size.width, W) * 4);
      }
    }
    if (target >= maxScroll) break;
  }

  const png = nativeImage
    .createFromBitmap(bgra ?? Buffer.alloc(4), { width: W || 1, height: H || 1 })
    .toPNG();
  return {
    ok: true,
    slides: [`data:image/png;base64,${png.toString("base64")}`],
    width: W,
    height: H,
    mode: "page",
  };
}

function range(n: number): number[] {
  return Array.from({ length: n }, (_, i) => i);
}

async function nextFrames(window: BrowserWindow): Promise<void> {
  await window.webContents.executeJavaScript(
    "new Promise(function(r){requestAnimationFrame(function(){requestAnimationFrame(function(){r(true)})})})",
    true,
  );
}

function injectBaseHref(doc: string, baseHref: string | undefined): string {
  if (!baseHref) return doc;
  const tag = `<base href="${escapeHtmlAttribute(baseHref)}">`;
  if (/<head[^>]*>/i.test(doc)) return doc.replace(/<head[^>]*>/i, (match) => `${match}${tag}`);
  if (/<html[^>]*>/i.test(doc)) return doc.replace(/<html[^>]*>/i, (match) => `${match}<head>${tag}</head>`);
  return `<!doctype html><html><head>${tag}</head><body>${doc}</body></html>`;
}

function escapeHtmlAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// --- Functions serialized into the page (kept dependency-free) ---

function prepareDeck(slideSelector: string, hideSelector: string): number {
  document.querySelectorAll(hideSelector).forEach((el) => {
    (el as HTMLElement).style.setProperty("display", "none", "important");
  });
  return document.querySelectorAll(slideSelector).length;
}

// Deck-only: pin to an exact 1920x1080 stage so each slide captures
// deterministically. NOT applied in page mode — an ordinary page must keep its
// natural width/height.
function pinDeckStage(): void {
  const style = document.createElement("style");
  style.textContent =
    "html,body{margin:0!important;padding:0!important;width:1920px!important;height:1080px!important;overflow:hidden!important}" +
    ".deck{width:1920px!important;height:1080px!important}";
  document.head.appendChild(style);
}

function showSlide(slideSelector: string, index: number): void {
  const slides = Array.from(document.querySelectorAll(slideSelector));
  slides.forEach((node, k) => {
    const el = node as HTMLElement;
    el.style.transition = "none";
    el.style.animation = "none";
    el.style.opacity = k === index ? "1" : "0";
    el.style.transform = "none";
    el.style.pointerEvents = k === index ? "auto" : "none";
    el.style.zIndex = k === index ? "999" : "0";
  });
}
