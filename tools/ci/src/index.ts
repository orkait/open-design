import { cac } from "cac";

import { aggregateWorkflowResultFiles } from "./aggregate.js";
import { validateAtomManifest } from "./atoms.js";
import { selectAtomsFromFiles } from "./capabilities.js";
import { executeAtomsFromFiles } from "./execute.js";

type ValidateAtomsOptions = {
  json?: boolean;
  manifest?: string;
  repoRoot?: string;
};

type SelectAtomsOptions = {
  capabilities?: string;
  json?: boolean;
  manifest?: string;
  out?: string;
};

type ExecuteOptions = {
  manifest?: string;
  selection?: string;
};

type AggregateOptions = {
  githubResults?: string;
  json?: boolean;
  out?: string;
  ownedResults?: string;
};

function printJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function fail(error: unknown): never {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}

function notImplemented(command: string): never {
  throw new Error(`${command} is not implemented yet`);
}

async function validateAtoms(options: ValidateAtomsOptions): Promise<void> {
  const manifestPath = options.manifest ?? "tools/ci/atoms.json";
  const result = await validateAtomManifest(manifestPath, { repoRoot: options.repoRoot });
  if (options.json === true) {
    printJson({
      atomCount: result.atomCount,
      atomNames: result.atomNames,
      manifestPath,
      schemaVersion: result.manifest.schemaVersion,
    });
    return;
  }

  process.stdout.write(`tools-ci atoms: ${result.atomCount} valid (${result.atomNames.join(", ")})\n`);
}

async function selectAtoms(options: SelectAtomsOptions): Promise<void> {
  if (options.capabilities == null || options.capabilities.length === 0) {
    throw new Error("select-atoms requires --capabilities <path>");
  }
  const manifestPath = options.manifest ?? "tools/ci/atoms.json";
  const selection = await selectAtomsFromFiles({
    capabilitiesPath: options.capabilities,
    manifestPath,
    outPath: options.out,
  });
  if (options.json === true || options.out == null) {
    printJson(selection);
    return;
  }
  process.stdout.write(`tools-ci selection: ${selection.selectedAtoms.length} selected, ${selection.unavailable.length} unavailable\n`);
}

async function execute(options: ExecuteOptions): Promise<void> {
  if (options.selection == null || options.selection.length === 0) {
    throw new Error("execute requires --selection <path>");
  }
  const result = await executeAtomsFromFiles({
    manifestPath: options.manifest ?? "tools/ci/atoms.json",
    selectionPath: options.selection,
  });
  const failures = result.actions.filter((action) => action.status === "failure");
  process.stdout.write(`tools-ci execute: ${result.actions.length} atoms, ${failures.length} failures\n`);
  if (failures.length > 0) {
    process.exitCode = 1;
  }
}

async function aggregate(options: AggregateOptions): Promise<void> {
  if (options.ownedResults == null || options.ownedResults.length === 0) {
    throw new Error("aggregate requires --owned-results <path>");
  }
  if (options.githubResults == null || options.githubResults.length === 0) {
    throw new Error("aggregate requires --github-results <path>");
  }
  const result = await aggregateWorkflowResultFiles({
    githubResultsPath: options.githubResults,
    outPath: options.out,
    ownedResultsPath: options.ownedResults,
  });
  if (options.json === true || options.out == null) {
    printJson(result);
  } else {
    process.stdout.write(`tools-ci aggregate: ${result.passed ? "success" : "failure"} (${result.actions.length} atoms)\n`);
  }
  if (!result.passed) {
    process.exitCode = 1;
  }
}

process.on("uncaughtException", fail);
process.on("unhandledRejection", fail);

const cli = cac("tools-ci");

cli
  .command("validate-atoms", "Validate the CI atom manifest")
  .option("--manifest <path>", "Atom manifest path", { default: "tools/ci/atoms.json" })
  .option("--repo-root <path>", "Repository root used for script path validation")
  .option("--json", "Print JSON")
  .action((options: ValidateAtomsOptions) => {
    void validateAtoms(options);
  });

cli
  .command("validate-envelope", "Validate the normalized CI execution envelope")
  .action(() => notImplemented("validate-envelope"));

cli
  .command("select-atoms", "Select atoms from manifest and provider capabilities")
  .option("--manifest <path>", "Atom manifest path", { default: "tools/ci/atoms.json" })
  .option("--capabilities <path>", "Provider capability manifest path")
  .option("--out <path>", "Write selection JSON to a file")
  .option("--json", "Print JSON")
  .action((options: SelectAtomsOptions) => {
    void selectAtoms(options);
  });

cli
  .command("execute", "Execute selected CI atoms")
  .option("--manifest <path>", "Atom manifest path", { default: "tools/ci/atoms.json" })
  .option("--selection <path>", "Atom selection JSON path")
  .action((options: ExecuteOptions) => {
    void execute(options);
  });

cli
  .command("aggregate", "Aggregate CI atom results")
  .option("--owned-results <path>", "Owned ci-results.json path")
  .option("--github-results <path>", "GitHub-hosted ci-results.json path")
  .option("--out <path>", "Write aggregate JSON to a file")
  .option("--json", "Print JSON")
  .action((options: AggregateOptions) => {
    void aggregate(options);
  });

cli.help();
cli.parse();

export { loadAtomManifest, parseAtomManifest, validateAtomManifest } from "./atoms.js";
export { parseProviderCapabilities, selectAtoms, selectAtomsFromFiles } from "./capabilities.js";
export { executeAtoms, executeAtomsFromFiles } from "./execute.js";
export { aggregateWorkflowResultFiles, aggregateWorkflowResults, parseWorkflowResult } from "./aggregate.js";
export { readNormalizedEnvelope, resolveToolCiConfig, resolveToolCiRoots } from "./envelope.js";
export type { NormalizedEnvelope, ToolCiConfig, ToolCiProfile, ToolCiRoots, ToolCiSourceMode } from "./envelope.js";
