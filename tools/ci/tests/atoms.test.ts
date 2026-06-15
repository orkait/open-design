import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

import { parseAtomManifest, validateAtomManifest } from "../src/atoms.js";

test("parseAtomManifest accepts a legacy flat atom manifest", () => {
  const manifest = parseAtomManifest({
    schemaVersion: 1,
    atoms: [
      {
        artifactProfile: "standard",
        cacheProfile: "node-pnpm",
        name: "guard",
        requires: ["node", "pnpm"],
        resultRequired: true,
        script: ".github/workflows/scripts/ci/actions/guard.sh",
        setup: "pnpm-workspace",
        timeoutSeconds: 600,
      },
    ],
  });

  assert.equal(manifest.atoms.length, 1);
  assert.equal(manifest.atoms[0]?.name, "guard");
  assert.equal(manifest.atoms[0]?.domain, "workspace");
  assert.equal(manifest.atoms[0]?.key, "guard");
  assert.equal(manifest.atoms[0]?.call, "pnpm guard");
});

test("parseAtomManifest accepts a domain/key atom manifest", () => {
  const manifest = parseAtomManifest({
    schemaVersion: 1,
    atoms: [
      {
        artifactProfile: "standard",
        cacheProfile: "node-pnpm",
        call: "pnpm guard",
        domain: "workspace",
        key: "guard",
        name: "guard",
        requires: ["node", "pnpm"],
        resultRequired: true,
        script: ".github/workflows/scripts/ci/actions/guard.sh",
        setup: "pnpm-workspace",
        timeoutSeconds: 600,
      },
    ],
  });

  assert.equal(manifest.atoms.length, 1);
  assert.equal(manifest.atoms[0]?.domain, "workspace");
  assert.equal(manifest.atoms[0]?.key, "guard");
  assert.equal(manifest.atoms[0]?.name, "guard");
  assert.equal(manifest.atoms[0]?.call, "pnpm guard");
});

test("parseAtomManifest rejects mismatched name and domain/key", () => {
  assert.throws(
    () => parseAtomManifest({
      schemaVersion: 1,
      atoms: [
        {
          artifactProfile: "standard",
          cacheProfile: "node-pnpm",
          domain: "nix",
          key: "flake",
          name: "guard",
          requires: ["node", "pnpm"],
          resultRequired: true,
          script: ".github/workflows/scripts/ci/actions/guard.sh",
          setup: "pnpm-workspace",
          timeoutSeconds: 600,
        },
      ],
    }),
    /name must match domain\/key identity/,
  );
});

test("parseAtomManifest rejects duplicate atom names", () => {
  assert.throws(
    () => parseAtomManifest({
      schemaVersion: 1,
      atoms: [
        {
          artifactProfile: "standard",
          cacheProfile: "node-pnpm",
          name: "guard",
          requires: ["node", "pnpm"],
          resultRequired: true,
          script: ".github/workflows/scripts/ci/actions/guard.sh",
          setup: "pnpm-workspace",
          timeoutSeconds: 600,
        },
        {
          artifactProfile: "standard",
          cacheProfile: "node-pnpm",
          name: "guard",
          requires: ["node", "pnpm"],
          resultRequired: true,
          script: ".github/workflows/scripts/ci/actions/i18n.sh",
          setup: "pnpm-workspace",
          timeoutSeconds: 600,
        },
      ],
    }),
    /duplicate atom name: guard/,
  );
});

test("parseAtomManifest rejects provider-shaped script paths", () => {
  assert.throws(
    () => parseAtomManifest({
      schemaVersion: 1,
      atoms: [
        {
          artifactProfile: "standard",
          cacheProfile: "node-pnpm",
          name: "bad",
          requires: ["node", "pnpm"],
          resultRequired: true,
          script: "../outside-actions.sh",
          setup: "pnpm-workspace",
          timeoutSeconds: 600,
        },
      ],
    }),
    /repo-relative shell script path/,
  );
});

test("validateAtomManifest resolves the default repo root from the workflow manifest path", async () => {
  const root = await mkdtemp(join(tmpdir(), "tools-ci-atoms-"));
  try {
    const manifestDir = join(root, ".github", "workflows", "scripts", "ci");
    const actionsDir = join(manifestDir, "actions");
    await mkdir(actionsDir, { recursive: true });
    await writeFile(join(actionsDir, "guard.sh"), "#!/usr/bin/env bash\n", "utf8");
    const manifestPath = join(manifestDir, "atoms.json");
    await writeFile(
      manifestPath,
      `${JSON.stringify({
        schemaVersion: 1,
        atoms: [
          {
            artifactProfile: "standard",
            cacheProfile: "node-pnpm",
            name: "guard",
            requires: ["node", "pnpm"],
            resultRequired: true,
            script: ".github/workflows/scripts/ci/actions/guard.sh",
            setup: "pnpm-workspace",
            timeoutSeconds: 600,
          },
        ],
      })}\n`,
      "utf8",
    );

    const result = await validateAtomManifest(manifestPath);
    assert.deepEqual(result.atomNames, ["guard"]);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("validateAtomManifest resolves the default repo root from the tools-ci manifest path", async () => {
  const root = await mkdtemp(join(tmpdir(), "tools-ci-atoms-"));
  try {
    const manifestDir = join(root, "tools", "ci");
    const actionsDir = join(root, ".github", "workflows", "scripts", "ci", "actions");
    await mkdir(manifestDir, { recursive: true });
    await mkdir(actionsDir, { recursive: true });
    await writeFile(join(actionsDir, "guard.sh"), "#!/usr/bin/env bash\n", "utf8");
    const manifestPath = join(manifestDir, "atoms.json");
    await writeFile(
      manifestPath,
      `${JSON.stringify({
        schemaVersion: 1,
        atoms: [
          {
            artifactProfile: "standard",
            cacheProfile: "node-pnpm",
            call: "pnpm guard",
            domain: "workspace",
            key: "guard",
            name: "guard",
            requires: ["node", "pnpm"],
            resultRequired: true,
            script: ".github/workflows/scripts/ci/actions/guard.sh",
            setup: "pnpm-workspace",
            timeoutSeconds: 600,
          },
        ],
      })}\n`,
      "utf8",
    );

    const result = await validateAtomManifest(manifestPath);
    assert.deepEqual(result.atomNames, ["guard"]);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});
