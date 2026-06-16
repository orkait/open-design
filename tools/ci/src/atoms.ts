import { access, readFile } from "node:fs/promises";
import { dirname, sep, resolve } from "node:path";

export const atomDomains = ["workspace", "packages", "apps", "e2e", "nix"] as const;
export const atomCapabilities = ["node", "pnpm", "nix", "playwright", "chromium"] as const;
export const atomSetupProfiles = ["none", "pnpm-workspace", "nix-flake", "browser-e2e"] as const;
export const atomCacheProfiles = ["none", "node-pnpm", "nix", "browser"] as const;
export const atomArtifactProfiles = ["standard", "browser", "nix"] as const;

export type AtomDomain = (typeof atomDomains)[number];
export type AtomCapability = (typeof atomCapabilities)[number];
export type AtomSetupProfile = (typeof atomSetupProfiles)[number];
export type AtomCacheProfile = (typeof atomCacheProfiles)[number];
export type AtomArtifactProfile = (typeof atomArtifactProfiles)[number];

export type AtomDefinition = {
  artifactProfile: AtomArtifactProfile;
  cacheProfile: AtomCacheProfile;
  call: string;
  domain: AtomDomain;
  key: string;
  name: string;
  requires: AtomCapability[];
  resultRequired: boolean;
  script: string;
  setup: AtomSetupProfile;
  timeoutSeconds: number;
};

export type AtomManifest = {
  atoms: AtomDefinition[];
  schemaVersion: 1;
};

export type AtomManifestValidationOptions = {
  manifestPath?: string;
  requireScriptFiles?: boolean;
  repoRoot?: string;
};

export type AtomManifestValidationResult = {
  atomCount: number;
  atomNames: string[];
  manifest: AtomManifest;
};

const atomNamePattern = /^[a-z][a-z0-9-]*$/;
const atomKeyPattern = /^[a-z][a-z0-9-]*$/;
const relativeScriptPattern = /^[A-Za-z0-9._/-]+\.sh$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatPath(path: string, field: string | number): string {
  return `${path}.${String(field)}`;
}

function assertString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${path} must be a non-empty string`);
  }
  return value;
}

function assertBoolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`${path} must be a boolean`);
  }
  return value;
}

function assertPositiveInteger(value: unknown, path: string): number {
  if (!Number.isInteger(value) || typeof value !== "number" || value <= 0) {
    throw new Error(`${path} must be a positive integer`);
  }
  return value;
}

function assertEnum<T extends readonly string[]>(value: unknown, allowed: T, path: string): T[number] {
  if (typeof value !== "string" || !allowed.includes(value)) {
    throw new Error(`${path} must be one of: ${allowed.join(", ")}`);
  }
  return value;
}

function optionalString(value: unknown, path: string): string | undefined {
  if (value == null) return undefined;
  return assertString(value, path);
}

function assertStringEnumArray<T extends readonly string[]>(value: unknown, allowed: T, path: string): T[number][] {
  if (!Array.isArray(value)) {
    throw new Error(`${path} must be an array`);
  }
  const items = value.map((item, index) => assertEnum(item, allowed, formatPath(path, index)));
  return [...new Set(items)];
}

export function atomNameFromIdentity(domain: AtomDomain, key: string): string {
  if (domain === "nix" && key === "flake") return "nix";
  if (domain === "packages" && key === "unit") return "unit";
  if (domain === "e2e" && key === "browser") return "browser";
  return key;
}

export function deriveAtomIdentity(name: string): { domain: AtomDomain; key: string; call: string } {
  switch (name) {
    case "guard":
      return { domain: "workspace", key: "guard", call: "pnpm guard" };
    case "i18n":
      return { domain: "workspace", key: "i18n", call: "pnpm i18n:check" };
    case "typecheck":
      return { domain: "workspace", key: "typecheck", call: "workspace type declarations and typecheck" };
    case "build":
      return { domain: "workspace", key: "build", call: "workspace build closure" };
    case "unit":
      return { domain: "packages", key: "unit", call: "workspace package and tool unit tests" };
    case "daemon":
      return { domain: "apps", key: "daemon", call: "daemon build and tests" };
    case "web":
      return { domain: "apps", key: "web", call: "web sidecar build and tests" };
    case "browser":
      return { domain: "e2e", key: "browser", call: "browser e2e and critical Playwright" };
    case "nix":
      return { domain: "nix", key: "flake", call: "nix flake archive + check --no-build + build checks" };
    default:
      return { domain: "workspace", key: name, call: name };
  }
}

function parseAtomDefinition(value: unknown, path: string): AtomDefinition {
  if (!isRecord(value)) {
    throw new Error(`${path} must be an object`);
  }

  const explicitName = optionalString(value.name, formatPath(path, "name"));
  const parsedDomain = value.domain == null
    ? undefined
    : assertEnum(value.domain, atomDomains, formatPath(path, "domain"));
  const parsedKey = optionalString(value.key, formatPath(path, "key"));
  if (explicitName == null && (parsedDomain == null || parsedKey == null)) {
    throw new Error(`${path} must define either name or domain/key`);
  }

  const legacyIdentity = explicitName == null ? undefined : deriveAtomIdentity(explicitName);
  const domain = parsedDomain ?? legacyIdentity?.domain;
  const key = parsedKey ?? legacyIdentity?.key;
  if (domain == null || key == null) {
    throw new Error(`${path} must define domain and key`);
  }
  if (!atomKeyPattern.test(key)) {
    throw new Error(`${formatPath(path, "key")} must match ${atomKeyPattern}`);
  }
  const name = explicitName ?? atomNameFromIdentity(domain, key);
  if (!atomNamePattern.test(name)) {
    throw new Error(`${formatPath(path, "name")} must match ${atomNamePattern}`);
  }
  if (parsedDomain != null && parsedKey != null && explicitName != null && atomNameFromIdentity(parsedDomain, parsedKey) !== explicitName) {
    throw new Error(`${path}.name must match domain/key identity`);
  }

  const script = assertString(value.script, formatPath(path, "script"));
  if (script.startsWith("/") || script.includes("..") || !relativeScriptPattern.test(script)) {
    throw new Error(`${formatPath(path, "script")} must be a repo-relative shell script path`);
  }

  return {
    artifactProfile: assertEnum(value.artifactProfile, atomArtifactProfiles, formatPath(path, "artifactProfile")),
    call: optionalString(value.call, formatPath(path, "call")) ?? legacyIdentity?.call ?? name,
    cacheProfile: assertEnum(value.cacheProfile, atomCacheProfiles, formatPath(path, "cacheProfile")),
    domain,
    key,
    name,
    requires: assertStringEnumArray(value.requires, atomCapabilities, formatPath(path, "requires")),
    resultRequired: assertBoolean(value.resultRequired, formatPath(path, "resultRequired")),
    script,
    setup: assertEnum(value.setup, atomSetupProfiles, formatPath(path, "setup")),
    timeoutSeconds: assertPositiveInteger(value.timeoutSeconds, formatPath(path, "timeoutSeconds")),
  };
}

export function parseAtomManifest(value: unknown): AtomManifest {
  if (!isRecord(value)) {
    throw new Error("atom manifest must be an object");
  }
  if (value.schemaVersion !== 1) {
    throw new Error("schemaVersion must be 1");
  }
  if (!Array.isArray(value.atoms) || value.atoms.length === 0) {
    throw new Error("atoms must be a non-empty array");
  }

  const atoms = value.atoms.map((atom, index) => parseAtomDefinition(atom, `atoms.${index}`));
  const seen = new Set<string>();
  const seenIdentity = new Set<string>();
  for (const atom of atoms) {
    if (seen.has(atom.name)) {
      throw new Error(`duplicate atom name: ${atom.name}`);
    }
    seen.add(atom.name);
    const identity = `${atom.domain}/${atom.key}`;
    if (seenIdentity.has(identity)) {
      throw new Error(`duplicate atom identity: ${identity}`);
    }
    seenIdentity.add(identity);
  }

  return {
    atoms,
    schemaVersion: 1,
  };
}

async function assertScriptFiles(manifest: AtomManifest, repoRoot: string): Promise<void> {
  for (const atom of manifest.atoms) {
    const scriptPath = resolve(repoRoot, atom.script);
    await access(scriptPath).catch(() => {
      throw new Error(`atom script not found for ${atom.name}: ${scriptPath}`);
    });
  }
}

export async function loadAtomManifest(manifestPath: string): Promise<AtomManifest> {
  return parseAtomManifest(JSON.parse(await readFile(manifestPath, "utf8")));
}

export async function validateAtomManifest(
  manifestPath: string,
  options: AtomManifestValidationOptions = {},
): Promise<AtomManifestValidationResult> {
  const resolvedManifestPath = resolve(manifestPath);
  const manifest = await loadAtomManifest(resolvedManifestPath);
  if (options.requireScriptFiles !== false) {
    const repoRoot = options.repoRoot == null
      ? resolveDefaultRepoRoot(resolvedManifestPath)
      : resolve(options.repoRoot);
    await assertScriptFiles(manifest, repoRoot);
  }

  return {
    atomCount: manifest.atoms.length,
    atomNames: manifest.atoms.map((atom) => atom.name),
    manifest,
  };
}

function resolveDefaultRepoRoot(manifestPath: string): string {
  const manifestDir = dirname(manifestPath);
  if (manifestPath.endsWith(`${sep}.github${sep}workflows${sep}scripts${sep}ci${sep}atoms.json`)) {
    return resolve(manifestDir, "../../../..");
  }
  if (manifestPath.endsWith(`${sep}tools${sep}ci${sep}atoms.json`)) {
    return resolve(manifestDir, "../..");
  }
  return resolve(manifestDir, "../../../..");
}
