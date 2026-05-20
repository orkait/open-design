import { cac } from "cac";

import { resolveToolDevConfig } from "./config.js";
import type { CliOptions } from "./runtime/options.js";
import { inspect } from "./runtime/inspect.js";
import {
  check,
  logs,
  restartTargets,
  runForeground,
  startTargets,
  status,
  stopTargets,
} from "./runtime/lifecycle.js";
import {
  output,
  printCheckResult,
  printLogs,
  printRestartResult,
  printStartResult,
  printStatusResult,
  printStopResult,
} from "./runtime/output.js";

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function exitWithError(error: unknown): never {
  process.stderr.write(`${formatError(error)}\n`);
  process.exit(1);
}

process.on("uncaughtException", exitWithError);
process.on("unhandledRejection", exitWithError);

const cli = cac("tools-dev");
const COMMAND_NAMES = new Set(["start", "run", "status", "stop", "restart", "logs", "inspect", "check"]);

function addSharedOptions(command: ReturnType<typeof cli.command>) {
  return command
    .option("--namespace <name>", "runtime namespace (default: default)")
    .option("--tools-dev-root <path>", "tools-dev runtime root")
    .option("--bundle-path <path>", "direct bundle root containing bundle.json")
    .option("--json", "print JSON");
}

function addPortOptions(command: ReturnType<typeof cli.command>) {
  return command
    .option("--daemon-port <port>", "force daemon port; conflict quick-fails")
    .option("--web-port <port>", "force web port; conflict quick-fails")
    .option("--prod", "use production build (requires pnpm --filter @open-design/web build first)");
}

addPortOptions(addSharedOptions(cli.command("start [app]", "Start daemon, web, desktop, or all when app is omitted"))).action(
  async (appName: string | undefined, options: CliOptions) => {
    printStartResult(await startTargets(resolveToolDevConfig(options), appName, options), options);
  },
);

addPortOptions(addSharedOptions(cli.command("run [app]", "Start apps and keep this command alive until interrupted"))).action(
  async (appName: string | undefined, options: CliOptions) => {
    await runForeground(resolveToolDevConfig(options), appName, options);
  },
);

addSharedOptions(cli.command("status [app]", "Show app status for daemon, web, desktop, or all")).action(
  async (appName: string | undefined, options: CliOptions) => {
    printStatusResult(await status(resolveToolDevConfig(options), appName), options, appName);
  },
);

addSharedOptions(cli.command("stop [app]", "Stop daemon, web, desktop, or all when app is omitted")).action(
  async (appName: string | undefined, options: CliOptions) => {
    printStopResult(await stopTargets(resolveToolDevConfig(options), appName), options);
  },
);

addPortOptions(addSharedOptions(cli.command("restart [app]", "Restart daemon, web, desktop, or all when app is omitted"))).action(
  async (appName: string | undefined, options: CliOptions) => {
    printRestartResult(await restartTargets(resolveToolDevConfig(options), appName, options), options);
  },
);

addSharedOptions(cli.command("logs [app]", "Show log tail for daemon, web, desktop, or all")).action(
  async (appName: string | undefined, options: CliOptions) => {
    printLogs(await logs(resolveToolDevConfig(options), appName), options);
  },
);

addSharedOptions(
  cli.command("inspect <app> [target]", "Inspect daemon/web status or desktop status/eval/screenshot/console/click"),
)
  .option("--expr <js>", "JavaScript expression for desktop eval")
  .option("--path <file>", "Output path for desktop screenshot")
  .option("--selector <css>", "CSS selector for desktop click")
  .option("--timeout <seconds>", "Desktop inspect timeout in seconds")
  .option("--update-action <action>", "Desktop update action: status|check|download|install")
  .action(async (appName: string, target: string | undefined, options: CliOptions) => {
    output(await inspect(resolveToolDevConfig(options), appName, target, options), options);
  });

addSharedOptions(cli.command("check [app]", "Print status and recent logs for quick diagnostics")).action(
  async (appName: string | undefined, options: CliOptions) => {
    printCheckResult(await check(resolveToolDevConfig(options), appName), options);
  },
);

cli.help();

const rawCliArgs = process.argv.slice(2);
const cliArgs = rawCliArgs[0] === "--" ? rawCliArgs.slice(1) : rawCliArgs;
process.argv.splice(2, process.argv.length - 2, ...cliArgs);

if (cliArgs.length === 0 || (cliArgs[0]?.startsWith("-") && cliArgs[0] !== "--help" && cliArgs[0] !== "-h")) {
  process.argv.splice(2, 0, "start");
}

const commandName = process.argv[2];
if (commandName != null && !commandName.startsWith("-") && !COMMAND_NAMES.has(commandName)) {
  exitWithError(`unsupported tools-dev command: ${commandName}`);
}

cli.parse();
