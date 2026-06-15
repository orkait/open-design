import assert from "node:assert/strict";
import test from "node:test";

import { aggregateWorkflowResults, parseWorkflowResult } from "../src/aggregate.js";

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
