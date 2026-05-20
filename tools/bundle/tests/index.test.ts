import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import {
  addBundleToStore,
  deleteBundleFromStore,
  listBundleStore,
  packBundle,
  resolveBundleFromStore,
  validateBundlePath,
} from "../src/index.js";

async function tempRoot(label: string): Promise<string> {
  return await mkdtemp(path.join(tmpdir(), `od-tools-bundle-${label}-`));
}

async function withTempRoot(label: string, run: (root: string) => Promise<void>): Promise<void> {
  const root = await tempRoot(label);
  try {
    await run(root);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
}

async function makeWebSource(root: string, entry = "sidecar/index.ts"): Promise<string> {
  const source = path.join(root, "source");
  const entryPath = path.join(source, entry);
  await mkdir(path.dirname(entryPath), { recursive: true });
  await writeFile(entryPath, "export {};\n", "utf8");
  await writeFile(path.join(source, "package.json"), "{\"name\":\"@open-design/web\"}\n", "utf8");
  return source;
}

describe("tools-bundle", () => {
  it("packs and validates a direct web bundle", async () => {
    await withTempRoot("pack", async (root) => {
      const sourcePath = await makeWebSource(root);
      const outPath = path.join(root, "bundle");

      const artifact = await packBundle({ app: "web", outPath, sourcePath });

      assert.equal(artifact.bundlePath, outPath);
      assert.deepEqual(artifact.descriptor, {
        entry: { kind: "tsx", path: "sidecar/index.ts" },
        schemaVersion: 1,
      });
      assert.equal(await readFile(path.join(outPath, "bundle.json"), "utf8"), `${JSON.stringify(artifact.descriptor, null, 2)}\n`);
      assert.deepEqual(await validateBundlePath(outPath), artifact);
    });
  });

  it("detects js web entries when no tsx sidecar entry exists", async () => {
    await withTempRoot("pack-js", async (root) => {
      const sourcePath = await makeWebSource(root, "sidecar/index.mjs");
      const outPath = path.join(root, "bundle");

      const artifact = await packBundle({ app: "web", outPath, sourcePath });

      assert.deepEqual(artifact.descriptor.entry, { kind: "js", path: "sidecar/index.mjs" });
    });
  });

  it("adds, resolves, lists, and deletes direct bundles through the store", async () => {
    await withTempRoot("store", async (root) => {
      const sourcePath = await makeWebSource(root);
      const bundlePath = path.join(root, "bundle");
      const basePath = path.join(root, "store");
      await packBundle({ app: "web", outPath: bundlePath, sourcePath });

      const added = await addBundleToStore({ basePath, bundlePath, version: "dev.1" });
      const resolved = await resolveBundleFromStore({ basePath, refOrVersion: "dev.1" });

      assert.deepEqual(added.ref, { key: "od:sidecar:web", version: "dev.1" });
      assert.equal((await listBundleStore(basePath)).length, 1);
      assert.equal(resolved.artifact.descriptor.entry.path, "sidecar/index.ts");
      assert.equal(await deleteBundleFromStore({ basePath, refOrVersion: "dev.1" }), true);
      assert.deepEqual(await listBundleStore(basePath), []);
    });
  });

  it("requires explicit replace for an existing output path", async () => {
    await withTempRoot("replace", async (root) => {
      const sourcePath = await makeWebSource(root);
      const outPath = path.join(root, "bundle");
      await packBundle({ app: "web", outPath, sourcePath });

      await assert.rejects(packBundle({ app: "web", outPath, sourcePath }), /already exists/);
      await assert.doesNotReject(packBundle({ app: "web", outPath, replace: true, sourcePath }));
    });
  });
});
