import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { parseAtomManifest } from "../src/atoms.js";
import { executeAtoms } from "../src/execute.js";

test("executeAtoms runs selected atom scripts and writes result files", async () => {
  const root = await mkdtemp(join(tmpdir(), "tools-ci-execute-"));
  try {
    const workDir = join(root, "work");
    const resultsDir = join(root, "results");
    const artifactsDir = join(root, "artifacts");
    const cacheDir = join(root, "cache");
    const tmpDir = join(root, "tmp");
    const actionsDir = join(workDir, ".github", "workflows", "scripts", "ci", "actions");
    await mkdir(actionsDir, { recursive: true });
    await mkdir(cacheDir, { recursive: true });
    await mkdir(tmpDir, { recursive: true });
    await writeFile(
      join(actionsDir, "guard.sh"),
      [
        "#!/usr/bin/env bash",
        "set -euo pipefail",
        "echo atom-ok",
        "printf '%s\\n' '{\"name\":\"fake-step\",\"durationMs\":1,\"status\":\"success\"}' >> \"$CI_GATE_ACTION_TIMINGS_PATH\"",
      ].join("\n"),
      "utf8",
    );

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
          requires: ["node"],
          resultRequired: true,
          script: ".github/workflows/scripts/ci/actions/guard.sh",
          setup: "none",
          timeoutSeconds: 5,
        },
        {
          artifactProfile: "nix",
          cacheProfile: "nix",
          call: "nix flake check --print-build-logs --keep-going",
          domain: "nix",
          key: "flake",
          name: "nix",
          requires: ["nix"],
          resultRequired: true,
          script: ".github/workflows/scripts/ci/actions/nix.sh",
          setup: "nix-flake",
          timeoutSeconds: 5,
        },
      ],
    });

    const result = await executeAtoms({
      envelope: {
        artifactsDir,
        cacheDir,
        capabilitiesPath: join(root, "capabilities.json"),
        eventName: "workflow_dispatch",
        headSha: "abc123",
        manifestPath: join(root, "atoms.json"),
        mode: "default",
        providerId: "test",
        repoDir: workDir,
        resultsDir,
        runAttempt: "1",
        runId: "local",
        tmpDir,
        workDir,
      },
      manifest,
      selection: {
        provider: "test",
        schemaVersion: 1,
        selectedAtoms: ["guard"],
        unavailable: [
          {
            atom: "nix",
            missingCapabilities: ["nix"],
            reason: "nix-capability-unavailable",
            status: "unavailable",
          },
        ],
      },
    });

    assert.equal(result.actions.find((action) => action.action === "guard")?.status, "success");
    assert.equal(result.actions.find((action) => action.action === "nix")?.status, "not-run");
    assert.equal(result.schemaVersion, 1);
    assert.equal(result.eventName, "workflow_dispatch");
    assert.equal(result.headSha, "abc123");
    assert.match(await readFile(join(resultsDir, "logs", "workspace", "guard", "stdout.log"), "utf8"), /atom-ok/);
    assert.match(await readFile(join(resultsDir, "logs", "workspace", "guard", "steps.jsonl"), "utf8"), /fake-step/);
    const guardMetadata = JSON.parse(await readFile(join(resultsDir, "logs", "workspace", "guard", "metadata.json"), "utf8")) as {
      domain: string;
      key: string;
      status: string;
      exitCode: number;
    };
    assert.equal(guardMetadata.domain, "workspace");
    assert.equal(guardMetadata.key, "guard");
    assert.equal(guardMetadata.status, "success");
    assert.equal(guardMetadata.exitCode, 0);
    const nixMetadata = JSON.parse(await readFile(join(resultsDir, "logs", "nix", "flake", "metadata.json"), "utf8")) as {
      domain: string;
      key: string;
      status: string;
    };
    assert.equal(nixMetadata.domain, "nix");
    assert.equal(nixMetadata.key, "flake");
    assert.equal(nixMetadata.status, "not-run");
    assert.match(await readFile(join(resultsDir, "logs", "nix", "flake", "stderr.log"), "utf8"), /nix-capability-unavailable/);
    assert.match(await readFile(join(resultsDir, "ci-results.json"), "utf8"), /"schemaVersion": 1/);
    const actionsJsonl = await readFile(join(resultsDir, "actions.jsonl"), "utf8");
    assert.match(actionsJsonl, /"metadataPath":"logs\/workspace\/guard\/metadata.json"/);
    assert.match(actionsJsonl, /"metadataPath":"logs\/nix\/flake\/metadata.json"/);
    assert.deepEqual(await readdir(join(artifactsDir, "workspace", "guard")), []);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("executeAtoms prepares a pnpm workspace when selected atoms need it", async () => {
  const root = await mkdtemp(join(tmpdir(), "tools-ci-setup-"));
  const originalPath = process.env.PATH;
  try {
    const workDir = join(root, "work");
    const resultsDir = join(root, "results");
    const artifactsDir = join(root, "artifacts");
    const cacheDir = join(root, "cache");
    const tmpDir = join(root, "tmp");
    const binDir = join(root, "bin");
    const actionsDir = join(workDir, ".github", "workflows", "scripts", "ci", "actions");
    await mkdir(actionsDir, { recursive: true });
    await mkdir(cacheDir, { recursive: true });
    await mkdir(tmpDir, { recursive: true });
    await mkdir(binDir, { recursive: true });
    await writeFile(join(workDir, "package.json"), `${JSON.stringify({ packageManager: "pnpm@10.33.2" })}\n`, "utf8");
    await writeFile(
      join(binDir, "corepack"),
      [
        "#!/usr/bin/env bash",
        "set -euo pipefail",
        "printf 'corepack %s\\n' \"$*\"",
        "printf 'COREPACK_HOME=%s\\n' \"$COREPACK_HOME\"",
      ].join("\n"),
      "utf8",
    );
    await writeFile(
      join(binDir, "pnpm"),
      [
        "#!/usr/bin/env bash",
        "set -euo pipefail",
        "printf 'pnpm %s\\n' \"$*\"",
        "printf 'store=%s\\n' \"$npm_config_store_dir\"",
      ].join("\n"),
      "utf8",
    );
    await chmod(join(binDir, "corepack"), 0o755);
    await chmod(join(binDir, "pnpm"), 0o755);
    process.env.PATH = `${binDir}${process.platform === "win32" ? ";" : ":"}${originalPath ?? ""}`;

    await writeFile(
      join(actionsDir, "guard.sh"),
      [
        "#!/usr/bin/env bash",
        "set -euo pipefail",
        "printf 'guard\\n'",
      ].join("\n"),
      "utf8",
    );

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
          requires: ["node"],
          resultRequired: true,
          script: ".github/workflows/scripts/ci/actions/guard.sh",
          setup: "pnpm-workspace",
          timeoutSeconds: 5,
        },
      ],
    });

    await executeAtoms({
      envelope: {
        artifactsDir,
        cacheDir,
        capabilitiesPath: join(root, "capabilities.json"),
        eventName: "workflow_dispatch",
        headSha: "abc123",
        manifestPath: join(root, "atoms.json"),
        mode: "default",
        providerId: "test",
        repoDir: workDir,
        resultsDir,
        runAttempt: "1",
        runId: "local",
        tmpDir,
        workDir,
      },
      manifest,
      selection: {
        provider: "test",
        schemaVersion: 1,
        selectedAtoms: ["guard"],
        unavailable: [],
      },
    });

    const setupStdout = await readFile(join(resultsDir, "logs", "setup", "workspace", "stdout.log"), "utf8");
    assert.match(setupStdout, /corepack prepare pnpm@10\.33\.2 --activate/);
    assert.match(setupStdout, /pnpm install --frozen-lockfile --prefer-offline --network-concurrency=8/);
    assert.match(setupStdout, new RegExp(`COREPACK_HOME=${join(cacheDir, "corepack").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
    assert.match(setupStdout, new RegExp(`store=${join(cacheDir, "pnpm-store").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
    const setupMetadata = JSON.parse(await readFile(join(resultsDir, "logs", "setup", "workspace", "metadata.json"), "utf8")) as {
      status: string;
    };
    assert.equal(setupMetadata.status, "success");
    assert.match(await readFile(join(resultsDir, "logs", "workspace", "guard", "stdout.log"), "utf8"), /guard/);
  } finally {
    process.env.PATH = originalPath;
    await rm(root, { force: true, recursive: true });
  }
});

test("executeAtoms can provide a pnpm shim through corepack", async () => {
  const root = await mkdtemp(join(tmpdir(), "tools-ci-corepack-pnpm-"));
  const originalPath = process.env.PATH;
  const originalShim = process.env.OD_CI_USE_COREPACK_PNPM_SHIM;
  try {
    const workDir = join(root, "work");
    const resultsDir = join(root, "results");
    const artifactsDir = join(root, "artifacts");
    const cacheDir = join(root, "cache");
    const tmpDir = join(root, "tmp");
    const binDir = join(root, "bin");
    const actionsDir = join(workDir, ".github", "workflows", "scripts", "ci", "actions");
    await mkdir(actionsDir, { recursive: true });
    await mkdir(binDir, { recursive: true });
    await writeFile(join(workDir, "package.json"), `${JSON.stringify({ packageManager: "pnpm@10.33.2" })}\n`, "utf8");
    await writeFile(
      join(binDir, "corepack"),
      [
        "#!/usr/bin/env bash",
        "set -euo pipefail",
        "printf 'corepack %s\\n' \"$*\"",
        "if [ \"${1:-}\" = pnpm ]; then",
        "  shift",
        "  printf 'shim-pnpm %s\\n' \"$*\"",
        "fi",
      ].join("\n"),
      "utf8",
    );
    await chmod(join(binDir, "corepack"), 0o755);
    process.env.PATH = `${binDir}${process.platform === "win32" ? ";" : ":"}/usr/bin:/bin`;
    process.env.OD_CI_USE_COREPACK_PNPM_SHIM = "1";

    await writeFile(
      join(actionsDir, "guard.sh"),
      [
        "#!/usr/bin/env bash",
        "set -euo pipefail",
        "pnpm --version",
      ].join("\n"),
      "utf8",
    );

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
          requires: ["node"],
          resultRequired: true,
          script: ".github/workflows/scripts/ci/actions/guard.sh",
          setup: "pnpm-workspace",
          timeoutSeconds: 5,
        },
      ],
    });

    const result = await executeAtoms({
      envelope: {
        artifactsDir,
        cacheDir,
        capabilitiesPath: join(root, "capabilities.json"),
        eventName: "workflow_dispatch",
        headSha: "abc123",
        manifestPath: join(root, "atoms.json"),
        mode: "default",
        providerId: "test",
        repoDir: workDir,
        resultsDir,
        runAttempt: "1",
        runId: "local",
        tmpDir,
        workDir,
      },
      manifest,
      selection: {
        provider: "test",
        schemaVersion: 1,
        selectedAtoms: ["guard"],
        unavailable: [],
      },
    });

    assert.equal(result.actions.find((action) => action.action === "guard")?.status, "success");
    assert.match(await readFile(join(resultsDir, "logs", "setup", "workspace", "stdout.log"), "utf8"), /shim-pnpm install/);
    assert.match(await readFile(join(resultsDir, "logs", "workspace", "guard", "stdout.log"), "utf8"), /shim-pnpm --version/);
  } finally {
    process.env.PATH = originalPath;
    if (originalShim == null) {
      delete process.env.OD_CI_USE_COREPACK_PNPM_SHIM;
    } else {
      process.env.OD_CI_USE_COREPACK_PNPM_SHIM = originalShim;
    }
    await rm(root, { force: true, recursive: true });
  }
});

test("executeAtoms prepares a writable copied work directory", async () => {
  const root = await mkdtemp(join(tmpdir(), "tools-ci-workdir-"));
  try {
    const repoDir = join(root, "repo");
    const workDir = join(root, "tool-root", "work", "local");
    const resultsDir = join(root, "results");
    const artifactsDir = join(root, "artifacts");
    const cacheDir = join(root, "cache");
    const tmpDir = join(root, "tmp");
    const actionsDir = join(repoDir, ".github", "workflows", "scripts", "ci", "actions");
    await mkdir(actionsDir, { recursive: true });
    await mkdir(join(repoDir, ".tmp", "runtime"), { recursive: true });
    await writeFile(join(repoDir, "source-marker.txt"), "copied-source\n", "utf8");
    await writeFile(join(repoDir, ".tmp", "runtime", "skip.txt"), "local-runtime\n", "utf8");
    await writeFile(
      join(actionsDir, "guard.sh"),
      [
        "#!/usr/bin/env bash",
        "set -euo pipefail",
        "pwd",
        "cat source-marker.txt",
      ].join("\n"),
      "utf8",
    );

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
          requires: ["node"],
          resultRequired: true,
          script: ".github/workflows/scripts/ci/actions/guard.sh",
          setup: "none",
          timeoutSeconds: 5,
        },
      ],
    });

    await executeAtoms({
      envelope: {
        artifactsDir,
        cacheDir,
        capabilitiesPath: join(root, "capabilities.json"),
        eventName: "workflow_dispatch",
        headSha: "abc123",
        manifestPath: join(root, "atoms.json"),
        mode: "default",
        providerId: "test",
        repoDir,
        resultsDir,
        runAttempt: "1",
        runId: "local",
        tmpDir,
        workDir,
      },
      manifest,
      selection: {
        provider: "test",
        schemaVersion: 1,
        selectedAtoms: ["guard"],
        unavailable: [],
      },
    });

    const stdout = await readFile(join(resultsDir, "logs", "workspace", "guard", "stdout.log"), "utf8");
    assert.match(stdout, new RegExp(`${workDir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
    assert.match(stdout, /copied-source/);
    await assert.rejects(readFile(join(workDir, ".tmp", "runtime", "skip.txt"), "utf8"));
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("executeAtoms converts workspace setup failure into selected atom failures", async () => {
  const root = await mkdtemp(join(tmpdir(), "tools-ci-setup-failure-"));
  const originalPath = process.env.PATH;
  try {
    const workDir = join(root, "work");
    const resultsDir = join(root, "results");
    const artifactsDir = join(root, "artifacts");
    const cacheDir = join(root, "cache");
    const tmpDir = join(root, "tmp");
    const binDir = join(root, "bin");
    const actionsDir = join(workDir, ".github", "workflows", "scripts", "ci", "actions");
    await mkdir(actionsDir, { recursive: true });
    await mkdir(binDir, { recursive: true });
    await writeFile(join(workDir, "package.json"), `${JSON.stringify({ packageManager: "pnpm@10.33.2" })}\n`, "utf8");
    await writeFile(
      join(binDir, "corepack"),
      [
        "#!/usr/bin/env bash",
        "set -euo pipefail",
        "printf 'corepack failed\\n' >&2",
        "exit 2",
      ].join("\n"),
      "utf8",
    );
    await chmod(join(binDir, "corepack"), 0o755);
    process.env.PATH = `${binDir}${process.platform === "win32" ? ";" : ":"}${originalPath ?? ""}`;

    await writeFile(
      join(actionsDir, "guard.sh"),
      [
        "#!/usr/bin/env bash",
        "set -euo pipefail",
        "printf 'should-not-run\\n'",
      ].join("\n"),
      "utf8",
    );
    await writeFile(
      join(actionsDir, "lint.sh"),
      [
        "#!/usr/bin/env bash",
        "set -euo pipefail",
        "printf 'lint-ran\\n'",
      ].join("\n"),
      "utf8",
    );

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
          requires: ["node"],
          resultRequired: true,
          script: ".github/workflows/scripts/ci/actions/guard.sh",
          setup: "pnpm-workspace",
          timeoutSeconds: 5,
        },
        {
          artifactProfile: "standard",
          cacheProfile: "none",
          call: "lint",
          domain: "workspace",
          key: "lint",
          name: "lint",
          requires: ["node"],
          resultRequired: true,
          script: ".github/workflows/scripts/ci/actions/lint.sh",
          setup: "none",
          timeoutSeconds: 5,
        },
      ],
    });

    const result = await executeAtoms({
      envelope: {
        artifactsDir,
        cacheDir,
        capabilitiesPath: join(root, "capabilities.json"),
        eventName: "workflow_dispatch",
        headSha: "abc123",
        manifestPath: join(root, "atoms.json"),
        mode: "default",
        providerId: "test",
        repoDir: workDir,
        resultsDir,
        runAttempt: "1",
        runId: "local",
        tmpDir,
        workDir,
      },
      manifest,
      selection: {
        provider: "test",
        schemaVersion: 1,
        selectedAtoms: ["guard", "lint"],
        unavailable: [],
      },
    });

    assert.equal(result.actions.find((action) => action.action === "guard")?.status, "failure");
    assert.equal(result.actions.find((action) => action.action === "guard")?.kind, "placeholder");
    assert.equal(result.actions.find((action) => action.action === "lint")?.status, "success");
    assert.match(await readFile(join(resultsDir, "logs", "setup", "workspace", "stderr.log"), "utf8"), /corepack failed/);
    assert.match(await readFile(join(resultsDir, "logs", "workspace", "guard", "stderr.log"), "utf8"), /workspace-setup-failed/);
    assert.match(await readFile(join(resultsDir, "logs", "workspace", "lint", "stdout.log"), "utf8"), /lint-ran/);
    assert.match(await readFile(join(resultsDir, "ci-results.json"), "utf8"), /"status": "failure"/);
  } finally {
    process.env.PATH = originalPath;
    await rm(root, { force: true, recursive: true });
  }
});
