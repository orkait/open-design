import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { aggregateWorkflowResults, mergeWorkflowShardResultFiles, parseWorkflowResult } from "../src/aggregate.js";

test("aggregateWorkflowResults passes an atom when either provider has a real success", () => {
  const owned = parseWorkflowResult({
    schemaVersion: 1,
    provider: "owned",
    mode: "default",
    eventName: "workflow_dispatch",
    headSha: "abc",
    runId: "1",
    runAttempt: "1",
    actions: [
      { action: "nix", kind: "real", status: "failure" },
      { action: "guard", kind: "real", status: "success" },
    ],
  });
  const github = parseWorkflowResult({
    schemaVersion: 1,
    provider: "github",
    mode: "default",
    eventName: "workflow_dispatch",
    headSha: "abc",
    runId: "2",
    runAttempt: "1",
    actions: [
      { action: "nix", kind: "real", status: "success" },
      { action: "guard", kind: "real", status: "failure" },
    ],
  });

  const result = aggregateWorkflowResults(owned, github);
  assert.equal(result.passed, true);
  assert.deepEqual(result.actions.map((entry) => [entry.action, entry.passed]), [
    ["guard", true],
    ["nix", true],
  ]);
});

test("aggregateWorkflowResults fails when no provider has a real success", () => {
  const owned = parseWorkflowResult({
    schemaVersion: 1,
    provider: "owned",
    mode: "default",
    eventName: "workflow_dispatch",
    headSha: "abc",
    runId: "1",
    runAttempt: "1",
    actions: [
      { action: "nix", kind: "real", status: "failure" },
    ],
  });
  const github = parseWorkflowResult({
    schemaVersion: 1,
    provider: "github",
    mode: "default",
    eventName: "workflow_dispatch",
    headSha: "abc",
    runId: "2",
    runAttempt: "1",
    actions: [
      { action: "nix", kind: "real", status: "failure" },
    ],
  });

  const result = aggregateWorkflowResults(owned, github);
  assert.equal(result.passed, false);
  assert.equal(result.actions[0]?.reason, "real results but no success (owned:failure, github:failure)");
});

test("aggregateWorkflowResults handles the current nine-atom ci-gate shape", () => {
  const atomNames = ["nix", "guard", "i18n", "unit", "typecheck", "daemon", "web", "build", "browser"];
  const owned = parseWorkflowResult({
    schemaVersion: 1,
    provider: "owned",
    mode: "default",
    eventName: "workflow_dispatch",
    headSha: "abc",
    runId: "1",
    runAttempt: "1",
    actions: atomNames.map((action) => ({
      action,
      kind: "real",
      status: "success",
      steps: [{ name: `${action}-owned-step`, durationMs: 1, status: "success" }],
    })),
  });
  const github = parseWorkflowResult({
    schemaVersion: 1,
    provider: "github",
    mode: "default",
    eventName: "workflow_dispatch",
    headSha: "abc",
    runId: "2",
    runAttempt: "1",
    actions: atomNames.map((action) => ({
      action,
      kind: "real",
      status: "success",
      steps: [{ name: `${action}-github-step`, durationMs: 1, status: "success" }],
    })),
  });

  const result = aggregateWorkflowResults(owned, github);
  assert.equal(result.passed, true);
  assert.deepEqual(result.actions.map((entry) => entry.action), [...atomNames].sort());
  assert.equal(result.actions.find((entry) => entry.action === "nix")?.reason, "success via owned, github");
  assert.equal(result.actions.find((entry) => entry.action === "browser")?.reason, "success via owned, github");
});

test("mergeWorkflowShardResultFiles merges shard results in manifest order", async () => {
  const root = await mkdtemp(join(tmpdir(), "tools-ci-shards-"));
  try {
    const manifestPath = join(root, "atoms.json");
    const shardsRoot = join(root, "shards");
    const outPath = join(root, "ci-results.json");
    await mkdir(join(shardsRoot, "ci-owned-shard-a"), { recursive: true });
    await mkdir(join(shardsRoot, "ci-owned-shard-b"), { recursive: true });
    await writeFile(manifestPath, JSON.stringify({
      schemaVersion: 1,
      atoms: [
        {
          artifactProfile: "nix",
          cacheProfile: "nix",
          call: "nix flake check",
          domain: "nix",
          key: "flake",
          name: "nix",
          requires: ["nix"],
          resultRequired: true,
          script: ".github/workflows/scripts/ci/actions/nix.sh",
          setup: "nix-flake",
          timeoutSeconds: 1800,
        },
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
    }), "utf8");
    await writeFile(join(shardsRoot, "ci-owned-shard-a", "ci-results.json"), JSON.stringify({
      actions: [{ action: "guard", kind: "real", status: "success", domain: "workspace", key: "guard" }],
      eventName: "workflow_dispatch",
      headSha: "abc",
      mode: "default",
      provider: "owned",
      runAttempt: "1",
      runId: "100-a",
      schemaVersion: 1,
    }), "utf8");
    await writeFile(join(shardsRoot, "ci-owned-shard-b", "ci-results.json"), JSON.stringify({
      actions: [{ action: "nix", kind: "real", status: "success", domain: "nix", key: "flake" }],
      eventName: "workflow_dispatch",
      headSha: "abc",
      mode: "default",
      provider: "owned",
      runAttempt: "1",
      runId: "100-b",
      schemaVersion: 1,
    }), "utf8");

    const result = await mergeWorkflowShardResultFiles({
      eventName: "workflow_dispatch",
      headSha: "abc",
      manifestPath,
      mode: "default",
      outPath,
      provider: "owned",
      runAttempt: "1",
      runId: "100",
      shardsRoot,
    });

    assert.deepEqual(result.actions.map((action) => action.action), ["nix", "guard"]);
    assert.equal(result.provider, "owned");
    assert.equal(result.runId, "100");
    assert.match(await readFile(outPath, "utf8"), /"runId": "100"/);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});
