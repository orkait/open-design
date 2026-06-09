// Baked plugin preview clips — the daemon side of scripts/bake-plugin-previews.mjs.
//
// The home gallery renders html plugins as live, scaled hover-pan iframes, which
// is GPU-expensive at scale. When a plugin has a pre-baked preview (a small VP9
// `.webm` hover-pan clip + a poster `.jpg`), we rewrite that plugin's record so
// its `od.preview` becomes a `video` block. The web gallery's `inferPluginPreview`
// then classifies it as `media` and renders a cheap poster + hover-play `<video>`
// (MediaSurface) instead of a live iframe. Plugins without a bake are left
// untouched and keep the live-iframe path as the fallback.
//
// Files + a `manifest.json` live under `<dir>` (OD_PLUGIN_PREVIEWS_DIR, default
// `<project>/.od/plugin-previews`). CI bakes them and uploads to R2; the daemon
// serves whatever is present locally at `/api/plugin-previews/<file>`.

import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

export const PLUGIN_PREVIEWS_ROUTE = '/api/plugin-previews';

interface BakeEntry {
  video: string;
  poster: string;
  holdMs?: number;
  durationMs?: number;
}

export interface BakedPreviewBlock {
  poster: string;
  video: string;
  holdMs?: number;
}

export function resolvePluginPreviewsDir(projectRoot: string): string {
  const env = process.env.OD_PLUGIN_PREVIEWS_DIR;
  if (env) return path.isAbsolute(env) ? env : path.resolve(projectRoot, env);
  return path.join(projectRoot, '.od', 'plugin-previews');
}

let cache: { dir: string; mtimeMs: number; previews: Record<string, BakeEntry> } | null = null;

function loadManifest(dir: string): Record<string, BakeEntry> {
  const manifestPath = path.join(dir, 'manifest.json');
  if (!existsSync(manifestPath)) return {};
  try {
    const mtimeMs = statSync(manifestPath).mtimeMs;
    if (cache && cache.dir === dir && cache.mtimeMs === mtimeMs) return cache.previews;
    const parsed = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      previews?: Record<string, BakeEntry>;
    };
    const previews = parsed.previews ?? {};
    cache = { dir, mtimeMs, previews };
    return previews;
  } catch {
    return {};
  }
}

export function bakedPreviewBlock(id: string, dir: string): BakedPreviewBlock | null {
  const entry = loadManifest(dir)[id];
  if (!entry || !entry.video || !entry.poster) return null;
  return {
    poster: `${PLUGIN_PREVIEWS_ROUTE}/${entry.poster}`,
    video: `${PLUGIN_PREVIEWS_ROUTE}/${entry.video}`,
    ...(typeof entry.holdMs === 'number' ? { holdMs: entry.holdMs } : {}),
  };
}

// Attach the baked clip under `manifest.od.bakedPreview` (a SEPARATE field —
// we deliberately do NOT overwrite `od.preview`). The gallery card opts into the
// baked clip via `inferPluginPreview(record, { preferBaked: true })`, while the
// detail modal keeps reading the real `od.preview` and renders the live,
// interactive page. Records are shallow-cloned so registry rows stay pure.
export function applyBakedPreviews<T extends { id: string; manifest?: unknown }>(
  records: T[],
  dir: string,
): T[] {
  const previews = loadManifest(dir);
  if (Object.keys(previews).length === 0) return records;
  return records.map((rec) => {
    const block = bakedPreviewBlock(rec.id, dir);
    if (!block) return rec;
    const manifest = { ...((rec.manifest ?? {}) as Record<string, unknown>) };
    const od = { ...((manifest.od ?? {}) as Record<string, unknown>) };
    od.bakedPreview = block;
    manifest.od = od;
    return { ...rec, manifest };
  });
}
