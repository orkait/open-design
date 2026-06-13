// Brand engine — public API consumed by brand-routes.ts.
//
// A "brand" = brand metadata (brand.json + meta.json under
// `<brandsRoot>/<id>/`) PLUS a generated user design system. Extraction is a
// deterministic pipeline:
//   1. prefetch  — fetch the site, measure colors/fonts, download logos
//   2. preview   — brandFromMaterial → a usable provisional Brand
//   3. system    — brandToDesignMd → createUserDesignSystem, storing the
//                  resulting `user:<id>` design-system id in brand meta so
//                  selecting the brand in the composer reuses the EXISTING
//                  designSystemId apply flow (no parallel brandId path).
//
// Every step streams a BrandExtractEvent. extractBrand never throws out of the
// function: any failure emits `{ event: 'error' }` and marks meta failed.

import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import type {
  Brand,
  BrandDetailResponse,
  BrandExtractEvent,
  BrandMeta,
  BrandSummary,
  ProjectMetadata,
} from '@open-design/contracts';

import {
  createUserDesignSystem,
  deleteUserDesignSystem,
  linkUserDesignSystemProject,
} from '../design-systems.js';
import {
  getProject,
  insertConversation,
  insertProject,
  updateProject,
} from '../db.js';
import { writeProjectFile } from '../projects.js';
import { brandGuideMd, brandToDesignMd } from './design-md.js';
import { prefetchBrand } from './prefetch.js';
import { brandFromMaterial } from './provisional.js';
import { brandSystemDir, rebuildSystem } from './system.js';
import {
  createBrandDir,
  deleteBrandDir,
  listBrandIds,
  newBrandId,
  patchMeta,
  readBrand,
  readBrandGuide,
  readMeta,
  resolveBrandFile,
  writeBrand,
  writeBrandGuide,
} from './store.js';

export type {
  ColorCandidate,
  FontCandidate,
  LogoCandidate,
  PrefetchResult,
} from './prefetch.js';
export { brandFromMaterial } from './provisional.js';
export { brandToDesignMd, brandGuideMd } from './design-md.js';
export { extractJsonBlock, validateBrand } from './validate.js';

export type ExtractBrandOptions = {
  url: string;
  brandsRoot: string;
  userDesignSystemsRoot: string;
  projectsRoot?: string;
  db?: Parameters<typeof insertProject>[0];
  randomId?: () => string;
  onEvent: (e: BrandExtractEvent) => void;
  signal?: AbortSignal;
};

/** Normalize a user-typed URL: prepend https:// when no scheme is present;
 *  reject anything that isn't http(s). Returns null when unusable. */
function normalizeUrl(raw: string): string | null {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  return parsed.href;
}

/**
 * Extract a brand from a URL, streaming progress events. Never throws —
 * failures emit `{ event: 'error' }` and mark the brand meta `failed`.
 */
export async function extractBrand(opts: ExtractBrandOptions): Promise<void> {
  const {
    brandsRoot,
    userDesignSystemsRoot,
    projectsRoot,
    db,
    randomId,
    onEvent,
    signal,
  } = opts;

  const url = normalizeUrl(opts.url);
  if (!url) {
    onEvent({ event: 'error', message: 'Enter a valid http(s) website URL.' });
    return;
  }

  const id = newBrandId(url);
  const projectId = brandProjectId(id);
  let created = false;
  try {
    const now = Date.now();
    const meta: BrandMeta = {
      id,
      sourceUrl: url,
      createdAt: now,
      updatedAt: now,
      status: 'extracting',
      projectId,
    };
    createBrandDir(brandsRoot, id, meta);
    created = true;
    onEvent({ event: 'created', id, projectId });

    if (signal?.aborted) throw new Error('aborted');

    // ── phase 1: prefetch ──
    onEvent({ event: 'phase', phase: 'prefetch' });
    const dir = resolveBrandFile(brandsRoot, id, []);
    if (!dir) throw new Error('could not resolve brand directory');
    const material = await prefetchBrand(url, dir, (step, detail) => {
      onEvent(detail === undefined ? { event: 'prefetch', step } : { event: 'prefetch', step, detail });
    });
    if (!material) {
      patchMeta(brandsRoot, id, { status: 'failed', error: 'Could not fetch the site.' });
      onEvent({ event: 'error', message: 'Could not fetch the site.' });
      return;
    }
    onEvent({
      event: 'prefetch-done',
      colors: material.colors.length,
      fonts: material.fonts.length,
      logos: material.logos.length,
      thin: material.thin,
    });

    if (signal?.aborted) throw new Error('aborted');

    // ── phase 2: preview (deterministic provisional brand) ──
    onEvent({ event: 'phase', phase: 'preview' });
    const brand = brandFromMaterial(material, url);
    writeBrand(brandsRoot, id, brand);
    writeBrandGuide(brandsRoot, id, brandGuideMd(brand));
    onEvent({ event: 'preview', brand });

    if (signal?.aborted) throw new Error('aborted');

    // ── phase 3: register the user design system ──
    onEvent({ event: 'phase', phase: 'system' });
    const systemBuild = await rebuildSystem(brandsRoot, id);
    let designSystemId: string | undefined;
    let projectReady = false;
    try {
      const body = brandToDesignMd(brand);
      const summary = await createUserDesignSystem(userDesignSystemsRoot, {
        title: brand.name,
        category: 'Brands',
        surface: 'web',
        status: 'published',
        artifactMode: 'agent-managed',
        body,
        provenance: {
          ...(brand.description ? { companyBlurb: brand.description } : {}),
          sourceNotes: `Extracted from ${url}`,
        },
      });
      designSystemId = summary.id;
      syncBrandSystemToUserDesignSystem(userDesignSystemsRoot, designSystemId, brandsRoot, id, body);
    } catch (err) {
      throw new Error(`Could not register brand design system: ${errorMessage(err)}`);
    }
    if (!designSystemId) {
      throw new Error('Could not register brand design system: missing design system id');
    }

    if (projectsRoot && db) {
      const projectArgs: BrandProjectArgs = {
        brandsRoot,
        projectsRoot,
        db,
        brandId: id,
        projectId,
        brand,
        url,
        systemFiles: systemBuild.files,
        designSystemId,
      };
      if (randomId) projectArgs.randomId = randomId;
      await createOrUpdateBrandProject(projectArgs);
      projectReady = true;
      if (designSystemId) {
        await linkUserDesignSystemProject(userDesignSystemsRoot, designSystemId, projectId);
      }
    }

    patchMeta(brandsRoot, id, {
      designSystemId,
      systemFiles: systemBuild.files,
      ...(projectReady ? { projectId } : {}),
    });
    onEvent({
      event: 'system',
      ok: true,
      designSystemId,
      files: systemBuild.files,
      ...(projectReady ? { projectId } : {}),
    });

    patchMeta(brandsRoot, id, { status: 'ready' });
    onEvent({
      event: 'brand',
      id,
      brand,
      designSystemId,
      files: systemBuild.files,
      ...(projectReady ? { projectId } : {}),
    });
    onEvent({ event: 'phase', phase: 'done' });
  } catch (err) {
    const message = errorMessage(err);
    if (created) patchMeta(brandsRoot, id, { status: 'failed', error: message });
    onEvent({ event: 'error', message });
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function brandProjectId(brandId: string): string {
  return `brand-${brandId}`;
}

type BrandProjectArgs = {
  brandsRoot: string;
  projectsRoot: string;
  db: Parameters<typeof insertProject>[0];
  brandId: string;
  projectId: string;
  brand: Brand;
  url: string;
  systemFiles: string[];
  designSystemId?: string;
  randomId?: () => string;
};

async function createOrUpdateBrandProject(args: BrandProjectArgs): Promise<void> {
  const {
    brandsRoot,
    projectsRoot,
    db,
    brandId,
    projectId,
    brand,
    url,
    systemFiles,
    designSystemId,
    randomId = randomUUID,
  } = args;
  const now = Date.now();
  const metadata: ProjectMetadata = {
    kind: 'brand',
    importedFrom: 'brand-extraction',
    entryFile: 'system/index.html',
    sourceFileName: brand.name,
    nameSource: 'generated',
    skipDiscoveryBrief: true,
    brandId,
    brandSourceUrl: url,
    ...(designSystemId ? { brandDesignSystemId: designSystemId } : {}),
  };
  const name = `${brand.name || 'Brand'} Brand Kit`;
  const promptInput: {
    brand: Brand;
    brandId: string;
    url: string;
    designSystemId?: string;
    systemFiles: string[];
  } = {
    brand,
    brandId,
    url,
    systemFiles,
  };
  if (designSystemId) promptInput.designSystemId = designSystemId;
  const pendingPrompt = brandProjectPrompt(promptInput);
  const existing = getProject(db, projectId);
  if (existing) {
    updateProject(db, projectId, {
      name,
      skillId: existing.skillId ?? null,
      designSystemId: designSystemId ?? existing.designSystemId ?? null,
      pendingPrompt,
      metadata: {
        ...(existing.metadata ?? {}),
        ...metadata,
      },
      customInstructions: existing.customInstructions ?? null,
      updatedAt: now,
    });
  } else {
    insertProject(db, {
      id: projectId,
      name,
      skillId: null,
      designSystemId: designSystemId ?? null,
      pendingPrompt,
      metadata,
      customInstructions: null,
      createdAt: now,
      updatedAt: now,
    });
    insertConversation(db, {
      id: randomId(),
      projectId,
      title: null,
      sessionMode: 'design',
      createdAt: now,
      updatedAt: now,
    });
  }

  await syncBrandFilesToProject({
    brandsRoot,
    projectsRoot,
    brandId,
    projectId,
    brand,
    metadata,
  });
}

function brandProjectPrompt(input: {
  brand: Brand;
  brandId: string;
  url: string;
  designSystemId?: string;
  systemFiles: string[];
}): string {
  const files = input.systemFiles.length > 0
    ? input.systemFiles.map((file) => `- system/${file}`).join('\n')
    : '- system/index.html\n- system/artifacts/landing.html\n- system/artifacts/deck.html\n- system/artifacts/poster.html\n- system/artifacts/email.html\n- system/artifacts/newsletter.html\n- system/artifacts/form.html';
  return [
    `This is a brand extraction task for ${input.brand.name}.`,
    `Source URL: ${input.url}`,
    `Brand id: ${input.brandId}`,
    input.designSystemId ? `Design system id: ${input.designSystemId}` : null,
    '',
    'The daemon has already completed the deterministic branding-agent extraction and wrote the brand kit into this project.',
    'Use these files as the source of truth:',
    '- brand.json',
    '- DESIGN.md',
    '- system/BRAND-SYSTEM.md',
    '- fonts/ and logos/',
    files,
    '',
    'First response: show this as a brand extraction task, summarize the extracted logo, palette, typography, voice, and layout, and call out the six generated brand assets: landing, deck, poster, email, newsletter, and form.',
    'Do not restart extraction or overwrite files unless a required file is missing or the user asks for an iteration.',
  ].filter((line): line is string => line !== null).join('\n');
}

async function syncBrandFilesToProject(input: {
  brandsRoot: string;
  projectsRoot: string;
  brandId: string;
  projectId: string;
  brand: Brand;
  metadata: ProjectMetadata;
}): Promise<void> {
  const brandRoot = resolveBrandFile(input.brandsRoot, input.brandId, []);
  if (!brandRoot) throw new Error(`invalid brand id: ${input.brandId}`);
  const write = async (name: string, body: string | Buffer) => {
    await writeProjectFile(input.projectsRoot, input.projectId, name, body, { overwrite: true }, input.metadata);
  };
  await write('brand.json', JSON.stringify(input.brand, null, 2));
  await write('DESIGN.md', brandToDesignMd(input.brand));
  await writeOptionalFileToProject(input.projectsRoot, input.projectId, input.metadata, brandRoot, 'guide.md');
  await copyDirectoryToProject(input.projectsRoot, input.projectId, input.metadata, brandSystemDir(input.brandsRoot, input.brandId), 'system');
  await copyOptionalDirectoryToProject(input.projectsRoot, input.projectId, input.metadata, path.join(brandRoot, 'logos'), 'logos');
  await copyOptionalDirectoryToProject(input.projectsRoot, input.projectId, input.metadata, path.join(brandRoot, 'fonts'), 'fonts');
  await copyOptionalDirectoryToProject(input.projectsRoot, input.projectId, input.metadata, path.join(brandRoot, 'prefetch'), 'prefetch');
}

async function writeOptionalFileToProject(
  projectsRoot: string,
  projectId: string,
  metadata: ProjectMetadata,
  root: string,
  rel: string,
): Promise<void> {
  const abs = path.join(root, rel);
  if (!isFile(abs)) return;
  await writeProjectFile(projectsRoot, projectId, rel, fs.readFileSync(abs), { overwrite: true }, metadata);
}

async function copyOptionalDirectoryToProject(
  projectsRoot: string,
  projectId: string,
  metadata: ProjectMetadata,
  sourceDir: string,
  targetPrefix: string,
): Promise<void> {
  if (!isDirectory(sourceDir)) return;
  await copyDirectoryToProject(projectsRoot, projectId, metadata, sourceDir, targetPrefix);
}

async function copyDirectoryToProject(
  projectsRoot: string,
  projectId: string,
  metadata: ProjectMetadata,
  sourceDir: string,
  targetPrefix: string,
): Promise<void> {
  for (const file of collectFiles(sourceDir)) {
    const projectPath = toPosixPath(path.join(targetPrefix, file.rel));
    await writeProjectFile(projectsRoot, projectId, projectPath, fs.readFileSync(file.abs), { overwrite: true }, metadata);
  }
}

function syncBrandSystemToUserDesignSystem(
  userDesignSystemsRoot: string,
  designSystemId: string,
  brandsRoot: string,
  brandId: string,
  designMd: string,
): void {
  const dir = userDesignSystemDir(userDesignSystemsRoot, designSystemId);
  if (!dir) throw new Error(`invalid design system id: ${designSystemId}`);
  const brandRoot = resolveBrandFile(brandsRoot, brandId, []);
  if (!brandRoot) throw new Error(`invalid brand id: ${brandId}`);

  fs.writeFileSync(path.join(dir, 'DESIGN.md'), designMd, 'utf8');
  copyDirectorySync(brandSystemDir(brandsRoot, brandId), path.join(dir, 'system'));
  copyOptionalDirectorySync(path.join(brandRoot, 'logos'), path.join(dir, 'logos'));
  copyOptionalDirectorySync(path.join(brandRoot, 'fonts'), path.join(dir, 'fonts'));
  copyOptionalDirectorySync(path.join(brandRoot, 'prefetch'), path.join(dir, 'prefetch'));
  const brandJson = resolveBrandFile(brandsRoot, brandId, ['brand.json']);
  if (brandJson && isFile(brandJson)) {
    fs.copyFileSync(brandJson, path.join(dir, 'brand.json'));
  }
}

function userDesignSystemDir(root: string, id: string): string | null {
  if (!id.startsWith('user:')) return null;
  const dirId = id.slice('user:'.length);
  if (!/^[a-z0-9][a-z0-9-]*$/u.test(dirId)) return null;
  const base = path.resolve(root);
  const target = path.resolve(base, dirId);
  if (target !== base && target.startsWith(`${base}${path.sep}`)) return target;
  return null;
}

function copyOptionalDirectorySync(sourceDir: string, targetDir: string): void {
  if (!isDirectory(sourceDir)) return;
  copyDirectorySync(sourceDir, targetDir);
}

function copyDirectorySync(sourceDir: string, targetDir: string): void {
  fs.rmSync(targetDir, { recursive: true, force: true });
  fs.mkdirSync(targetDir, { recursive: true });
  for (const file of collectFiles(sourceDir)) {
    const target = path.join(targetDir, file.rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(file.abs, target);
  }
}

function collectFiles(root: string): Array<{ abs: string; rel: string }> {
  const out: Array<{ abs: string; rel: string }> = [];
  const walk = (dir: string, prefix: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      const rel = prefix ? path.join(prefix, entry.name) : entry.name;
      if (entry.isDirectory()) {
        walk(abs, rel);
      } else if (entry.isFile()) {
        out.push({ abs, rel: toPosixPath(rel) });
      }
    }
  };
  walk(root, '');
  return out.sort((a, b) => a.rel.localeCompare(b.rel));
}

function toPosixPath(value: string): string {
  return value.split(path.sep).join('/');
}

/** List every stored brand as a summary (meta + provisional brand). */
export function listBrandSummaries(brandsRoot: string): BrandSummary[] {
  const out: BrandSummary[] = [];
  for (const id of listBrandIds(brandsRoot)) {
    const meta = readMeta(brandsRoot, id);
    if (!meta) continue;
    out.push({ meta, brand: readBrand(brandsRoot, id) });
  }
  return out;
}

/** Full detail for one brand, or null when it is missing. */
export function readBrandDetail(brandsRoot: string, id: string): BrandDetailResponse | null {
  const meta = readMeta(brandsRoot, id);
  if (!meta) return null;
  return {
    meta,
    brand: readBrand(brandsRoot, id),
    guide: readBrandGuide(brandsRoot, id),
  };
}

/**
 * Remove a brand and its registered user design system. Returns false when the
 * brand dir did not exist.
 */
export async function removeBrand(
  brandsRoot: string,
  userDesignSystemsRoot: string,
  id: string,
): Promise<boolean> {
  const meta = readMeta(brandsRoot, id);
  if (meta?.designSystemId) {
    try {
      await deleteUserDesignSystem(userDesignSystemsRoot, meta.designSystemId);
    } catch {
      // Best-effort — still remove the brand dir below.
    }
  }
  return deleteBrandDir(brandsRoot, id);
}

const LOGO_EXT_PRIORITY = ['.svg', '.png', '.webp', '.jpg', '.jpeg', '.gif', '.ico'];

/**
 * Absolute path to the brand's primary logo file, or null when none exists.
 * Prefers brand.logo.primary, then the first logo in `logos/` by extension
 * priority (vector/raster before icon).
 */
export function resolveBrandLogoPath(brandsRoot: string, id: string): string | null {
  const brand = readBrand(brandsRoot, id);
  const primary = brand?.logo?.primary;
  if (primary) {
    const rel = primary.replace(/^\.?\/+/, '').split('/').filter(Boolean);
    const abs = resolveBrandFile(brandsRoot, id, rel);
    if (abs && isFile(abs)) return abs;
  }

  const logosDir = resolveBrandFile(brandsRoot, id, ['logos']);
  if (!logosDir) return null;
  let names: string[];
  try {
    names = fs.readdirSync(logosDir);
  } catch {
    return null;
  }
  const ranked = names
    .filter((n) => isFile(path.join(logosDir, n)))
    .sort((a, b) => extRank(a) - extRank(b) || a.localeCompare(b));
  const pick = ranked[0];
  return pick ? path.join(logosDir, pick) : null;
}

function extRank(name: string): number {
  const i = LOGO_EXT_PRIORITY.indexOf(path.extname(name).toLowerCase());
  return i === -1 ? LOGO_EXT_PRIORITY.length : i;
}

function isFile(p: string): boolean {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

function isDirectory(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}
