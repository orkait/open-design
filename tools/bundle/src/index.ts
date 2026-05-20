import { cp, lstat, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { cac } from "cac";
import {
  BUNDLE_DESCRIPTOR_FILE,
  BUNDLE_DESCRIPTOR_SCHEMA_VERSION,
  addBundle,
  deleteBundle,
  listBundles,
  replaceBundle,
  resolveBundle,
  resolveBundleArtifact,
  validateBundleRef,
  type BundleArtifact,
  type BundleArtifactDescriptor,
  type BundleEntry,
  type BundleRef,
  type BundleResolved,
} from "@open-design/bundle";

const WEB_APP = "web";
const WEB_BUNDLE_KEY = "od:sidecar:web";
const WEB_DEFAULT_ENTRY = "sidecar/index.ts";
const WEB_JS_ENTRY_CANDIDATES = ["sidecar/index.mjs", "sidecar/index.js"];

type BundleApp = typeof WEB_APP;

type JsonOption = {
  json?: boolean;
};

type BasePathOption = JsonOption & {
  bundleBasePath?: string;
};

type KeyOption = {
  key?: string;
};

type PackOptions = JsonOption & {
  out?: string;
  replace?: boolean;
};

type AddOptions = BasePathOption & KeyOption & {
  replace?: boolean;
  version?: string;
};

type RefOptions = BasePathOption & KeyOption;

export type PackBundleInput = {
  app: string;
  outPath: string;
  replace?: boolean;
  sourcePath: string;
};

export type StoreBundleInput = {
  basePath: string;
  bundlePath: string;
  key?: string;
  replace?: boolean;
  version: string;
};

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function output(payload: unknown, options: JsonOption, heading: string): void {
  if (options.json === true) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return;
  }

  process.stdout.write(`${heading}\n`);
  if (isBundleArtifact(payload)) {
    process.stdout.write(`bundle: ${payload.bundlePath}\n`);
    process.stdout.write(`descriptor: ${payload.descriptorPath}\n`);
    process.stdout.write(`entry: ${payload.descriptor.entry.kind} ${payload.entryPath}\n`);
    return;
  }
  if (isBundleResolved(payload)) {
    process.stdout.write(`bundle: ${payload.ref.key}@${payload.ref.version}\n`);
    process.stdout.write(`path: ${payload.path}\n`);
    process.stdout.write(`metadata: ${payload.metadataPath}\n`);
    return;
  }
  if (Array.isArray(payload)) {
    if (payload.length === 0) {
      process.stdout.write("(no bundles)\n");
      return;
    }
    for (const entry of payload) {
      const bundle = entry as BundleEntry;
      process.stdout.write(`- ${bundle.ref.key}@${bundle.ref.version} · ${bundle.path}\n`);
    }
    return;
  }
  if (typeof payload === "boolean") {
    process.stdout.write(`deleted: ${payload ? "yes" : "no"}\n`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function isBundleArtifact(value: unknown): value is BundleArtifact {
  return isRecord(value) && typeof value.bundlePath === "string" && typeof value.entryPath === "string";
}

function isBundleResolved(value: unknown): value is BundleResolved {
  return isRecord(value) && isRecord(value.ref) && typeof value.path === "string" && typeof value.metadataPath === "string";
}

function containsPath(root: string, candidate: string): boolean {
  const rel = path.relative(root, candidate);
  return rel === "" || (rel.length > 0 && !rel.startsWith("..") && !path.isAbsolute(rel));
}

function requireSupportedApp(app: string): BundleApp {
  if (app === WEB_APP) return app;
  throw new Error(`unsupported bundle app: ${app} (expected: web)`);
}

function requireOption(value: string | undefined, name: string): string {
  if (value == null || value.length === 0) throw new Error(`${name} is required`);
  return value;
}

function resolveBasePath(options: BasePathOption): string {
  return path.resolve(requireOption(options.bundleBasePath, "--bundle-base-path"));
}

function normalizeRef(input: { key?: string; refOrVersion: string }): BundleRef {
  const at = input.refOrVersion.lastIndexOf("@");
  const key = at > 0 && input.refOrVersion.slice(0, at).includes(":")
    ? input.refOrVersion.slice(0, at)
    : input.key ?? WEB_BUNDLE_KEY;
  const version = key === input.refOrVersion.slice(0, at) ? input.refOrVersion.slice(at + 1) : input.refOrVersion;
  return validateBundleRef({ key, version });
}

async function assertDirectoryWithoutSymlinks(root: string): Promise<void> {
  const info = await lstat(root);
  if (!info.isDirectory()) throw new Error(`bundle source path must be a directory: ${root}`);
  if (info.isSymbolicLink()) throw new Error(`bundle source path must not be a symlink: ${root}`);

  async function walk(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = path.join(directory, entry.name);
      const child = await lstat(entryPath);
      if (child.isSymbolicLink()) throw new Error(`bundle source tree must not contain symlinks: ${entryPath}`);
      if (entry.isDirectory()) await walk(entryPath);
    }
  }

  await walk(root);
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await lstat(filePath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function detectWebDescriptor(sourcePath: string): Promise<BundleArtifactDescriptor> {
  if (await pathExists(path.join(sourcePath, WEB_DEFAULT_ENTRY))) {
    return {
      entry: { kind: "tsx", path: WEB_DEFAULT_ENTRY },
      schemaVersion: BUNDLE_DESCRIPTOR_SCHEMA_VERSION,
    };
  }

  for (const candidate of WEB_JS_ENTRY_CANDIDATES) {
    if (await pathExists(path.join(sourcePath, candidate))) {
      return {
        entry: { kind: "js", path: candidate },
        schemaVersion: BUNDLE_DESCRIPTOR_SCHEMA_VERSION,
      };
    }
  }

  throw new Error(`web bundle source must contain ${WEB_DEFAULT_ENTRY} or one of: ${WEB_JS_ENTRY_CANDIDATES.join(", ")}`);
}

async function descriptorForApp(app: BundleApp, sourcePath: string): Promise<BundleArtifactDescriptor> {
  if (app === WEB_APP) return await detectWebDescriptor(sourcePath);
}

export async function validateBundlePath(bundlePath: string): Promise<BundleArtifact> {
  return await resolveBundleArtifact(path.resolve(bundlePath));
}

export async function packBundle(input: PackBundleInput): Promise<BundleArtifact> {
  const app = requireSupportedApp(input.app);
  const sourcePath = path.resolve(input.sourcePath);
  const outPath = path.resolve(input.outPath);
  if (containsPath(sourcePath, outPath) || containsPath(outPath, sourcePath)) {
    throw new Error("bundle output path must not overlap the source path");
  }

  await assertDirectoryWithoutSymlinks(sourcePath);
  if (await pathExists(outPath)) {
    if (input.replace !== true) throw new Error(`bundle output already exists: ${outPath}`);
    await rm(outPath, { force: true, recursive: true });
  }

  await mkdir(path.dirname(outPath), { recursive: true });
  await cp(sourcePath, outPath, { recursive: true });
  const descriptor = await descriptorForApp(app, sourcePath);
  await writeFile(path.join(outPath, BUNDLE_DESCRIPTOR_FILE), `${JSON.stringify(descriptor, null, 2)}\n`, "utf8");
  return await validateBundlePath(outPath);
}

export async function addBundleToStore(input: StoreBundleInput): Promise<BundleResolved> {
  await validateBundlePath(input.bundlePath);
  const ref = validateBundleRef({ key: input.key ?? WEB_BUNDLE_KEY, version: input.version });
  const write = input.replace === true ? replaceBundle : addBundle;
  return await write({
    basePath: path.resolve(input.basePath),
    ref,
    sourcePath: path.resolve(input.bundlePath),
  });
}

export async function listBundleStore(basePath: string): Promise<BundleEntry[]> {
  return await listBundles(path.resolve(basePath));
}

export async function resolveBundleFromStore(input: {
  basePath: string;
  key?: string;
  refOrVersion: string;
}): Promise<BundleResolved & { artifact: BundleArtifact }> {
  const resolved = await resolveBundle({
    basePath: path.resolve(input.basePath),
    ref: normalizeRef({ key: input.key, refOrVersion: input.refOrVersion }),
  });
  return {
    ...resolved,
    artifact: await validateBundlePath(resolved.path),
  };
}

export async function deleteBundleFromStore(input: {
  basePath: string;
  key?: string;
  refOrVersion: string;
}): Promise<boolean> {
  return await deleteBundle({
    basePath: path.resolve(input.basePath),
    ref: normalizeRef({ key: input.key, refOrVersion: input.refOrVersion }),
  });
}

export function createCli(): ReturnType<typeof cac> {
  const cli = cac("tools-bundle");

  cli.command("validate <bundlePath>", "Validate a direct bundle root containing bundle.json")
    .option("--json", "print JSON")
    .action(async (bundlePath: string, options: JsonOption) => {
      output(await validateBundlePath(bundlePath), options, "tools-bundle validate");
    });

  cli.command("pack <app> <sourcePath>", "Create a local direct bundle from an app source tree")
    .option("--out <path>", "bundle output path")
    .option("--replace", "replace an existing output path")
    .option("--json", "print JSON")
    .action(async (app: string, sourcePath: string, options: PackOptions) => {
      output(await packBundle({
        app,
        outPath: requireOption(options.out, "--out"),
        replace: options.replace,
        sourcePath,
      }), options, "tools-bundle pack");
    });

  cli.command("add <bundlePath>", "Add a direct bundle to a packages/bundle store")
    .option("--bundle-base-path <path>", "bundle store base path")
    .option("--version <version>", "bundle version")
    .option("--key <key>", `bundle key (default: ${WEB_BUNDLE_KEY})`)
    .option("--replace", "replace an existing bundle with the same key/version")
    .option("--json", "print JSON")
    .action(async (bundlePath: string, options: AddOptions) => {
      output(await addBundleToStore({
        basePath: resolveBasePath(options),
        bundlePath,
        key: options.key,
        replace: options.replace,
        version: requireOption(options.version, "--version"),
      }), options, "tools-bundle add");
    });

  cli.command("list", "List bundles in a packages/bundle store")
    .option("--bundle-base-path <path>", "bundle store base path")
    .option("--json", "print JSON")
    .action(async (options: BasePathOption) => {
      output(await listBundleStore(resolveBasePath(options)), options, "tools-bundle list");
    });

  cli.command("resolve <ref>", "Resolve and validate a bundle from a packages/bundle store")
    .option("--bundle-base-path <path>", "bundle store base path")
    .option("--key <key>", `bundle key used when <ref> is a version only (default: ${WEB_BUNDLE_KEY})`)
    .option("--json", "print JSON")
    .action(async (ref: string, options: RefOptions) => {
      output(await resolveBundleFromStore({
        basePath: resolveBasePath(options),
        key: options.key,
        refOrVersion: ref,
      }), options, "tools-bundle resolve");
    });

  cli.command("delete <ref>", "Delete a bundle from a packages/bundle store")
    .option("--bundle-base-path <path>", "bundle store base path")
    .option("--key <key>", `bundle key used when <ref> is a version only (default: ${WEB_BUNDLE_KEY})`)
    .option("--json", "print JSON")
    .action(async (ref: string, options: RefOptions) => {
      output(await deleteBundleFromStore({
        basePath: resolveBasePath(options),
        key: options.key,
        refOrVersion: ref,
      }), options, "tools-bundle delete");
    });

  cli.help();
  return cli;
}

export async function main(): Promise<void> {
  createCli().parse();
}

if (process.argv[1] != null && pathToFileURL(process.argv[1]).href === import.meta.url) {
  void main().catch((error) => {
    process.stderr.write(`${formatError(error)}\n`);
    process.exit(1);
  });
}
