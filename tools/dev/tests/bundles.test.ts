import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import type { ToolDevConfig } from "../src/config.js";
import {
  resolveWebImplementation,
  sidecarImplementationEnv,
} from "../src/bundles.js";

async function makeTempConfig(): Promise<ToolDevConfig> {
  const root = await mkdtemp(path.join(tmpdir(), "od-tools-dev-bundles-"));
  const dataRoot = path.join(root, "data");
  return {
    apps: {
      daemon: {
        app: "daemon",
        ipcPath: path.join(root, "daemon.sock"),
        latestLogPath: path.join(root, "logs", "daemon", "latest.log"),
        logDir: path.join(root, "logs", "daemon"),
        sidecarEntryPath: path.join(root, "daemon-sidecar.ts"),
      },
      desktop: {
        app: "desktop",
        electronBinaryPath: "electron",
        ipcPath: path.join(root, "desktop.sock"),
        latestLogPath: path.join(root, "logs", "desktop", "latest.log"),
        logDir: path.join(root, "logs", "desktop"),
        mainEntryPath: path.join(root, "desktop.js"),
        packageJsonPath: path.join(root, "package.json"),
      },
      web: {
        app: "web",
        ipcPath: path.join(root, "web.sock"),
        latestLogPath: path.join(root, "logs", "web", "latest.log"),
        logDir: path.join(root, "logs", "web"),
        nextDistDir: path.join(root, "runtime", "web", "next"),
        nextTsconfigPath: path.join(root, "runtime", "web", "tsconfig.json"),
        sidecarEntryPath: path.join(root, "workspace", "apps", "web", "sidecar", "index.ts"),
      },
    },
    bundlePath: null,
    dataRoot,
    namespace: "test",
    namespaceRoot: root,
    toolsDevRoot: root,
    tsxCliPath: "tsx",
    workspaceRoot: path.join(root, "workspace"),
  };
}

async function makeDirectBundle(root: string, input: {
  entryKind?: "js" | "tsx";
  entryPath?: string;
} = {}): Promise<string> {
  const bundlePath = path.join(root, "bundle");
  const entryPath = input.entryPath ?? "sidecar/index.ts";
  await mkdir(bundlePath, { recursive: true });
  await mkdir(path.dirname(path.join(bundlePath, entryPath)), { recursive: true });
  await writeFile(path.join(bundlePath, entryPath), "export {};\n", "utf8");
  await writeFile(path.join(bundlePath, "bundle.json"), `${JSON.stringify({
    entry: {
      kind: input.entryKind ?? "tsx",
      path: entryPath,
    },
    schemaVersion: 1,
  }, null, 2)}\n`, "utf8");
  return bundlePath;
}

describe("tools-dev direct bundle consumption", () => {
  it("defaults to the workspace web sidecar when no bundle path is provided", async () => {
    const config = await makeTempConfig();

    const implementation = await resolveWebImplementation(config);

    assert.equal(implementation.entryKind, "tsx");
    assert.equal(implementation.entryPath, config.apps.web.sidecarEntryPath);
    assert.equal(implementation.implementation, null);
    assert.deepEqual(implementation.source, { type: "workspace" });
  });

  it("resolves a direct bundle root and serializes implementation diagnostics", async () => {
    const config = await makeTempConfig();
    const bundlePath = await makeDirectBundle(config.namespaceRoot);
    config.bundlePath = bundlePath;

    const implementation = await resolveWebImplementation(config);
    const env = sidecarImplementationEnv(implementation.implementation);

    assert.equal(implementation.entryKind, "tsx");
    assert.equal(implementation.entryPath, path.join(bundlePath, "sidecar", "index.ts"));
    assert.equal(implementation.implementation?.source, "bundle");
    assert.deepEqual(implementation.implementation, {
      bundlePath,
      descriptorPath: path.join(bundlePath, "bundle.json"),
      entryPath: path.join(bundlePath, "sidecar", "index.ts"),
      source: "bundle",
    });
    assert.match(env.OD_SIDECAR_IMPLEMENTATION_JSON ?? "", /"source":"bundle"/);
  });

  it("preserves js entry kind so tools-dev can launch without tsx", async () => {
    const config = await makeTempConfig();
    const bundlePath = await makeDirectBundle(config.namespaceRoot, {
      entryKind: "js",
      entryPath: "sidecar/index.mjs",
    });
    config.bundlePath = bundlePath;

    const implementation = await resolveWebImplementation(config);

    assert.equal(implementation.entryKind, "js");
    assert.equal(implementation.entryPath, path.join(bundlePath, "sidecar", "index.mjs"));
  });

  it("rejects direct bundle entries that escape the bundle root", async () => {
    const config = await makeTempConfig();
    const bundlePath = await makeDirectBundle(config.namespaceRoot, {
      entryPath: "../outside.ts",
    });
    config.bundlePath = bundlePath;

    await assert.rejects(resolveWebImplementation(config), /escaped the bundle path/);
  });
});
