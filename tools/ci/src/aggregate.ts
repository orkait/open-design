import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { type AtomManifest, loadAtomManifest } from "./atoms.js";

export type WorkflowActionKind = "real" | "placeholder";
export type WorkflowActionStatus = "success" | "failure" | "not-run";

export type WorkflowActionResult = {
  action: string;
  kind: WorkflowActionKind;
  status: WorkflowActionStatus;
  steps?: unknown[];
  [key: string]: unknown;
};

export type WorkflowResult = {
  actions: WorkflowActionResult[];
  eventName: string;
  headSha: string;
  mode: string;
  provider: string;
  runAttempt: string;
  runId: string;
  schemaVersion: 1;
};

export type AggregatedActionResult = {
  action: string;
  passed: boolean;
  reason: string;
};

export type AggregateResult = {
  actions: AggregatedActionResult[];
  passed: boolean;
  owned: {
    provider: string;
    runId: string;
  };
  github: {
    provider: string;
    runId: string;
  };
  schemaVersion: 1;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseWorkflowAction(value: unknown): WorkflowActionResult {
  if (!isRecord(value)) {
    throw new Error("workflow action must be an object");
  }
  const action = String(value.action ?? "");
  const kind = String(value.kind ?? "");
  const status = String(value.status ?? "");
  if (action.length === 0) {
    throw new Error("workflow action name is required");
  }
  if (kind !== "real" && kind !== "placeholder") {
    throw new Error(`unsupported workflow action kind: ${kind}`);
  }
  if (status !== "success" && status !== "failure" && status !== "not-run") {
    throw new Error(`unsupported workflow action status: ${status}`);
  }
  return {
    ...value,
    action,
    kind,
    status,
    steps: Array.isArray(value.steps) ? value.steps : undefined,
  };
}

export function parseWorkflowResult(value: unknown): WorkflowResult {
  if (!isRecord(value)) {
    throw new Error("workflow result must be an object");
  }
  if (value.schemaVersion !== 1) {
    throw new Error(`unsupported workflow result schemaVersion: ${String(value.schemaVersion)}`);
  }
  if (!Array.isArray(value.actions)) {
    throw new Error("workflow result actions must be an array");
  }
  return {
    actions: value.actions.map(parseWorkflowAction),
    eventName: String(value.eventName ?? ""),
    headSha: String(value.headSha ?? ""),
    mode: String(value.mode ?? ""),
    provider: String(value.provider ?? ""),
    runAttempt: String(value.runAttempt ?? ""),
    runId: String(value.runId ?? ""),
    schemaVersion: 1,
  };
}

function resultByAction(result: WorkflowResult): Map<string, WorkflowActionResult> {
  const map = new Map<string, WorkflowActionResult>();
  for (const action of result.actions) {
    if (map.has(action.action)) {
      throw new Error(`${result.provider} result has duplicate action: ${action.action}`);
    }
    map.set(action.action, action);
  }
  return map;
}

function summarizeAction(action: string, owned: WorkflowResult, github: WorkflowResult): AggregatedActionResult {
  const candidates = [owned, github]
    .flatMap((result) => result.actions
      .filter((entry) => entry.action === action)
      .map((entry) => ({ ...entry, provider: result.provider })));
  const realCandidates = candidates.filter((entry) => entry.kind === "real");
  const successes = realCandidates.filter((entry) => entry.status === "success");
  if (successes.length > 0) {
    return {
      action,
      passed: true,
      reason: `success via ${successes.map((entry) => entry.provider).join(", ")}`,
    };
  }
  if (realCandidates.length > 0) {
    return {
      action,
      passed: false,
      reason: `real results but no success (${realCandidates.map((entry) => `${entry.provider}:${entry.status}`).join(", ")})`,
    };
  }
  return {
    action,
    passed: false,
    reason: "no real result available",
  };
}

export function aggregateWorkflowResults(owned: WorkflowResult, github: WorkflowResult): AggregateResult {
  const ownedActions = resultByAction(owned);
  const githubActions = resultByAction(github);
  const actions = [...new Set([...ownedActions.keys(), ...githubActions.keys()])].sort();
  const actionResults = actions.map((action) => summarizeAction(action, owned, github));
  return {
    actions: actionResults,
    github: {
      provider: github.provider,
      runId: github.runId,
    },
    passed: actionResults.every((action) => action.passed),
    owned: {
      provider: owned.provider,
      runId: owned.runId,
    },
    schemaVersion: 1,
  };
}

export async function aggregateWorkflowResultFiles(options: {
  githubResultsPath: string;
  outPath?: string;
  ownedResultsPath: string;
}): Promise<AggregateResult> {
  const owned = parseWorkflowResult(JSON.parse(await readFile(resolve(options.ownedResultsPath), "utf8")));
  const github = parseWorkflowResult(JSON.parse(await readFile(resolve(options.githubResultsPath), "utf8")));
  const result = aggregateWorkflowResults(owned, github);
  if (options.outPath != null) {
    await writeFile(resolve(options.outPath), `${JSON.stringify(result, null, 2)}\n`, "utf8");
  }
  return result;
}

async function findCiResultFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const paths: string[] = [];
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isFile() && entry.name === "ci-results.json") {
      paths.push(path);
    } else if (entry.isDirectory()) {
      paths.push(...await findCiResultFiles(path));
    }
  }
  return paths.sort();
}

export function mergeWorkflowShardResults(options: {
  eventName: string;
  headSha: string;
  manifest: AtomManifest;
  mode: string;
  provider: string;
  runAttempt: string;
  runId: string;
  shards: WorkflowResult[];
}): WorkflowResult {
  const actionsByName = new Map<string, WorkflowActionResult>();
  for (const shard of options.shards) {
    if (shard.provider !== options.provider) {
      throw new Error(`shard provider ${shard.provider} does not match ${options.provider}`);
    }
    if (shard.mode !== options.mode) {
      throw new Error(`shard mode ${shard.mode} does not match ${options.mode}`);
    }
    if (shard.headSha !== options.headSha) {
      throw new Error(`shard headSha ${shard.headSha} does not match ${options.headSha}`);
    }
    for (const action of shard.actions) {
      if (actionsByName.has(action.action)) {
        throw new Error(`duplicate shard action: ${action.action}`);
      }
      actionsByName.set(action.action, action);
    }
  }

  const actions = options.manifest.atoms.map((atom) => {
    const action = actionsByName.get(atom.name);
    if (action == null) {
      throw new Error(`missing shard action: ${atom.name}`);
    }
    return action;
  });

  return {
    actions,
    eventName: options.eventName,
    headSha: options.headSha,
    mode: options.mode,
    provider: options.provider,
    runAttempt: options.runAttempt,
    runId: options.runId,
    schemaVersion: 1,
  };
}

export async function mergeWorkflowShardResultFiles(options: {
  eventName: string;
  headSha: string;
  manifestPath: string;
  mode: string;
  outPath?: string;
  provider: string;
  runAttempt: string;
  runId: string;
  shardsRoot: string;
}): Promise<WorkflowResult> {
  const manifest = await loadAtomManifest(resolve(options.manifestPath));
  const resultPaths = await findCiResultFiles(resolve(options.shardsRoot));
  if (resultPaths.length === 0) {
    throw new Error(`no ci-results.json files found under ${options.shardsRoot}`);
  }
  const shards = await Promise.all(
    resultPaths.map(async (path) => parseWorkflowResult(JSON.parse(await readFile(path, "utf8")))),
  );
  const result = mergeWorkflowShardResults({
    eventName: options.eventName,
    headSha: options.headSha,
    manifest,
    mode: options.mode,
    provider: options.provider,
    runAttempt: options.runAttempt,
    runId: options.runId,
    shards,
  });
  if (options.outPath != null) {
    await writeFile(resolve(options.outPath), `${JSON.stringify(result, null, 2)}\n`, "utf8");
  }
  return result;
}
