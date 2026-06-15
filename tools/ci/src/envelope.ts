import path, { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const WORKSPACE_ROOT = resolve(__dirname, "../../..");

export type ToolCiProfile = "ci-base" | "ci-playwright" | "nix-capable" | "github" | "owned" | "local";
export type ToolCiSourceMode = "direct" | "copy";

export type ToolCiRoots = {
  artifactsRoot: string;
  cacheRoot: string;
  evidenceRoot: string;
  logsRoot: string;
  resultsRoot: string;
  runRoot: string;
  tmpRoot: string;
  toolCiRoot: string;
  workRoot: string;
};

export type ToolCiConfig = {
  capabilitiesPath: string;
  eventName: string;
  headSha: string;
  manifestPath: string;
  mode: string;
  profile: ToolCiProfile;
  providerId: string;
  roots: ToolCiRoots;
  runAttempt: string;
  runId: string;
  sourceMode: ToolCiSourceMode;
  workspaceRoot: string;
};

export type NormalizedEnvelope = {
  artifactsDir: string;
  cacheDir: string;
  capabilitiesPath: string;
  eventName: string;
  headSha: string;
  manifestPath: string;
  mode: string;
  providerId: string;
  repoDir: string;
  resultsDir: string;
  runAttempt: string;
  runId: string;
  tmpDir: string;
  workDir: string;
};

export type ToolCiConfigOptions = {
  capabilitiesPath?: string;
  eventName?: string;
  evidenceRoot?: string;
  headSha?: string;
  manifestPath?: string;
  mode?: string;
  profile?: ToolCiProfile;
  providerId?: string;
  runAttempt?: string;
  runId?: string;
  sourceMode?: ToolCiSourceMode;
  toolCiRoot?: string;
  workspaceRoot?: string;
};

const envKeys = {
  artifactsDir: "OD_CI_ARTIFACTS_DIR",
  cacheDir: "OD_CI_CACHE_DIR",
  capabilitiesPath: "OD_CI_CAPABILITIES",
  manifestPath: "OD_CI_ATOM_MANIFEST",
  providerId: "OD_CI_PROVIDER_ID",
  repoDir: "OD_CI_REPO_DIR",
  resultsDir: "OD_CI_RESULTS_DIR",
  runAttempt: "OD_CI_RUN_ATTEMPT",
  runId: "OD_CI_RUN_ID",
  tmpDir: "OD_CI_TMP_DIR",
  workDir: "OD_CI_WORK_DIR",
} as const;

function nonEmpty(value: string | undefined): string | undefined {
  return value == null || value.length === 0 ? undefined : value;
}

function resolveToolCiProfile(value: string | undefined): ToolCiProfile {
  if (
    value === "ci-base" ||
    value === "ci-playwright" ||
    value === "nix-capable" ||
    value === "github" ||
    value === "owned" ||
    value === "local"
  ) {
    return value;
  }
  if (value == null || value.length === 0) return "local";
  throw new Error(`unsupported tools-ci profile: ${value}`);
}

function resolveToolCiSourceMode(value: string | undefined): ToolCiSourceMode {
  if (value === "direct" || value === "copy") {
    return value;
  }
  if (value == null || value.length === 0) return "direct";
  throw new Error(`unsupported tools-ci source mode: ${value}`);
}

export function resolveToolCiRoots(options: {
  evidenceRoot?: string;
  profile?: ToolCiProfile;
  runId: string;
  toolCiRoot?: string;
  workspaceRoot?: string;
}): ToolCiRoots {
  const workspaceRoot = resolve(options.workspaceRoot ?? WORKSPACE_ROOT);
  const profile = options.profile ?? "local";
  const evidenceRoot = resolve(options.evidenceRoot ?? path.join(workspaceRoot, ".tmp", "workflows", "ci-gate"));
  const toolCiRoot = resolve(options.toolCiRoot ?? path.join(workspaceRoot, ".tmp", "tools-ci"));
  const runRoot = path.join(evidenceRoot, "runs", options.runId);
  return {
    artifactsRoot: path.join(runRoot, "artifacts"),
    cacheRoot: path.join(toolCiRoot, "cache", profile),
    evidenceRoot,
    logsRoot: path.join(runRoot, "logs"),
    resultsRoot: runRoot,
    runRoot,
    tmpRoot: path.join(toolCiRoot, "tmp", options.runId),
    toolCiRoot,
    workRoot: path.join(toolCiRoot, "work", options.runId),
  };
}

export function resolveToolCiConfig(
  options: ToolCiConfigOptions = {},
  env: NodeJS.ProcessEnv = process.env,
): ToolCiConfig {
  const workspaceRoot = resolve(options.workspaceRoot ?? nonEmpty(env.OD_CI_WORKSPACE_ROOT) ?? WORKSPACE_ROOT);
  const runId = options.runId ?? nonEmpty(env.OD_CI_RUN_ID) ?? nonEmpty(env.GITHUB_RUN_ID) ?? "local";
  const runAttempt = options.runAttempt ?? nonEmpty(env.OD_CI_RUN_ATTEMPT) ?? nonEmpty(env.GITHUB_RUN_ATTEMPT) ?? "1";
  const profile = options.profile ?? resolveToolCiProfile(nonEmpty(env.OD_CI_PROFILE));
  const sourceMode = options.sourceMode ?? resolveToolCiSourceMode(nonEmpty(env.OD_CI_SOURCE_MODE));
  const providerId = options.providerId ?? nonEmpty(env.OD_CI_PROVIDER_ID) ?? "local";
  const mode = options.mode ?? nonEmpty(env.OD_CI_MODE) ?? "default";
  const roots = resolveToolCiRoots({
    evidenceRoot: options.evidenceRoot ?? nonEmpty(env.OD_CI_EVIDENCE_ROOT),
    profile,
    runId,
    toolCiRoot: options.toolCiRoot ?? nonEmpty(env.OD_CI_TOOL_ROOT),
    workspaceRoot,
  });

  return {
    capabilitiesPath: resolve(options.capabilitiesPath ?? nonEmpty(env.OD_CI_CAPABILITIES) ?? path.join(workspaceRoot, "tools", "ci", "fixtures", "capabilities.github.json")),
    eventName: options.eventName ?? nonEmpty(env.OD_CI_EVENT_NAME) ?? nonEmpty(env.GITHUB_EVENT_NAME) ?? "unknown",
    headSha: options.headSha ?? nonEmpty(env.OD_CI_HEAD_SHA) ?? nonEmpty(env.CI_GATE_HEAD_SHA) ?? nonEmpty(env.GITHUB_SHA) ?? "unknown",
    manifestPath: resolve(options.manifestPath ?? nonEmpty(env.OD_CI_ATOM_MANIFEST) ?? path.join(workspaceRoot, "tools", "ci", "atoms.json")),
    mode,
    profile,
    providerId,
    roots,
    runAttempt,
    runId,
    sourceMode,
    workspaceRoot,
  };
}

export function readNormalizedEnvelope(env: NodeJS.ProcessEnv = process.env): NormalizedEnvelope {
  const config = resolveToolCiConfig({}, env);
  const result: Partial<NormalizedEnvelope> = {};
  for (const [field, key] of Object.entries(envKeys)) {
    const value = env[key] ?? (() => {
      switch (field) {
        case "artifactsDir":
          return config.roots.artifactsRoot;
        case "cacheDir":
          return config.roots.cacheRoot;
        case "capabilitiesPath":
          return config.capabilitiesPath;
        case "manifestPath":
          return config.manifestPath;
        case "providerId":
          return config.providerId;
        case "repoDir":
          return config.workspaceRoot;
        case "resultsDir":
          return config.roots.resultsRoot;
        case "runAttempt":
          return config.runAttempt;
        case "runId":
          return config.runId;
        case "tmpDir":
          return config.roots.tmpRoot;
        case "workDir":
          return config.sourceMode === "copy" ? config.roots.workRoot : config.workspaceRoot;
        default:
          return undefined;
      }
    })();
    result[field as keyof NormalizedEnvelope] = value;
  }
  result.eventName = config.eventName;
  result.headSha = config.headSha;
  result.mode = config.mode;
  return result as NormalizedEnvelope;
}
