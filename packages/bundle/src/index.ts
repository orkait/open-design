import { createHash, randomBytes } from "node:crypto";
import {
  cp,
  lstat,
  mkdir,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";

export const BUNDLE_BASE_PATH_ENV = "OD_BUNDLE_BASE_PATH";
export const BUNDLE_DESCRIPTOR_FILE = "bundle.json";
export const BUNDLE_DESCRIPTOR_SCHEMA_VERSION = 1;
export const BUNDLE_METADATA_FILE = "metadata.json";
export const BUNDLE_OBJECTS_DIR = "objects";
export const BUNDLE_STAGING_DIR = ".staging";
export const BUNDLE_STORE_VERSION = 1;

export type BundleRef = {
  key: string;
  version: string;
};

export type BundleEntryKind = "js" | "tsx";

export type BundleArtifactDescriptor = {
  entry: {
    kind: BundleEntryKind;
    path: string;
  };
  schemaVersion: typeof BUNDLE_DESCRIPTOR_SCHEMA_VERSION;
};

export type BundleArtifact = {
  bundlePath: string;
  descriptor: BundleArtifactDescriptor;
  descriptorPath: string;
  entryPath: string;
};

export type BundleEntry = {
  createdAt: string;
  digest: {
    algorithm: "sha256";
    value: string;
  };
  path: string;
  ref: BundleRef;
};

export type BundleStoreMetadata = {
  bundles: BundleEntry[];
  version: typeof BUNDLE_STORE_VERSION;
};

export type BundleStorePaths = {
  basePath: string;
  metadataPath: string;
};

export type BundleResolved = {
  basePath: string;
  entry: BundleEntry;
  metadataPath: string;
  path: string;
  ref: BundleRef;
};

export type BundleBasePathInput = {
  env?: NodeJS.ProcessEnv;
  envName?: string;
  explicitBasePath?: string | null;
  namespaceDataPath: string;
};

export type BundleWriteInput = {
  basePath: string;
  now?: () => Date;
  ref: BundleRef;
  sourcePath: string;
};

export class BundleStoreError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "BundleStoreError";
    this.code = code;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function containsPath(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === "" || (rel.length > 0 && !rel.startsWith("..") && !isAbsolute(rel));
}

function assertNoNullBytes(value: string, label: string): void {
  if (value.includes("\0")) throw new BundleStoreError("bundle-path-invalid", `${label} must not contain null bytes`);
}

function resolveAbsolutePath(value: string, label: string): string {
  assertNoNullBytes(value, label);
  if (!isAbsolute(value)) throw new BundleStoreError("bundle-path-not-absolute", `${label} must be absolute`);
  return resolve(value);
}

export function validateBundleKey(key: string): string {
  if (!/^[a-z][a-z0-9-]*(?::[a-z][a-z0-9-]*)+$/.test(key)) {
    throw new BundleStoreError(
      "bundle-key-invalid",
      `bundle key must use a colon-separated lowercase namespace pattern: ${key}`,
    );
  }
  return key;
}

export function validateBundleVersion(version: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._+-]*$/.test(version)) {
    throw new BundleStoreError(
      "bundle-version-invalid",
      `bundle version must be a safe path segment: ${version}`,
    );
  }
  return version;
}

export function validateBundleRef(ref: BundleRef): BundleRef {
  if (!isRecord(ref)) {
    throw new BundleStoreError("bundle-ref-invalid", "bundle ref must be an object");
  }
  return {
    key: validateBundleKey(ref.key),
    version: validateBundleVersion(ref.version),
  };
}

export function validateBundleDescriptor(value: unknown): BundleArtifactDescriptor {
  if (!isRecord(value) || value.schemaVersion !== BUNDLE_DESCRIPTOR_SCHEMA_VERSION) {
    throw new BundleStoreError("bundle-descriptor-invalid", "bundle descriptor must contain schemaVersion=1");
  }

  const entry = value.entry;
  if (!isRecord(entry)) {
    throw new BundleStoreError("bundle-descriptor-invalid", "bundle descriptor entry must be an object");
  }

  if (entry.kind !== "js" && entry.kind !== "tsx") {
    throw new BundleStoreError("bundle-entry-kind-invalid", "bundle descriptor entry kind must be js or tsx");
  }

  if (typeof entry.path !== "string" || entry.path.length === 0) {
    throw new BundleStoreError("bundle-entry-path-invalid", "bundle descriptor entry path must be a non-empty string");
  }
  assertNoNullBytes(entry.path, "bundle descriptor entry path");
  if (isAbsolute(entry.path)) {
    throw new BundleStoreError("bundle-entry-path-invalid", "bundle descriptor entry path must be relative");
  }

  return {
    entry: {
      kind: entry.kind,
      path: entry.path.split("\\").join("/"),
    },
    schemaVersion: BUNDLE_DESCRIPTOR_SCHEMA_VERSION,
  };
}

export function bundleRefsEqual(left: BundleRef, right: BundleRef): boolean {
  return left.key === right.key && left.version === right.version;
}

export function resolveBundleBasePath(input: BundleBasePathInput): string {
  const env = input.env ?? process.env;
  const envName = input.envName ?? BUNDLE_BASE_PATH_ENV;
  const configured = input.explicitBasePath ?? env[envName] ?? join(input.namespaceDataPath, "bundles");
  return resolveAbsolutePath(configured, "bundle base path");
}

export function bundleStorePaths(basePath: string): BundleStorePaths {
  const resolvedBasePath = resolveAbsolutePath(basePath, "bundle base path");
  return {
    basePath: resolvedBasePath,
    metadataPath: join(resolvedBasePath, BUNDLE_METADATA_FILE),
  };
}

export function resolveBundleEntryPath(input: {
  bundlePath: string;
  descriptor: BundleArtifactDescriptor;
}): string {
  const bundlePath = resolveAbsolutePath(input.bundlePath, "bundle path");
  const descriptor = validateBundleDescriptor(input.descriptor);
  const entryPath = resolve(bundlePath, descriptor.entry.path);
  if (!containsPath(bundlePath, entryPath)) {
    throw new BundleStoreError("bundle-entry-path-escaped", "bundle descriptor entry path escaped the bundle path");
  }
  return entryPath;
}

export async function readBundleDescriptor(bundlePath: string): Promise<BundleArtifactDescriptor> {
  const resolvedBundlePath = resolveAbsolutePath(bundlePath, "bundle path");
  try {
    return validateBundleDescriptor(JSON.parse(await readFile(join(resolvedBundlePath, BUNDLE_DESCRIPTOR_FILE), "utf8")));
  } catch (error) {
    if (error instanceof BundleStoreError) throw error;
    throw new BundleStoreError("bundle-descriptor-read-failed", error instanceof Error ? error.message : String(error));
  }
}

export async function resolveBundleArtifact(bundlePath: string): Promise<BundleArtifact> {
  const resolvedBundlePath = resolveAbsolutePath(bundlePath, "bundle path");
  const bundleInfo = await lstat(resolvedBundlePath);
  if (!bundleInfo.isDirectory()) throw new BundleStoreError("bundle-path-not-directory", "bundle path must resolve to a directory");
  if (bundleInfo.isSymbolicLink()) throw new BundleStoreError("bundle-path-symlink", "bundle path must not be a symlink");

  const descriptor = await readBundleDescriptor(resolvedBundlePath);
  const entryPath = resolveBundleEntryPath({ bundlePath: resolvedBundlePath, descriptor });
  let entryInfo;
  try {
    entryInfo = await lstat(entryPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new BundleStoreError("bundle-entry-not-found", "bundle descriptor entry path does not exist");
    }
    throw error;
  }
  if (!entryInfo.isFile()) throw new BundleStoreError("bundle-entry-not-file", "bundle descriptor entry path must resolve to a file");
  if (entryInfo.isSymbolicLink()) throw new BundleStoreError("bundle-entry-symlink", "bundle descriptor entry path must not be a symlink");

  return {
    bundlePath: resolvedBundlePath,
    descriptor,
    descriptorPath: join(resolvedBundlePath, BUNDLE_DESCRIPTOR_FILE),
    entryPath,
  };
}

function objectId(ref: BundleRef): string {
  return createHash("sha256").update(`${ref.key}\0${ref.version}`).digest("hex").slice(0, 24);
}

function operationId(): string {
  return `${Date.now()}-${process.pid}-${randomBytes(6).toString("hex")}`;
}

function objectContentPath(basePath: string, ref: BundleRef, operation = operationId()): string {
  return join(basePath, BUNDLE_OBJECTS_DIR, objectId(ref), operation, "content");
}

function relativeStorePath(basePath: string, candidate: string): string {
  const rel = relative(basePath, candidate);
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) {
    throw new BundleStoreError("bundle-path-escaped", "bundle object path escaped the bundle base path");
  }
  return rel.split("\\").join("/");
}

async function writeJsonAtomic(path: string, payload: unknown): Promise<void> {
  await mkdir(resolve(path, ".."), { recursive: true });
  const tmp = `${path}.${operationId()}.tmp`;
  await writeFile(tmp, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  await rename(tmp, path);
}

function parseMetadata(value: unknown): BundleStoreMetadata {
  if (!isRecord(value) || value.version !== BUNDLE_STORE_VERSION || !Array.isArray(value.bundles)) {
    throw new BundleStoreError("bundle-metadata-invalid", "bundle metadata has an unsupported shape");
  }

  const bundles = value.bundles.map((entry): BundleEntry => {
    if (!isRecord(entry)) throw new BundleStoreError("bundle-metadata-invalid", "bundle entry must be an object");
    const refValue = entry.ref;
    const digestValue = entry.digest;
    if (!isRecord(refValue)) throw new BundleStoreError("bundle-metadata-invalid", "bundle entry ref must be an object");
    if (!isRecord(digestValue)) throw new BundleStoreError("bundle-metadata-invalid", "bundle entry digest must be an object");
    if (digestValue.algorithm !== "sha256" || typeof digestValue.value !== "string" || digestValue.value.length === 0) {
      throw new BundleStoreError("bundle-metadata-invalid", "bundle entry digest must be sha256");
    }
    if (typeof entry.path !== "string" || entry.path.length === 0) {
      throw new BundleStoreError("bundle-metadata-invalid", "bundle entry path must be a string");
    }
    if (typeof entry.createdAt !== "string" || entry.createdAt.length === 0) {
      throw new BundleStoreError("bundle-metadata-invalid", "bundle entry createdAt must be a string");
    }
    return {
      createdAt: entry.createdAt,
      digest: {
        algorithm: "sha256",
        value: digestValue.value,
      },
      path: entry.path,
      ref: validateBundleRef(refValue as BundleRef),
    };
  });

  return { bundles, version: BUNDLE_STORE_VERSION };
}

export async function readBundleStore(basePath: string): Promise<BundleStoreMetadata> {
  const paths = bundleStorePaths(basePath);
  try {
    return parseMetadata(JSON.parse(await readFile(paths.metadataPath, "utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { bundles: [], version: BUNDLE_STORE_VERSION };
    }
    if (error instanceof BundleStoreError) throw error;
    throw new BundleStoreError("bundle-metadata-read-failed", error instanceof Error ? error.message : String(error));
  }
}

async function writeBundleStore(basePath: string, metadata: BundleStoreMetadata): Promise<void> {
  const paths = bundleStorePaths(basePath);
  await writeJsonAtomic(paths.metadataPath, metadata);
}

async function assertDirectoryWithoutSymlinks(root: string): Promise<void> {
  const info = await lstat(root);
  if (!info.isDirectory()) throw new BundleStoreError("bundle-source-not-directory", "bundle source path must be a directory");
  if (info.isSymbolicLink()) throw new BundleStoreError("bundle-source-symlink", "bundle source path must not be a symlink");

  async function walk(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const path = join(directory, entry.name);
      const child = await lstat(path);
      if (child.isSymbolicLink()) {
        throw new BundleStoreError("bundle-source-symlink", "bundle source tree must not contain symlinks");
      }
      if (entry.isDirectory()) await walk(path);
    }
  }

  await walk(root);
}

async function digestDirectory(root: string): Promise<string> {
  const hash = createHash("sha256");

  async function walk(directory: string): Promise<void> {
    const entries = (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const path = join(directory, entry.name);
      const rel = relative(root, path).split("\\").join("/");
      const info = await lstat(path);
      hash.update(entry.isDirectory() ? "dir\0" : "file\0");
      hash.update(rel);
      hash.update("\0");
      if (entry.isDirectory()) {
        await walk(path);
      } else if (entry.isFile()) {
        hash.update(await readFile(path));
      } else {
        throw new BundleStoreError("bundle-source-invalid-entry", `unsupported bundle source entry: ${rel}`);
      }
      hash.update("\0");
      hash.update(String(info.mode));
      hash.update("\0");
    }
  }

  await walk(root);
  return hash.digest("hex");
}

function entryPath(basePath: string, entry: BundleEntry): string {
  const abs = resolve(basePath, entry.path);
  if (!containsPath(basePath, abs)) {
    throw new BundleStoreError("bundle-path-escaped", "bundle entry path escaped the bundle base path");
  }
  return abs;
}

export async function listBundles(basePath: string): Promise<BundleEntry[]> {
  return (await readBundleStore(basePath)).bundles;
}

export async function resolveBundle(input: { basePath: string; ref: BundleRef }): Promise<BundleResolved> {
  const ref = validateBundleRef(input.ref);
  const paths = bundleStorePaths(input.basePath);
  const metadata = await readBundleStore(paths.basePath);
  const entry = metadata.bundles.find((candidate) => bundleRefsEqual(candidate.ref, ref));
  if (entry == null) {
    throw new BundleStoreError("bundle-not-found", `bundle not found for ${ref.key} ${ref.version}`);
  }
  const path = entryPath(paths.basePath, entry);
  const resolvedRealBase = await realpath(paths.basePath);
  const resolvedRealPath = await realpath(path);
  if (!containsPath(resolvedRealBase, resolvedRealPath)) {
    throw new BundleStoreError("bundle-path-escaped", "bundle resolved outside the bundle base path");
  }
  const info = await stat(path);
  if (!info.isDirectory()) throw new BundleStoreError("bundle-path-not-directory", "bundle path must resolve to a directory");
  return {
    basePath: paths.basePath,
    entry,
    metadataPath: paths.metadataPath,
    path,
    ref,
  };
}

export async function addBundle(input: BundleWriteInput): Promise<BundleResolved> {
  const ref = validateBundleRef(input.ref);
  const paths = bundleStorePaths(input.basePath);
  const sourcePath = resolveAbsolutePath(input.sourcePath, "bundle source path");
  await assertDirectoryWithoutSymlinks(sourcePath);
  const metadata = await readBundleStore(paths.basePath);
  if (metadata.bundles.some((entry) => bundleRefsEqual(entry.ref, ref))) {
    throw new BundleStoreError("bundle-already-exists", `bundle already exists for ${ref.key} ${ref.version}`);
  }

  await mkdir(paths.basePath, { recursive: true });
  const stagingPath = join(paths.basePath, BUNDLE_STAGING_DIR, operationId());
  const finalPath = objectContentPath(paths.basePath, ref);
  await mkdir(resolve(stagingPath, ".."), { recursive: true });
  await cp(sourcePath, stagingPath, { recursive: true });
  await mkdir(resolve(finalPath, ".."), { recursive: true });
  await rename(stagingPath, finalPath);

  const entry: BundleEntry = {
    createdAt: (input.now ?? (() => new Date()))().toISOString(),
    digest: {
      algorithm: "sha256",
      value: await digestDirectory(finalPath),
    },
    path: relativeStorePath(paths.basePath, finalPath),
    ref,
  };
  await writeBundleStore(paths.basePath, {
    bundles: [...metadata.bundles, entry].sort((a, b) => `${a.ref.key}\0${a.ref.version}`.localeCompare(`${b.ref.key}\0${b.ref.version}`)),
    version: BUNDLE_STORE_VERSION,
  });
  return await resolveBundle({ basePath: paths.basePath, ref });
}

export async function replaceBundle(input: BundleWriteInput): Promise<BundleResolved> {
  const ref = validateBundleRef(input.ref);
  const paths = bundleStorePaths(input.basePath);
  const sourcePath = resolveAbsolutePath(input.sourcePath, "bundle source path");
  await assertDirectoryWithoutSymlinks(sourcePath);
  const metadata = await readBundleStore(paths.basePath);
  const existing = metadata.bundles.find((entry) => bundleRefsEqual(entry.ref, ref));
  const existingPath = existing == null ? null : entryPath(paths.basePath, existing);

  await mkdir(paths.basePath, { recursive: true });
  const stagingPath = join(paths.basePath, BUNDLE_STAGING_DIR, operationId());
  const finalPath = objectContentPath(paths.basePath, ref);
  await mkdir(resolve(stagingPath, ".."), { recursive: true });
  await cp(sourcePath, stagingPath, { recursive: true });
  await mkdir(resolve(finalPath, ".."), { recursive: true });
  await rename(stagingPath, finalPath);

  const nextEntry: BundleEntry = {
    createdAt: (input.now ?? (() => new Date()))().toISOString(),
    digest: {
      algorithm: "sha256",
      value: await digestDirectory(finalPath),
    },
    path: relativeStorePath(paths.basePath, finalPath),
    ref,
  };
  await writeBundleStore(paths.basePath, {
    bundles: [
      ...metadata.bundles.filter((entry) => !bundleRefsEqual(entry.ref, ref)),
      nextEntry,
    ].sort((a, b) => `${a.ref.key}\0${a.ref.version}`.localeCompare(`${b.ref.key}\0${b.ref.version}`)),
    version: BUNDLE_STORE_VERSION,
  });
  if (existingPath != null) {
    await rm(existingPath, { force: true, recursive: true }).catch(() => undefined);
  }
  return await resolveBundle({ basePath: paths.basePath, ref });
}

export async function deleteBundle(input: { basePath: string; ref: BundleRef }): Promise<boolean> {
  const ref = validateBundleRef(input.ref);
  const paths = bundleStorePaths(input.basePath);
  const metadata = await readBundleStore(paths.basePath);
  const existing = metadata.bundles.find((entry) => bundleRefsEqual(entry.ref, ref));
  if (existing == null) return false;
  const existingPath = entryPath(paths.basePath, existing);
  await writeBundleStore(paths.basePath, {
    bundles: metadata.bundles.filter((entry) => !bundleRefsEqual(entry.ref, ref)),
    version: BUNDLE_STORE_VERSION,
  });
  await rm(existingPath, { force: true, recursive: true }).catch(() => undefined);
  return true;
}

export async function deleteBundleKey(input: { basePath: string; key: string }): Promise<number> {
  const key = validateBundleKey(input.key);
  const paths = bundleStorePaths(input.basePath);
  const metadata = await readBundleStore(paths.basePath);
  const removed = metadata.bundles.filter((entry) => entry.ref.key === key);
  if (removed.length === 0) return 0;
  const removedPaths = removed.map((entry) => entryPath(paths.basePath, entry));
  await writeBundleStore(paths.basePath, {
    bundles: metadata.bundles.filter((entry) => entry.ref.key !== key),
    version: BUNDLE_STORE_VERSION,
  });
  await Promise.all(removedPaths.map((path) => rm(path, { force: true, recursive: true }).catch(() => undefined)));
  return removed.length;
}
