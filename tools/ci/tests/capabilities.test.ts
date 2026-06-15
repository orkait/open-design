import assert from "node:assert/strict";
import test from "node:test";

import { parseAtomManifest } from "../src/atoms.js";
import { parseProviderCapabilities, selectAtoms } from "../src/capabilities.js";

const manifest = parseAtomManifest({
  schemaVersion: 1,
  atoms: [
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
});

test("selectAtoms selects atoms whose requirements are available", () => {
  const selection = selectAtoms(manifest, parseProviderCapabilities({
    schemaVersion: 1,
    provider: "github",
    capabilities: ["node", "pnpm", "nix"],
  }));

  assert.deepEqual(selection.selectedAtoms, ["nix", "guard"]);
  assert.deepEqual(selection.unavailable, []);
});

test("selectAtoms marks missing requirements unavailable before shared execution", () => {
  const selection = selectAtoms(manifest, parseProviderCapabilities({
    schemaVersion: 1,
    provider: "owned",
    capabilities: ["node", "pnpm"],
    unavailable: [
      {
        capability: "nix",
        reason: "nix-capability-unavailable",
      },
    ],
  }));

  assert.deepEqual(selection.selectedAtoms, ["guard"]);
  assert.deepEqual(selection.unavailable, [
    {
      atom: "nix",
      missingCapabilities: ["nix"],
      reason: "nix-capability-unavailable",
      status: "unavailable",
    },
  ]);
});

test("parseProviderCapabilities rejects unknown capabilities", () => {
  assert.throws(
    () => parseProviderCapabilities({
      schemaVersion: 1,
      provider: "owned",
      capabilities: ["node", "docker"],
    }),
    /capabilities.1 must be one of/,
  );
});
