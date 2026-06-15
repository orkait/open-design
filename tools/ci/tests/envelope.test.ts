import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";

import { readNormalizedEnvelope, resolveToolCiConfig, resolveToolCiRoots } from "../src/envelope.js";

test("resolveToolCiRoots separates workflow evidence from tool operational state", () => {
  const workspaceRoot = "/repo";
  const roots = resolveToolCiRoots({
    profile: "ci-base",
    runId: "123",
    workspaceRoot,
  });

  assert.equal(roots.evidenceRoot, join(workspaceRoot, ".tmp", "workflows", "ci-gate"));
  assert.equal(roots.runRoot, join(workspaceRoot, ".tmp", "workflows", "ci-gate", "runs", "123"));
  assert.equal(roots.logsRoot, join(roots.runRoot, "logs"));
  assert.equal(roots.artifactsRoot, join(roots.runRoot, "artifacts"));
  assert.equal(roots.resultsRoot, roots.runRoot);
  assert.equal(roots.toolCiRoot, join(workspaceRoot, ".tmp", "tools-ci"));
  assert.equal(roots.cacheRoot, join(workspaceRoot, ".tmp", "tools-ci", "cache", "ci-base"));
  assert.equal(roots.workRoot, join(workspaceRoot, ".tmp", "tools-ci", "work", "123"));
  assert.equal(roots.tmpRoot, join(workspaceRoot, ".tmp", "tools-ci", "tmp", "123"));
});

test("resolveToolCiConfig reads GitHub and tools-ci env without requiring path env fan-out", () => {
  const config = resolveToolCiConfig({}, {
    GITHUB_EVENT_NAME: "workflow_dispatch",
    GITHUB_RUN_ATTEMPT: "2",
    GITHUB_RUN_ID: "456",
    GITHUB_SHA: "abc123",
    OD_CI_PROFILE: "ci-playwright",
    OD_CI_PROVIDER_ID: "owned",
    OD_CI_WORKSPACE_ROOT: "/repo",
  });

  assert.equal(config.eventName, "workflow_dispatch");
  assert.equal(config.headSha, "abc123");
  assert.equal(config.profile, "ci-playwright");
  assert.equal(config.providerId, "owned");
  assert.equal(config.runAttempt, "2");
  assert.equal(config.runId, "456");
  assert.equal(config.roots.cacheRoot, join("/repo", ".tmp", "tools-ci", "cache", "ci-playwright"));
});

test("readNormalizedEnvelope derives default directories from tools-ci roots", () => {
  const envelope = readNormalizedEnvelope({
    GITHUB_RUN_ID: "789",
    OD_CI_PROVIDER_ID: "local",
    OD_CI_WORKSPACE_ROOT: "/repo",
  });

  assert.equal(envelope.artifactsDir, join("/repo", ".tmp", "workflows", "ci-gate", "runs", "789", "artifacts"));
  assert.equal(envelope.cacheDir, join("/repo", ".tmp", "tools-ci", "cache", "local"));
  assert.equal(envelope.resultsDir, join("/repo", ".tmp", "workflows", "ci-gate", "runs", "789"));
  assert.equal(envelope.tmpDir, join("/repo", ".tmp", "tools-ci", "tmp", "789"));
  assert.equal(envelope.workDir, "/repo");
});

test("readNormalizedEnvelope can derive a writable copied work directory", () => {
  const envelope = readNormalizedEnvelope({
    GITHUB_RUN_ID: "789",
    OD_CI_PROVIDER_ID: "local",
    OD_CI_SOURCE_MODE: "copy",
    OD_CI_WORKSPACE_ROOT: "/repo",
  });

  assert.equal(envelope.repoDir, "/repo");
  assert.equal(envelope.workDir, join("/repo", ".tmp", "tools-ci", "work", "789"));
});

test("readNormalizedEnvelope preserves explicit legacy directory overrides", () => {
  const envelope = readNormalizedEnvelope({
    OD_CI_ARTIFACTS_DIR: "/legacy/artifacts",
    OD_CI_CACHE_DIR: "/legacy/cache",
    OD_CI_CAPABILITIES: "/legacy/capabilities.json",
    OD_CI_ATOM_MANIFEST: "/legacy/atoms.json",
    OD_CI_PROVIDER_ID: "test",
    OD_CI_REPO_DIR: "/legacy/repo",
    OD_CI_RESULTS_DIR: "/legacy/results",
    OD_CI_RUN_ATTEMPT: "3",
    OD_CI_RUN_ID: "legacy",
    OD_CI_TMP_DIR: "/legacy/tmp",
    OD_CI_WORK_DIR: "/legacy/work",
  });

  assert.equal(envelope.artifactsDir, "/legacy/artifacts");
  assert.equal(envelope.cacheDir, "/legacy/cache");
  assert.equal(envelope.capabilitiesPath, "/legacy/capabilities.json");
  assert.equal(envelope.manifestPath, "/legacy/atoms.json");
  assert.equal(envelope.repoDir, "/legacy/repo");
  assert.equal(envelope.resultsDir, "/legacy/results");
  assert.equal(envelope.tmpDir, "/legacy/tmp");
  assert.equal(envelope.workDir, "/legacy/work");
});
