import { spawn } from "node:child_process";
import { lstat, mkdir, open, readdir, rm, symlink, writeFile, type FileHandle } from "node:fs/promises";
import path from "node:path";

import {
  APP_KEYS,
  OPEN_DESIGN_SIDECAR_CONTRACT,
  SIDECAR_ENV,
  SIDECAR_SOURCES,
} from "@open-design/sidecar-proto";
import { createSidecarLaunchEnv } from "@open-design/sidecar";
import {
  collectProcessTreePids,
  createPackageManagerInvocation,
  createProcessStampArgs,
  listProcessSnapshots,
  matchesStampedProcess,
  spawnBackgroundProcess,
} from "@open-design/platform";
import type { BundleEntryKind } from "@open-design/bundle";

import { parsePortOption, type ToolDevAppName, type ToolDevConfig } from "../config.js";
import { resolveWebImplementation, sidecarImplementationEnv, type ToolsDevWebSource } from "../bundles.js";
import { waitForDaemonRuntime } from "../sidecar-client.js";
import type { CliOptions } from "./options.js";

const PARENT_PID_ENV = SIDECAR_ENV.TOOLS_DEV_PARENT_PID;

export function runtimeLookup(config: ToolDevConfig) {
  return { base: config.toolsDevRoot, namespace: config.namespace };
}

export function appConfig(config: ToolDevConfig, appName: ToolDevAppName) {
  return config.apps[appName];
}

export function urlPort(url: string): string {
  const parsed = new URL(url);
  if (parsed.port) return parsed.port;
  return parsed.protocol === "https:" ? "443" : "80";
}

function formatWebSource(source: ToolsDevWebSource): string {
  if (source.type === "workspace") return "workspace";
  return `bundle ${source.artifact.bundlePath} entry ${source.artifact.descriptor.entry.path}`;
}

export function statusMatchesForcedPort(url: string | null | undefined, forcedPort: number | null): boolean {
  return forcedPort == null || (url != null && urlPort(url) === String(forcedPort));
}

function prependNodePath(entries: string[], current = process.env.NODE_PATH): string {
  const existing = current == null || current.length === 0 ? [] : current.split(path.delimiter);
  return [...entries, ...existing].join(path.delimiter);
}

async function openAppLog(config: ToolDevConfig, appName: ToolDevAppName): Promise<FileHandle> {
  const logPath = appConfig(config, appName).latestLogPath;
  await mkdir(path.dirname(logPath), { recursive: true });
  return await open(logPath, "a");
}

async function runLoggedCommand(request: {
  args: string[];
  command: string;
  cwd: string;
  env?: NodeJS.ProcessEnv;
  logFd: number;
  windowsVerbatimArguments?: boolean;
}): Promise<void> {
  const child = spawn(request.command, request.args, {
    cwd: request.cwd,
    env: request.env,
    stdio: ["ignore", request.logFd, request.logFd],
    windowsHide: process.platform === "win32",
    windowsVerbatimArguments: request.windowsVerbatimArguments,
  });

  await new Promise<void>((resolveRun, rejectRun) => {
    child.once("error", rejectRun);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolveRun();
        return;
      }
      rejectRun(new Error(`command failed: ${request.command} ${request.args.join(" ")} (${signal ?? code})`));
    });
  });
}

function createAppStamp(config: ToolDevConfig, appName: ToolDevAppName) {
  const currentAppConfig = appConfig(config, appName);
  const stamp = {
    app: appName,
    ipc: currentAppConfig.ipcPath,
    mode: "dev" as const,
    namespace: config.namespace,
    source: SIDECAR_SOURCES.TOOLS_DEV,
  };

  return {
    args: createProcessStampArgs(stamp, OPEN_DESIGN_SIDECAR_CONTRACT),
    env: createSidecarLaunchEnv({
      base: config.toolsDevRoot,
      contract: OPEN_DESIGN_SIDECAR_CONTRACT,
      stamp,
    }),
    stamp,
  };
}

export async function findAppProcessTree(config: ToolDevConfig, appName: ToolDevAppName) {
  const processes = await listProcessSnapshots();
  const rootPids = processes
    .filter((processInfo) =>
      matchesStampedProcess(processInfo, {
        app: appName,
        mode: "dev",
        namespace: config.namespace,
        source: SIDECAR_SOURCES.TOOLS_DEV,
      }, OPEN_DESIGN_SIDECAR_CONTRACT),
    )
    .map((processInfo) => processInfo.pid);
  const pids = collectProcessTreePids(processes, rootPids);

  return { pids, rootPids };
}

export async function waitForExit(config: ToolDevConfig, appName: ToolDevAppName, timeoutMs = 5000): Promise<number[]> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const current = await findAppProcessTree(config, appName);
    if (current.pids.length === 0) return [];
    await new Promise((resolveWait) => setTimeout(resolveWait, 120));
  }
  return (await findAppProcessTree(config, appName)).pids;
}

export async function assertNoStaleProcess(config: ToolDevConfig, appName: ToolDevAppName): Promise<void> {
  const active = await findAppProcessTree(config, appName);
  if (active.pids.length > 0) {
    throw new Error(`${appName} has active stamped processes but no reachable IPC status; run tools-dev stop ${appName} first`);
  }
}

async function spawnSidecarRuntime(request: {
  appName: typeof APP_KEYS.DAEMON | typeof APP_KEYS.WEB;
  config: ToolDevConfig;
  entryKind?: BundleEntryKind;
  entryPath?: string;
  env: NodeJS.ProcessEnv;
  logHandle: FileHandle;
}): Promise<{ pid: number }> {
  const { args: stampArgs, env } = createAppStamp(request.config, request.appName);
  const sidecarConfig = request.config.apps[request.appName];
  const entryPath = request.entryPath ?? sidecarConfig.sidecarEntryPath;
  const args = request.entryKind === "js"
    ? [entryPath, ...stampArgs]
    : [request.config.tsxCliPath, entryPath, ...stampArgs];
  const spawned = await spawnBackgroundProcess({
    args,
    command: process.execPath,
    cwd: request.config.workspaceRoot,
    detached: true,
    env: {
      ...process.env,
      ...env,
      ...request.env,
    },
    logFd: request.logHandle.fd,
  });
  return { pid: spawned.pid };
}

export async function spawnDaemonRuntime(
  config: ToolDevConfig,
  options: CliOptions,
  spawnOptions: { requireDesktopAuth?: boolean } = {},
): Promise<{ pid: number }> {
  const daemonPort = parsePortOption(options.daemonPort, "--daemon-port");
  const webPort = parsePortOption(options.webPort, "--web-port");
  const logHandle = await openAppLog(config, APP_KEYS.DAEMON);

  try {
    await ensureDaemonCliBuild(config, logHandle);
    await logHandle.write(`\n[tools-dev] launching daemon at ${new Date().toISOString()}\n`);
    if (webPort != null) await logHandle.write(`[tools-dev] trusting web origin port ${webPort}\n`);
    if (spawnOptions.requireDesktopAuth) {
      await logHandle.write(`[tools-dev] requiring desktop auth on /api/import/folder\n`);
    }
    return await spawnSidecarRuntime({
      appName: APP_KEYS.DAEMON,
      config,
      env: {
        [SIDECAR_ENV.DAEMON_PORT]: String(daemonPort ?? 0),
        ...(webPort == null ? {} : { [SIDECAR_ENV.WEB_PORT]: String(webPort) }),
        ...(options.parentPid == null ? {} : { [PARENT_PID_ENV]: String(options.parentPid) }),
        ...(spawnOptions.requireDesktopAuth ? { OD_REQUIRE_DESKTOP_AUTH: "1" } : {}),
      },
      logHandle,
    });
  } finally {
    await logHandle.close();
  }
}

export async function spawnWebRuntime(config: ToolDevConfig, options: CliOptions): Promise<{ pid: number }> {
  const daemonStatus = await waitForDaemonRuntime(runtimeLookup(config));
  if (daemonStatus.url == null) throw new Error("daemon must be running before web starts");

  const webPort = parsePortOption(options.webPort, "--web-port");
  const daemonPort = urlPort(daemonStatus.url);
  const logHandle = await openAppLog(config, APP_KEYS.WEB);

  try {
    const webImplementation = await resolveWebImplementation(config);
    await ensureWebModules(config);
    await writeWebDevTsconfig(config);
    await logHandle.write(`\n[tools-dev] launching web at ${new Date().toISOString()}\n`);
    await logHandle.write(`[tools-dev] web implementation: ${formatWebSource(webImplementation.source)}\n`);
    await logHandle.write(`[tools-dev] proxying web API requests to daemon port ${daemonPort}\n`);
    return await spawnSidecarRuntime({
      appName: APP_KEYS.WEB,
      config,
      entryKind: webImplementation.entryKind,
      entryPath: webImplementation.entryPath,
      env: {
        NODE_PATH: prependNodePath([
          path.join(config.workspaceRoot, "apps/web/node_modules"),
          path.join(config.workspaceRoot, "node_modules"),
        ]),
        [SIDECAR_ENV.DAEMON_PORT]: daemonPort,
        [SIDECAR_ENV.WEB_DIST_DIR]: config.apps.web.nextDistDir,
        [SIDECAR_ENV.WEB_TSCONFIG_PATH]: config.apps.web.nextTsconfigPath,
        [SIDECAR_ENV.WEB_PORT]: String(webPort ?? 0),
        PORT: String(webPort ?? 0),
        ...sidecarImplementationEnv(webImplementation.implementation),
        ...(options.parentPid == null ? {} : { [PARENT_PID_ENV]: String(options.parentPid) }),
        ...(options.prod === true
          ? { NODE_ENV: "production", OD_WEB_OUTPUT_MODE: "server", OD_WEB_PROD: "1" }
          : {}),
      },
      logHandle,
    });
  } finally {
    await logHandle.close();
  }
}

async function buildDesktop(config: ToolDevConfig, logHandle: FileHandle): Promise<void> {
  await logHandle.write(`\n[tools-dev] building @open-design/desktop at ${new Date().toISOString()}\n`);
  const invocation = createPackageManagerInvocation(["--filter", "@open-design/desktop", "build"], process.env);
  await runLoggedCommand({
    args: invocation.args,
    command: invocation.command,
    cwd: config.workspaceRoot,
    env: process.env,
    logFd: logHandle.fd,
    windowsVerbatimArguments: invocation.windowsVerbatimArguments,
  });
}

async function latestMtimeMs(filePath: string): Promise<number> {
  const entry = await lstat(filePath).catch(() => null);
  if (entry == null) return 0;
  if (!entry.isDirectory()) return entry.mtimeMs;

  const children = await readdir(filePath, { withFileTypes: true }).catch(() => []);
  let latest = entry.mtimeMs;
  for (const child of children) {
    if (child.name === "node_modules" || child.name === "dist" || child.name === ".tmp") continue;
    latest = Math.max(latest, await latestMtimeMs(path.join(filePath, child.name)));
  }
  return latest;
}

async function ensureDaemonCliBuild(config: ToolDevConfig, logHandle: FileHandle): Promise<void> {
  const daemonRoot = path.join(config.workspaceRoot, "apps/daemon");
  const distCliPath = path.join(daemonRoot, "dist/cli.js");
  const distMtime = await latestMtimeMs(distCliPath);
  const sourceMtime = Math.max(
    await latestMtimeMs(path.join(daemonRoot, "src")),
    await latestMtimeMs(path.join(daemonRoot, "package.json")),
    await latestMtimeMs(path.join(daemonRoot, "tsconfig.json")),
  );
  if (distMtime > 0 && distMtime >= sourceMtime) return;

  const reason = distMtime > 0 ? "source is newer than apps/daemon/dist/cli.js" : "apps/daemon/dist/cli.js is missing";
  await logHandle.write(`\n[tools-dev] building @open-design/daemon because ${reason} at ${new Date().toISOString()}\n`);
  const invocation = createPackageManagerInvocation(["--filter", "@open-design/daemon", "build"], process.env);
  await runLoggedCommand({
    args: invocation.args,
    command: invocation.command,
    cwd: config.workspaceRoot,
    env: process.env,
    logFd: logHandle.fd,
    windowsVerbatimArguments: invocation.windowsVerbatimArguments,
  });
}

async function ensureWebModules(config: ToolDevConfig): Promise<void> {
  const webRuntimeRoot = path.dirname(config.apps.web.nextDistDir);
  const runtimeNodeModules = path.join(webRuntimeRoot, "node_modules");
  const webNodeModules = path.join(config.workspaceRoot, "apps/web/node_modules");

  await mkdir(webRuntimeRoot, { recursive: true });
  const current = await lstat(runtimeNodeModules).catch(() => null);
  if (current?.isSymbolicLink()) return;
  if (current != null) await rm(runtimeNodeModules, { force: true, recursive: true });
  await symlink(webNodeModules, runtimeNodeModules, "junction");
}

async function writeWebDevTsconfig(config: ToolDevConfig): Promise<void> {
  const webRoot = path.join(config.workspaceRoot, "apps/web");
  const tsconfigPath = config.apps.web.nextTsconfigPath;
  const tsconfigDir = path.dirname(tsconfigPath);
  const sourceTsconfig = path.join(webRoot, "tsconfig.json");
  const relativeSourceTsconfig = (path.relative(tsconfigDir, sourceTsconfig) || "./tsconfig.json").replaceAll("\\", "/");

  await mkdir(tsconfigDir, { recursive: true });
  await writeFile(
    tsconfigPath,
    `${JSON.stringify({
      extends: relativeSourceTsconfig,
      compilerOptions: {
        plugins: [{ name: "next" }],
      },
    }, null, 2)}\n`,
    "utf8",
  );
}

export async function spawnDesktopRuntime(config: ToolDevConfig, options: CliOptions): Promise<{ pid: number }> {
  const { args: stampArgs, env } = createAppStamp(config, APP_KEYS.DESKTOP);
  const logHandle = await openAppLog(config, APP_KEYS.DESKTOP);

  try {
    await buildDesktop(config, logHandle);
    await logHandle.write(`[tools-dev] launching desktop at ${new Date().toISOString()}\n`);
    const spawnEnv: NodeJS.ProcessEnv = {
      ...process.env,
      ...env,
      ...(options.parentPid == null ? {} : { [PARENT_PID_ENV]: String(options.parentPid) }),
    };
    for (const key of Object.keys(spawnEnv)) {
      if (key.toUpperCase() === "ELECTRON_RUN_AS_NODE") {
        delete spawnEnv[key];
      }
    }
    const spawned = await spawnBackgroundProcess({
      args: [config.apps.desktop.mainEntryPath, ...stampArgs],
      command: config.apps.desktop.electronBinaryPath,
      cwd: config.workspaceRoot,
      detached: true,
      env: spawnEnv,
      logFd: logHandle.fd,
    });
    return { pid: spawned.pid };
  } finally {
    await logHandle.close();
  }
}
