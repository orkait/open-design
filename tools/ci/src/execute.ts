import { chmod, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createWriteStream, readFileSync } from "node:fs";
import { dirname, isAbsolute, parse, relative, resolve } from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";

import { type AtomDefinition, type AtomManifest, loadAtomManifest } from "./atoms.js";
import { type AtomSelection } from "./capabilities.js";
import { type NormalizedEnvelope, readNormalizedEnvelope } from "./envelope.js";

export type AtomExecutionStatus = "success" | "failure" | "not-run";

export type AtomExecutionResult = {
  action: string;
  artifactDir?: string;
  domain?: string;
  exitCode?: number;
  kind: "real" | "placeholder";
  key?: string;
  metadataPath?: string;
  missingCapabilities?: string[];
  reason?: string;
  status: AtomExecutionStatus;
  steps?: unknown[];
  stderr?: string;
  stdout?: string;
};

export type CiExecutionResult = {
  actions: AtomExecutionResult[];
  eventName: string;
  headSha: string;
  mode: string;
  provider: string;
  runAttempt: string;
  runId: string;
  schemaVersion: 1;
};

export type ExecuteAtomsOptions = {
  envelope?: NormalizedEnvelope;
  manifest: AtomManifest;
  selection: AtomSelection;
};

type AtomIdentity = {
  action: string;
  domain: string;
  key: string;
};

type WorkspaceSetupResult = {
  exitCode: number;
  metadataPath: string;
  reason?: string;
  status: "success" | "failure";
  timedOut?: boolean;
};

function parseJsonLines(path: string): unknown[] {
  try {
    const text = readFileSyncUtf8(path);
    return text
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as unknown);
  } catch {
    return [];
  }
}

function readFileSyncUtf8(path: string): string {
  return readFileSync(path, "utf8");
}

function atomByName(manifest: AtomManifest): Map<string, AtomDefinition> {
  return new Map(manifest.atoms.map((atom) => [atom.name, atom]));
}

function executionEnv(envelope: NormalizedEnvelope, extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    ...process.env,
    CI: process.env.CI ?? "true",
    COREPACK_ENABLE_DOWNLOAD_PROMPT: "0",
    COREPACK_HOME: resolve(envelope.cacheDir, "corepack"),
    ELECTRON_SKIP_BINARY_DOWNLOAD: process.env.ELECTRON_SKIP_BINARY_DOWNLOAD ?? "1",
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: process.env.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD ?? "1",
    npm_config_store_dir: resolve(envelope.cacheDir, "pnpm-store"),
    npm_config_fetch_retries: "6",
    npm_config_fetch_retry_maxtimeout: "120000",
    npm_config_fetch_retry_mintimeout: "20000",
    npm_config_network_timeout: "180000",
    OD_CI_CACHE_DIR: envelope.cacheDir,
    OD_CI_TMP_DIR: envelope.tmpDir,
    ...(process.env.OD_CI_USE_COREPACK_PNPM_SHIM === "1"
      ? { PATH: `${resolve(envelope.tmpDir, "bin")}:${process.env.PATH ?? ""}` }
      : {}),
    ...extra,
  };
}

async function ensureExecutionRoots(envelope: NormalizedEnvelope): Promise<void> {
  await mkdir(envelope.resultsDir, { recursive: true });
  await mkdir(envelope.artifactsDir, { recursive: true });
  await mkdir(envelope.cacheDir, { recursive: true });
  await mkdir(resolve(envelope.cacheDir, "corepack"), { recursive: true });
  await mkdir(resolve(envelope.cacheDir, "pnpm-store"), { recursive: true });
  await mkdir(envelope.tmpDir, { recursive: true });
  if (process.env.OD_CI_USE_COREPACK_PNPM_SHIM === "1") {
    const shimPath = resolve(envelope.tmpDir, "bin", "pnpm");
    await mkdir(dirname(shimPath), { recursive: true });
    await writeFile(
      shimPath,
      ["#!/usr/bin/env bash", "set -Eeuo pipefail", "exec corepack pnpm \"$@\"", ""].join("\n"),
      "utf8",
    );
    await chmod(shimPath, 0o755);
  }
}

function isSamePath(left: string, right: string): boolean {
  return resolve(left) === resolve(right);
}

function containsPath(parent: string, child: string): boolean {
  const relativePath = relative(resolve(parent), resolve(child));
  return relativePath.length === 0 || (!relativePath.startsWith("..") && !relativePath.startsWith("/"));
}

function shouldCopySourceEntry(options: {
  copyNodeModules: boolean;
  sourcePath: string;
  sourceRoot: string;
  workDir: string;
}): boolean {
  const { copyNodeModules, sourcePath, sourceRoot, workDir } = options;
  const relativeSourcePath = relative(sourceRoot, sourcePath).split("\\").join("/");
  if (relativeSourcePath.length === 0) return true;
  if (relativeSourcePath === ".git" || relativeSourcePath.startsWith(".git/")) return false;
  if (relativeSourcePath === ".tmp" || relativeSourcePath.startsWith(".tmp/")) return false;
  if (!copyNodeModules && (relativeSourcePath === "node_modules" || relativeSourcePath.startsWith("node_modules/"))) {
    return false;
  }
  return !containsPath(sourcePath, workDir);
}

async function prepareWritableWorkDir(envelope: NormalizedEnvelope): Promise<void> {
  if (isSamePath(envelope.repoDir, envelope.workDir)) return;

  const workDir = resolve(envelope.workDir);
  if (workDir === parse(workDir).root) {
    throw new Error(`refusing to prepare unsafe tools-ci work directory: ${workDir}`);
  }
  if (containsPath(workDir, envelope.repoDir)) {
    throw new Error(`refusing to prepare tools-ci work directory that contains repo source: ${workDir}`);
  }

  const sourceRoot = resolve(envelope.repoDir);
  const copyNodeModules = process.env.OD_CI_COPY_NODE_MODULES === "1";
  await rm(workDir, { force: true, recursive: true });
  await mkdir(dirname(workDir), { recursive: true });
  await cp(sourceRoot, workDir, {
    force: true,
    recursive: true,
    verbatimSymlinks: true,
    filter: (sourcePath) => shouldCopySourceEntry({ copyNodeModules, sourcePath, sourceRoot, workDir }),
  });
}

function atomIdentity(atom: AtomDefinition): AtomIdentity {
  return { action: atom.name, domain: atom.domain, key: atom.key };
}

async function runProcess(options: {
  args: string[];
  command: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  timeoutSeconds?: number;
}): Promise<{ exitCode: number; stderr: string; stdout: string; timedOut: boolean }> {
  const child = spawn(options.command, options.args, {
    cwd: options.cwd,
    env: options.env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });

  let timedOut = false;
  const timeout = options.timeoutSeconds == null
    ? undefined
    : setTimeout(() => {
        timedOut = true;
        child.kill("SIGTERM");
      }, options.timeoutSeconds * 1000);
  const exitCode = await new Promise<number>((resolvePromise) => {
    child.on("error", (error) => {
      stderr += `${error instanceof Error ? error.message : String(error)}\n`;
      resolvePromise(1);
    });
    child.on("close", (code) => resolvePromise(code ?? 1));
  });
  if (timeout != null) clearTimeout(timeout);
  return { exitCode, stderr, stdout, timedOut };
}

function needsWorkspaceSetup(atom: AtomDefinition): boolean {
  return atom.setup === "pnpm-workspace" || atom.setup === "browser-e2e";
}

function workspaceSetupTimeoutSeconds(): number {
  const value = process.env.OD_CI_SETUP_TIMEOUT_SECONDS;
  if (value == null || value.length === 0) return 1800;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`OD_CI_SETUP_TIMEOUT_SECONDS must be a positive integer: ${value}`);
  }
  return parsed;
}

async function runWorkspaceSetup(
  envelope: NormalizedEnvelope,
  atoms: AtomDefinition[],
): Promise<WorkspaceSetupResult | null> {
  if (!atoms.some(needsWorkspaceSetup)) return null;

  const logDir = resolve(envelope.resultsDir, "logs", "setup", "workspace");
  const stdoutPath = resolve(logDir, "stdout.log");
  const stderrPath = resolve(logDir, "stderr.log");
  const stepsPath = resolve(logDir, "steps.jsonl");
  const metadataPath = resolve(logDir, "metadata.json");
  await mkdir(logDir, { recursive: true });
  await writeFile(stepsPath, "", "utf8");

  const startedAt = Date.now();
  const env = executionEnv(envelope);
  let exitCode = 0;
  let stdout = "";
  let stderr = "";
  let reason: string | undefined;
  let timedOut = false;
  const timeoutSeconds = workspaceSetupTimeoutSeconds();

  try {
    const packageJson = JSON.parse(await readFile(resolve(envelope.workDir, "package.json"), "utf8")) as {
      packageManager?: unknown;
    };
    if (typeof packageJson.packageManager !== "string" || packageJson.packageManager.length === 0) {
      throw new Error("package.json must define packageManager for tools-ci workspace setup");
    }

    const prepare = await runProcess({
      args: ["prepare", packageJson.packageManager, "--activate"],
      command: "corepack",
      cwd: envelope.workDir,
      env,
      timeoutSeconds,
    });
    exitCode = prepare.exitCode;
    stdout = prepare.stdout;
    stderr = prepare.stderr;
    timedOut = prepare.timedOut;

    if (exitCode === 0 && !timedOut) {
      const install = await runProcess({
        args: ["install", "--frozen-lockfile", "--prefer-offline", "--network-concurrency=8"],
        command: "pnpm",
        cwd: envelope.workDir,
        env,
        timeoutSeconds,
      });
      exitCode = install.exitCode;
      stdout += install.stdout;
      stderr += install.stderr;
      timedOut = install.timedOut;
    }
    if (timedOut) {
      reason = `workspace setup command timed out after ${timeoutSeconds}s`;
      stderr += `${reason}\n`;
    }
  } catch (error) {
    exitCode = 1;
    reason = error instanceof Error ? error.message : String(error);
    stderr += `${reason}\n`;
  }

  const finishedAt = Date.now();
  await writeFile(stdoutPath, stdout, "utf8");
  await writeFile(stderrPath, stderr, "utf8");
  await writeAtomMetadata({
    call: "corepack prepare + pnpm install",
    envelope,
    exitCode,
    finishedAt,
    identity: { action: "setup", domain: "setup", key: "workspace" },
    metadataPath,
    startedAt,
    status: exitCode === 0 ? "success" : "failure",
    timedOut,
  });

  return {
    exitCode,
    metadataPath: relativeResultPath(envelope, metadataPath),
    reason: reason ?? (exitCode === 0 ? undefined : `tools-ci workspace setup failed; see ${relativeResultPath(envelope, metadataPath)}`),
    status: exitCode === 0 ? "success" : "failure",
    timedOut,
  };
}

function atomLogDir(envelope: NormalizedEnvelope, identity: AtomIdentity): string {
  return resolve(envelope.resultsDir, "logs", identity.domain, identity.key);
}

function atomArtifactDir(envelope: NormalizedEnvelope, identity: AtomIdentity): string {
  return resolve(envelope.artifactsDir, identity.domain, identity.key);
}

function relativeResultPath(envelope: NormalizedEnvelope, path: string): string {
  return relative(envelope.resultsDir, path).split("\\").join("/");
}

async function writeAtomMetadata(options: {
  call: string;
  envelope: NormalizedEnvelope;
  exitCode: number;
  finishedAt: number;
  identity: AtomIdentity;
  metadataPath: string;
  startedAt: number;
  status: AtomExecutionStatus;
  timedOut?: boolean;
}): Promise<void> {
  await writeFile(
    options.metadataPath,
    `${JSON.stringify({
      domain: options.identity.domain,
      key: options.identity.key,
      call: options.call,
      status: options.status,
      startedAt: options.startedAt,
      finishedAt: options.finishedAt,
      durationMs: Math.max(0, options.finishedAt - options.startedAt),
      exitCode: options.exitCode,
      provider: options.envelope.providerId,
      runId: options.envelope.runId,
      runAttempt: options.envelope.runAttempt,
      ...(options.timedOut == null ? {} : { timedOut: options.timedOut }),
    }, null, 2)}\n`,
    "utf8",
  );
}

async function writeNotRunAtom(
  atom: AtomDefinition,
  envelope: NormalizedEnvelope,
  unavailable: AtomSelection["unavailable"][number],
): Promise<AtomExecutionResult> {
  const identity = atomIdentity(atom);
  const logDir = atomLogDir(envelope, identity);
  const artifactDir = atomArtifactDir(envelope, identity);
  const stdoutPath = resolve(logDir, "stdout.log");
  const stderrPath = resolve(logDir, "stderr.log");
  const stepsPath = resolve(logDir, "steps.jsonl");
  const metadataPath = resolve(logDir, "metadata.json");
  const now = Date.now();

  await mkdir(logDir, { recursive: true });
  await mkdir(artifactDir, { recursive: true });
  await writeFile(stdoutPath, "", "utf8");
  await writeFile(stderrPath, `${unavailable.reason}\n`, "utf8");
  await writeFile(stepsPath, "", "utf8");
  await writeAtomMetadata({
    call: atom.call,
    envelope,
    exitCode: 0,
    finishedAt: now,
    identity,
    metadataPath,
    startedAt: now,
    status: "not-run",
  });

  return {
    action: identity.action,
    artifactDir,
    domain: identity.domain,
    exitCode: 0,
    kind: "placeholder",
    key: identity.key,
    metadataPath: relativeResultPath(envelope, metadataPath),
    missingCapabilities: unavailable.missingCapabilities,
    reason: unavailable.reason,
    status: "not-run",
    steps: [],
    stderr: stderrPath,
    stdout: stdoutPath,
  };
}

async function writeSetupFailureAtom(
  atom: AtomDefinition,
  envelope: NormalizedEnvelope,
  setupResult: WorkspaceSetupResult,
): Promise<AtomExecutionResult> {
  const identity = atomIdentity(atom);
  const logDir = atomLogDir(envelope, identity);
  const artifactDir = atomArtifactDir(envelope, identity);
  const stdoutPath = resolve(logDir, "stdout.log");
  const stderrPath = resolve(logDir, "stderr.log");
  const stepsPath = resolve(logDir, "steps.jsonl");
  const metadataPath = resolve(logDir, "metadata.json");
  const now = Date.now();
  const reason = `workspace-setup-failed; see ${setupResult.metadataPath}${setupResult.reason == null ? "" : `: ${setupResult.reason}`}`;

  await mkdir(logDir, { recursive: true });
  await mkdir(artifactDir, { recursive: true });
  await writeFile(stdoutPath, "", "utf8");
  await writeFile(stderrPath, `${reason}\n`, "utf8");
  await writeFile(stepsPath, "", "utf8");
  await writeAtomMetadata({
    call: atom.call,
    envelope,
    exitCode: setupResult.exitCode,
    finishedAt: now,
    identity,
    metadataPath,
    startedAt: now,
    status: "failure",
  });

  return {
    action: identity.action,
    artifactDir,
    domain: identity.domain,
    exitCode: setupResult.exitCode,
    kind: "placeholder",
    key: identity.key,
    metadataPath: relativeResultPath(envelope, metadataPath),
    reason,
    status: "failure",
    steps: [],
    stderr: stderrPath,
    stdout: stdoutPath,
  };
}

async function runAtom(atom: AtomDefinition, envelope: NormalizedEnvelope): Promise<AtomExecutionResult> {
  const identity = atomIdentity(atom);
  const logDir = atomLogDir(envelope, identity);
  const artifactDir = atomArtifactDir(envelope, identity);
  const stdoutPath = resolve(logDir, "stdout.log");
  const stderrPath = resolve(logDir, "stderr.log");
  const metadataPath = resolve(logDir, "metadata.json");
  const stepsPath = resolve(logDir, "steps.jsonl");
  await mkdir(logDir, { recursive: true });
  await mkdir(artifactDir, { recursive: true });
  await writeFile(stepsPath, "", "utf8");
  const stdoutStream = createWriteStream(stdoutPath, { flags: "w" });
  const stderrStream = createWriteStream(stderrPath, { flags: "w" });

  const startedAt = Date.now();
  const scriptPath = resolve(envelope.workDir, atom.script);
  const child = spawn("bash", [scriptPath], {
    cwd: envelope.workDir,
    env: {
      ...executionEnv(envelope),
      CI_GATE_ACTION_TIMINGS_PATH: stepsPath,
      CI_GATE_STEP_TIMEOUT_SECONDS: String(atom.timeoutSeconds),
      OD_CI_ARTIFACT_DIR: artifactDir,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    stdout += chunk;
    stdoutStream.write(chunk);
  });
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
    stderrStream.write(chunk);
  });

  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    child.kill("SIGTERM");
  }, atom.timeoutSeconds * 1000);

  const exitCode = await new Promise<number>((resolvePromise) => {
    child.on("close", (code) => resolvePromise(code ?? 1));
  });
  clearTimeout(timeout);
  const finishedAt = Date.now();

  stdoutStream.end();
  stderrStream.end();
  await Promise.all([once(stdoutStream, "finish"), once(stderrStream, "finish")]);
  await writeAtomMetadata({
    call: atom.call,
    envelope,
    exitCode,
    finishedAt,
    identity,
    metadataPath,
    startedAt,
    status: exitCode === 0 ? "success" : "failure",
    timedOut,
  });

  return {
    action: identity.action,
    artifactDir,
    domain: identity.domain,
    exitCode,
    kind: "real",
    key: identity.key,
    metadataPath: relativeResultPath(envelope, metadataPath),
    status: exitCode === 0 ? "success" : "failure",
    steps: parseJsonLines(stepsPath),
    stderr: stderrPath,
    stdout: stdoutPath,
  };
}

async function writeActionsJsonl(envelope: NormalizedEnvelope, actions: AtomExecutionResult[]): Promise<void> {
  await writeFile(
    resolve(envelope.resultsDir, "actions.jsonl"),
    actions.map((action) => JSON.stringify(serializeAction(envelope, action))).join("\n") + "\n",
    "utf8",
  );
}

function relativeActionPath(envelope: NormalizedEnvelope, path: string | undefined): string | undefined {
  if (path == null) return undefined;
  return isAbsolute(path) ? relativeResultPath(envelope, path) : path;
}

function serializeAction(envelope: NormalizedEnvelope, action: AtomExecutionResult): AtomExecutionResult {
  return {
    ...action,
    artifactDir: relativeActionPath(envelope, action.artifactDir),
    stderr: relativeActionPath(envelope, action.stderr),
    stdout: relativeActionPath(envelope, action.stdout),
  };
}

export async function executeAtoms(options: ExecuteAtomsOptions): Promise<CiExecutionResult> {
  const envelope = options.envelope ?? readNormalizedEnvelope();
  await ensureExecutionRoots(envelope);
  await prepareWritableWorkDir(envelope);

  const atomsByName = atomByName(options.manifest);
  const selectedAtoms = options.selection.selectedAtoms.map((atomName) => {
    const atom = atomsByName.get(atomName);
    if (atom == null) {
      throw new Error(`selected atom not found in manifest: ${atomName}`);
    }
    return atom;
  });
  process.stdout.write(`tools-ci execute setup: ${selectedAtoms.map((atom) => atom.name).join(", ")}\n`);
  const setupResult = await runWorkspaceSetup(envelope, selectedAtoms);
  if (setupResult != null) {
    process.stdout.write(`tools-ci execute setup ${setupResult.status}: workspace (${setupResult.exitCode})\n`);
  }

  const actions: AtomExecutionResult[] = [];
  for (const entry of options.selection.unavailable) {
    const atom = atomsByName.get(entry.atom);
    if (atom == null) {
      throw new Error(`unavailable atom not found in manifest: ${entry.atom}`);
    }
    actions.push(await writeNotRunAtom(atom, envelope, entry));
  }

  for (const atom of selectedAtoms) {
    process.stdout.write(`tools-ci atom start: ${atom.name}\n`);
    if (setupResult?.status === "failure" && needsWorkspaceSetup(atom)) {
      const action = await writeSetupFailureAtom(atom, envelope, setupResult);
      actions.push(action);
      process.stdout.write(`tools-ci atom ${action.status}: ${atom.name}\n`);
    } else {
      const action = await runAtom(atom, envelope);
      actions.push(action);
      process.stdout.write(`tools-ci atom ${action.status}: ${atom.name}\n`);
    }
  }

  const result: CiExecutionResult = {
    actions: actions.map((action) => serializeAction(envelope, action)),
    eventName: envelope.eventName,
    headSha: envelope.headSha,
    mode: envelope.mode,
    provider: envelope.providerId,
    runAttempt: envelope.runAttempt,
    runId: envelope.runId,
    schemaVersion: 1,
  };

  await writeActionsJsonl(envelope, actions);
  await writeFile(resolve(envelope.resultsDir, "ci-results.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8");
  return result;
}

export async function executeAtomsFromFiles(options: {
  manifestPath: string;
  selectionPath: string;
}): Promise<CiExecutionResult> {
  const manifest = await loadAtomManifest(resolve(options.manifestPath));
  const selection = JSON.parse(await readFile(resolve(options.selectionPath), "utf8")) as AtomSelection;
  return executeAtoms({ manifest, selection });
}
