import { lstat, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  BundleStoreError,
  addBundle,
  deleteBundle,
  deleteBundleKey,
  listBundles,
  replaceBundle,
  resolveBundleArtifact,
  resolveBundleEntryPath,
  resolveBundle,
  resolveBundleBasePath,
  validateBundleDescriptor,
  validateBundleRef,
} from "../src/index.js";

let roots: string[] = [];

async function tempRoot(label: string): Promise<string> {
  const root = join(tmpdir(), `od-bundle-${label}-${process.pid}-${Date.now()}-${roots.length}`);
  roots.push(root);
  await mkdir(root, { recursive: true });
  return root;
}

async function sourceTree(label: string, files: Record<string, string>): Promise<string> {
  const root = await tempRoot(label);
  for (const [path, content] of Object.entries(files)) {
    const filePath = join(root, path);
    await mkdir(join(filePath, ".."), { recursive: true });
    await writeFile(filePath, content, "utf8");
  }
  return root;
}

beforeEach(() => {
  roots = [];
});

afterEach(async () => {
  await Promise.all(roots.map((root) => rm(root, { force: true, recursive: true })));
});

describe("bundle refs", () => {
  it("validates object refs without accepting compressed string semantics", () => {
    expect(validateBundleRef({ key: "od:sidecar:web", version: "0.8.0-beta.7+bundle.3" })).toEqual({
      key: "od:sidecar:web",
      version: "0.8.0-beta.7+bundle.3",
    });
    expect(() => validateBundleRef("od:sidecar:web@0.8.0" as never)).toThrow(BundleStoreError);
    expect(() => validateBundleRef({ key: "od/sidecar/web", version: "1" })).toThrow(BundleStoreError);
    expect(() => validateBundleRef({ key: "od:sidecar:web", version: "../1" })).toThrow(BundleStoreError);
  });

  it("resolves bundle base path from explicit value, env, then namespace data path", () => {
    expect(resolveBundleBasePath({
      explicitBasePath: "/tmp/explicit-bundles",
      env: { OD_BUNDLE_BASE_PATH: "/tmp/env-bundles" },
      namespaceDataPath: "/tmp/ns-data",
    })).toBe("/tmp/explicit-bundles");
    expect(resolveBundleBasePath({
      env: { OD_BUNDLE_BASE_PATH: "/tmp/env-bundles" },
      namespaceDataPath: "/tmp/ns-data",
    })).toBe("/tmp/env-bundles");
    expect(resolveBundleBasePath({
      env: {},
      namespaceDataPath: "/tmp/ns-data",
    })).toBe("/tmp/ns-data/bundles");
  });
});

describe("bundle artifact descriptors", () => {
  it("validates the minimal direct bundle descriptor shape", () => {
    expect(validateBundleDescriptor({
      entry: { kind: "tsx", path: "sidecar/index.ts" },
      schemaVersion: 1,
    })).toEqual({
      entry: { kind: "tsx", path: "sidecar/index.ts" },
      schemaVersion: 1,
    });
    expect(validateBundleDescriptor({
      entry: { kind: "js", path: "sidecar/index.mjs" },
      schemaVersion: 1,
    })).toEqual({
      entry: { kind: "js", path: "sidecar/index.mjs" },
      schemaVersion: 1,
    });
    expect(() => validateBundleDescriptor({ entry: { kind: "ts", path: "sidecar/index.ts" }, schemaVersion: 1 })).toThrow(BundleStoreError);
    expect(() => validateBundleDescriptor({ entry: { kind: "tsx", path: "/tmp/entry.ts" }, schemaVersion: 1 })).toThrow(BundleStoreError);
    expect(() => validateBundleDescriptor({ entry: { kind: "tsx", path: "../entry.ts" }, schemaVersion: 1 })).not.toThrow();
    expect(() => resolveBundleEntryPath({
      bundlePath: "/tmp/bundle",
      descriptor: { entry: { kind: "tsx", path: "../entry.ts" }, schemaVersion: 1 },
    })).toThrow(BundleStoreError);
  });

  it("resolves direct bundle roots through bundle.json", async () => {
    const bundlePath = await sourceTree("direct-bundle", {
      "bundle.json": JSON.stringify({
        entry: { kind: "js", path: "sidecar/index.mjs" },
        schemaVersion: 1,
      }),
      "sidecar/index.mjs": "export {};\n",
    });

    await expect(resolveBundleArtifact(bundlePath)).resolves.toMatchObject({
      bundlePath,
      descriptor: {
        entry: { kind: "js", path: "sidecar/index.mjs" },
        schemaVersion: 1,
      },
      entryPath: join(bundlePath, "sidecar", "index.mjs"),
    });
  });

  it("rejects direct bundle descriptors whose entry escapes the bundle root", async () => {
    const bundlePath = await sourceTree("escaped-direct-bundle", {
      "bundle.json": JSON.stringify({
        entry: { kind: "tsx", path: "../outside.ts" },
        schemaVersion: 1,
      }),
      "sidecar/index.ts": "export {};\n",
    });

    await expect(resolveBundleArtifact(bundlePath)).rejects.toMatchObject({ code: "bundle-entry-path-escaped" });
  });
});

describe("bundle inventory", () => {
  it("adds, lists, resolves, replaces, and deletes object-addressed bundles", async () => {
    const basePath = await tempRoot("store");
    const source = await sourceTree("source-a", { "server.mjs": "export const marker = 'a';\n" });
    const ref = { key: "od:sidecar:web", version: "dev.1" };

    const added = await addBundle({ basePath, ref, sourcePath: source, now: () => new Date("2026-05-20T00:00:00.000Z") });
    expect(added.ref).toEqual(ref);
    expect(added.entry.createdAt).toBe("2026-05-20T00:00:00.000Z");
    expect(await readFile(join(added.path, "server.mjs"), "utf8")).toContain("marker = 'a'");
    expect(await listBundles(basePath)).toHaveLength(1);

    await expect(addBundle({ basePath, ref, sourcePath: source })).rejects.toMatchObject({ code: "bundle-already-exists" });

    const nextSource = await sourceTree("source-b", { "server.mjs": "export const marker = 'b';\n" });
    const replaced = await replaceBundle({ basePath, ref, sourcePath: nextSource, now: () => new Date("2026-05-20T00:01:00.000Z") });
    expect(replaced.entry.createdAt).toBe("2026-05-20T00:01:00.000Z");
    expect(await readFile(join(replaced.path, "server.mjs"), "utf8")).toContain("marker = 'b'");
    expect(replaced.entry.digest.value).not.toBe(added.entry.digest.value);

    const resolved = await resolveBundle({ basePath, ref });
    expect(resolved.path).toBe(replaced.path);

    expect(await deleteBundle({ basePath, ref })).toBe(true);
    expect(await deleteBundle({ basePath, ref })).toBe(false);
    await expect(resolveBundle({ basePath, ref })).rejects.toMatchObject({ code: "bundle-not-found" });
  });

  it("deletes all versions for a key without touching other keys", async () => {
    const basePath = await tempRoot("delete-key");
    const source = await sourceTree("source", { "entry.mjs": "ok\n" });
    await addBundle({ basePath, ref: { key: "od:sidecar:web", version: "dev.1" }, sourcePath: source });
    await addBundle({ basePath, ref: { key: "od:sidecar:web", version: "dev.2" }, sourcePath: source });
    await addBundle({ basePath, ref: { key: "od:sidecar:daemon", version: "dev.1" }, sourcePath: source });

    expect(await deleteBundleKey({ basePath, key: "od:sidecar:web" })).toBe(2);
    expect((await listBundles(basePath)).map((entry) => entry.ref)).toEqual([{ key: "od:sidecar:daemon", version: "dev.1" }]);
  });

  it("rejects source trees with symlinks", async () => {
    const basePath = await tempRoot("symlink-store");
    const source = await sourceTree("symlink-source", { "entry.mjs": "ok\n" });
    await symlink("/tmp", join(source, "escape"));

    await expect(addBundle({
      basePath,
      ref: { key: "od:sidecar:web", version: "dev.1" },
      sourcePath: source,
    })).rejects.toMatchObject({ code: "bundle-source-symlink" });
  });

  it("rejects metadata paths that escape the bundle base path", async () => {
    const basePath = await tempRoot("escaped");
    await writeFile(join(basePath, "metadata.json"), JSON.stringify({
      bundles: [
        {
          createdAt: "2026-05-20T00:00:00.000Z",
          digest: { algorithm: "sha256", value: "x" },
          path: "../outside",
          ref: { key: "od:sidecar:web", version: "dev.1" },
        },
      ],
      version: 1,
    }), "utf8");

    await expect(resolveBundle({ basePath, ref: { key: "od:sidecar:web", version: "dev.1" } })).rejects.toMatchObject({
      code: "bundle-path-escaped",
    });
    await expect(deleteBundle({ basePath, ref: { key: "od:sidecar:web", version: "dev.1" } })).rejects.toMatchObject({
      code: "bundle-path-escaped",
    });
  });

  it("stores bundle content as directories", async () => {
    const basePath = await tempRoot("directory");
    const source = await sourceTree("directory-source", { "entry.mjs": "ok\n" });
    const resolved = await addBundle({ basePath, ref: { key: "od:sidecar:web", version: "dev.1" }, sourcePath: source });
    expect((await lstat(resolved.path)).isDirectory()).toBe(true);
  });
});
