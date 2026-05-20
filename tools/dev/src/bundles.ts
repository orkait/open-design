import {
  resolveBundleArtifact,
  type BundleArtifact,
  type BundleEntryKind,
} from "@open-design/bundle";
import { SIDECAR_ENV, type SidecarImplementationSnapshot } from "@open-design/sidecar-proto";

import type { ToolDevConfig } from "./config.js";

export type ToolsDevWebSource =
  | { type: "workspace" }
  | { artifact: BundleArtifact; type: "bundle" };

export type ToolsDevResolvedWebImplementation = {
  entryKind: BundleEntryKind;
  entryPath: string;
  implementation: SidecarImplementationSnapshot | null;
  source: ToolsDevWebSource;
};

export async function resolveWebImplementation(config: ToolDevConfig): Promise<ToolsDevResolvedWebImplementation> {
  if (config.bundlePath == null) {
    return {
      entryKind: "tsx",
      entryPath: config.apps.web.sidecarEntryPath,
      implementation: null,
      source: { type: "workspace" },
    };
  }

  const artifact = await resolveBundleArtifact(config.bundlePath);
  return {
    entryKind: artifact.descriptor.entry.kind,
    entryPath: artifact.entryPath,
    implementation: {
      bundlePath: artifact.bundlePath,
      descriptorPath: artifact.descriptorPath,
      entryPath: artifact.entryPath,
      source: "bundle",
    },
    source: {
      artifact,
      type: "bundle",
    },
  };
}

export function sidecarImplementationEnv(
  implementation: SidecarImplementationSnapshot | null,
): NodeJS.ProcessEnv {
  return implementation == null
    ? {}
    : { [SIDECAR_ENV.IMPLEMENTATION]: JSON.stringify(implementation) };
}
