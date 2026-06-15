#!/usr/bin/env node

// ../../node_modules/.pnpm/cac@6.7.14/node_modules/cac/dist/index.mjs
import { EventEmitter } from "events";
function toArr(any) {
  return any == null ? [] : Array.isArray(any) ? any : [any];
}
function toVal(out, key, val, opts) {
  var x, old = out[key], nxt = !!~opts.string.indexOf(key) ? val == null || val === true ? "" : String(val) : typeof val === "boolean" ? val : !!~opts.boolean.indexOf(key) ? val === "false" ? false : val === "true" || (out._.push((x = +val, x * 0 === 0) ? x : val), !!val) : (x = +val, x * 0 === 0) ? x : val;
  out[key] = old == null ? nxt : Array.isArray(old) ? old.concat(nxt) : [old, nxt];
}
function mri2(args, opts) {
  args = args || [];
  opts = opts || {};
  var k, arr, arg, name, val, out = { _: [] };
  var i = 0, j = 0, idx = 0, len = args.length;
  const alibi = opts.alias !== void 0;
  const strict = opts.unknown !== void 0;
  const defaults = opts.default !== void 0;
  opts.alias = opts.alias || {};
  opts.string = toArr(opts.string);
  opts.boolean = toArr(opts.boolean);
  if (alibi) {
    for (k in opts.alias) {
      arr = opts.alias[k] = toArr(opts.alias[k]);
      for (i = 0; i < arr.length; i++) {
        (opts.alias[arr[i]] = arr.concat(k)).splice(i, 1);
      }
    }
  }
  for (i = opts.boolean.length; i-- > 0; ) {
    arr = opts.alias[opts.boolean[i]] || [];
    for (j = arr.length; j-- > 0; ) opts.boolean.push(arr[j]);
  }
  for (i = opts.string.length; i-- > 0; ) {
    arr = opts.alias[opts.string[i]] || [];
    for (j = arr.length; j-- > 0; ) opts.string.push(arr[j]);
  }
  if (defaults) {
    for (k in opts.default) {
      name = typeof opts.default[k];
      arr = opts.alias[k] = opts.alias[k] || [];
      if (opts[name] !== void 0) {
        opts[name].push(k);
        for (i = 0; i < arr.length; i++) {
          opts[name].push(arr[i]);
        }
      }
    }
  }
  const keys = strict ? Object.keys(opts.alias) : [];
  for (i = 0; i < len; i++) {
    arg = args[i];
    if (arg === "--") {
      out._ = out._.concat(args.slice(++i));
      break;
    }
    for (j = 0; j < arg.length; j++) {
      if (arg.charCodeAt(j) !== 45) break;
    }
    if (j === 0) {
      out._.push(arg);
    } else if (arg.substring(j, j + 3) === "no-") {
      name = arg.substring(j + 3);
      if (strict && !~keys.indexOf(name)) {
        return opts.unknown(arg);
      }
      out[name] = false;
    } else {
      for (idx = j + 1; idx < arg.length; idx++) {
        if (arg.charCodeAt(idx) === 61) break;
      }
      name = arg.substring(j, idx);
      val = arg.substring(++idx) || (i + 1 === len || ("" + args[i + 1]).charCodeAt(0) === 45 || args[++i]);
      arr = j === 2 ? [name] : name;
      for (idx = 0; idx < arr.length; idx++) {
        name = arr[idx];
        if (strict && !~keys.indexOf(name)) return opts.unknown("-".repeat(j) + name);
        toVal(out, name, idx + 1 < arr.length || val, opts);
      }
    }
  }
  if (defaults) {
    for (k in opts.default) {
      if (out[k] === void 0) {
        out[k] = opts.default[k];
      }
    }
  }
  if (alibi) {
    for (k in out) {
      arr = opts.alias[k] || [];
      while (arr.length > 0) {
        out[arr.shift()] = out[k];
      }
    }
  }
  return out;
}
var removeBrackets = (v) => v.replace(/[<[].+/, "").trim();
var findAllBrackets = (v) => {
  const ANGLED_BRACKET_RE_GLOBAL = /<([^>]+)>/g;
  const SQUARE_BRACKET_RE_GLOBAL = /\[([^\]]+)\]/g;
  const res = [];
  const parse2 = (match) => {
    let variadic = false;
    let value = match[1];
    if (value.startsWith("...")) {
      value = value.slice(3);
      variadic = true;
    }
    return {
      required: match[0].startsWith("<"),
      value,
      variadic
    };
  };
  let angledMatch;
  while (angledMatch = ANGLED_BRACKET_RE_GLOBAL.exec(v)) {
    res.push(parse2(angledMatch));
  }
  let squareMatch;
  while (squareMatch = SQUARE_BRACKET_RE_GLOBAL.exec(v)) {
    res.push(parse2(squareMatch));
  }
  return res;
};
var getMriOptions = (options) => {
  const result = { alias: {}, boolean: [] };
  for (const [index, option] of options.entries()) {
    if (option.names.length > 1) {
      result.alias[option.names[0]] = option.names.slice(1);
    }
    if (option.isBoolean) {
      if (option.negated) {
        const hasStringTypeOption = options.some((o, i) => {
          return i !== index && o.names.some((name) => option.names.includes(name)) && typeof o.required === "boolean";
        });
        if (!hasStringTypeOption) {
          result.boolean.push(option.names[0]);
        }
      } else {
        result.boolean.push(option.names[0]);
      }
    }
  }
  return result;
};
var findLongest = (arr) => {
  return arr.sort((a, b) => {
    return a.length > b.length ? -1 : 1;
  })[0];
};
var padRight = (str, length) => {
  return str.length >= length ? str : `${str}${" ".repeat(length - str.length)}`;
};
var camelcase = (input) => {
  return input.replace(/([a-z])-([a-z])/g, (_, p1, p2) => {
    return p1 + p2.toUpperCase();
  });
};
var setDotProp = (obj, keys, val) => {
  let i = 0;
  let length = keys.length;
  let t = obj;
  let x;
  for (; i < length; ++i) {
    x = t[keys[i]];
    t = t[keys[i]] = i === length - 1 ? val : x != null ? x : !!~keys[i + 1].indexOf(".") || !(+keys[i + 1] > -1) ? {} : [];
  }
};
var setByType = (obj, transforms) => {
  for (const key of Object.keys(transforms)) {
    const transform = transforms[key];
    if (transform.shouldTransform) {
      obj[key] = Array.prototype.concat.call([], obj[key]);
      if (typeof transform.transformFunction === "function") {
        obj[key] = obj[key].map(transform.transformFunction);
      }
    }
  }
};
var getFileName = (input) => {
  const m = /([^\\\/]+)$/.exec(input);
  return m ? m[1] : "";
};
var camelcaseOptionName = (name) => {
  return name.split(".").map((v, i) => {
    return i === 0 ? camelcase(v) : v;
  }).join(".");
};
var CACError = class extends Error {
  constructor(message) {
    super(message);
    this.name = this.constructor.name;
    if (typeof Error.captureStackTrace === "function") {
      Error.captureStackTrace(this, this.constructor);
    } else {
      this.stack = new Error(message).stack;
    }
  }
};
var Option = class {
  constructor(rawName, description, config) {
    this.rawName = rawName;
    this.description = description;
    this.config = Object.assign({}, config);
    rawName = rawName.replace(/\.\*/g, "");
    this.negated = false;
    this.names = removeBrackets(rawName).split(",").map((v) => {
      let name = v.trim().replace(/^-{1,2}/, "");
      if (name.startsWith("no-")) {
        this.negated = true;
        name = name.replace(/^no-/, "");
      }
      return camelcaseOptionName(name);
    }).sort((a, b) => a.length > b.length ? 1 : -1);
    this.name = this.names[this.names.length - 1];
    if (this.negated && this.config.default == null) {
      this.config.default = true;
    }
    if (rawName.includes("<")) {
      this.required = true;
    } else if (rawName.includes("[")) {
      this.required = false;
    } else {
      this.isBoolean = true;
    }
  }
};
var processArgs = process.argv;
var platformInfo = `${process.platform}-${process.arch} node-${process.version}`;
var Command = class {
  constructor(rawName, description, config = {}, cli2) {
    this.rawName = rawName;
    this.description = description;
    this.config = config;
    this.cli = cli2;
    this.options = [];
    this.aliasNames = [];
    this.name = removeBrackets(rawName);
    this.args = findAllBrackets(rawName);
    this.examples = [];
  }
  usage(text) {
    this.usageText = text;
    return this;
  }
  allowUnknownOptions() {
    this.config.allowUnknownOptions = true;
    return this;
  }
  ignoreOptionDefaultValue() {
    this.config.ignoreOptionDefaultValue = true;
    return this;
  }
  version(version, customFlags = "-v, --version") {
    this.versionNumber = version;
    this.option(customFlags, "Display version number");
    return this;
  }
  example(example) {
    this.examples.push(example);
    return this;
  }
  option(rawName, description, config) {
    const option = new Option(rawName, description, config);
    this.options.push(option);
    return this;
  }
  alias(name) {
    this.aliasNames.push(name);
    return this;
  }
  action(callback) {
    this.commandAction = callback;
    return this;
  }
  isMatched(name) {
    return this.name === name || this.aliasNames.includes(name);
  }
  get isDefaultCommand() {
    return this.name === "" || this.aliasNames.includes("!");
  }
  get isGlobalCommand() {
    return this instanceof GlobalCommand;
  }
  hasOption(name) {
    name = name.split(".")[0];
    return this.options.find((option) => {
      return option.names.includes(name);
    });
  }
  outputHelp() {
    const { name, commands } = this.cli;
    const {
      versionNumber,
      options: globalOptions,
      helpCallback
    } = this.cli.globalCommand;
    let sections = [
      {
        body: `${name}${versionNumber ? `/${versionNumber}` : ""}`
      }
    ];
    sections.push({
      title: "Usage",
      body: `  $ ${name} ${this.usageText || this.rawName}`
    });
    const showCommands = (this.isGlobalCommand || this.isDefaultCommand) && commands.length > 0;
    if (showCommands) {
      const longestCommandName = findLongest(commands.map((command) => command.rawName));
      sections.push({
        title: "Commands",
        body: commands.map((command) => {
          return `  ${padRight(command.rawName, longestCommandName.length)}  ${command.description}`;
        }).join("\n")
      });
      sections.push({
        title: `For more info, run any command with the \`--help\` flag`,
        body: commands.map((command) => `  $ ${name}${command.name === "" ? "" : ` ${command.name}`} --help`).join("\n")
      });
    }
    let options = this.isGlobalCommand ? globalOptions : [...this.options, ...globalOptions || []];
    if (!this.isGlobalCommand && !this.isDefaultCommand) {
      options = options.filter((option) => option.name !== "version");
    }
    if (options.length > 0) {
      const longestOptionName = findLongest(options.map((option) => option.rawName));
      sections.push({
        title: "Options",
        body: options.map((option) => {
          return `  ${padRight(option.rawName, longestOptionName.length)}  ${option.description} ${option.config.default === void 0 ? "" : `(default: ${option.config.default})`}`;
        }).join("\n")
      });
    }
    if (this.examples.length > 0) {
      sections.push({
        title: "Examples",
        body: this.examples.map((example) => {
          if (typeof example === "function") {
            return example(name);
          }
          return example;
        }).join("\n")
      });
    }
    if (helpCallback) {
      sections = helpCallback(sections) || sections;
    }
    console.log(sections.map((section) => {
      return section.title ? `${section.title}:
${section.body}` : section.body;
    }).join("\n\n"));
  }
  outputVersion() {
    const { name } = this.cli;
    const { versionNumber } = this.cli.globalCommand;
    if (versionNumber) {
      console.log(`${name}/${versionNumber} ${platformInfo}`);
    }
  }
  checkRequiredArgs() {
    const minimalArgsCount = this.args.filter((arg) => arg.required).length;
    if (this.cli.args.length < minimalArgsCount) {
      throw new CACError(`missing required args for command \`${this.rawName}\``);
    }
  }
  checkUnknownOptions() {
    const { options, globalCommand } = this.cli;
    if (!this.config.allowUnknownOptions) {
      for (const name of Object.keys(options)) {
        if (name !== "--" && !this.hasOption(name) && !globalCommand.hasOption(name)) {
          throw new CACError(`Unknown option \`${name.length > 1 ? `--${name}` : `-${name}`}\``);
        }
      }
    }
  }
  checkOptionValue() {
    const { options: parsedOptions, globalCommand } = this.cli;
    const options = [...globalCommand.options, ...this.options];
    for (const option of options) {
      const value = parsedOptions[option.name.split(".")[0]];
      if (option.required) {
        const hasNegated = options.some((o) => o.negated && o.names.includes(option.name));
        if (value === true || value === false && !hasNegated) {
          throw new CACError(`option \`${option.rawName}\` value is missing`);
        }
      }
    }
  }
};
var GlobalCommand = class extends Command {
  constructor(cli2) {
    super("@@global@@", "", {}, cli2);
  }
};
var __assign = Object.assign;
var CAC = class extends EventEmitter {
  constructor(name = "") {
    super();
    this.name = name;
    this.commands = [];
    this.rawArgs = [];
    this.args = [];
    this.options = {};
    this.globalCommand = new GlobalCommand(this);
    this.globalCommand.usage("<command> [options]");
  }
  usage(text) {
    this.globalCommand.usage(text);
    return this;
  }
  command(rawName, description, config) {
    const command = new Command(rawName, description || "", config, this);
    command.globalCommand = this.globalCommand;
    this.commands.push(command);
    return command;
  }
  option(rawName, description, config) {
    this.globalCommand.option(rawName, description, config);
    return this;
  }
  help(callback) {
    this.globalCommand.option("-h, --help", "Display this message");
    this.globalCommand.helpCallback = callback;
    this.showHelpOnExit = true;
    return this;
  }
  version(version, customFlags = "-v, --version") {
    this.globalCommand.version(version, customFlags);
    this.showVersionOnExit = true;
    return this;
  }
  example(example) {
    this.globalCommand.example(example);
    return this;
  }
  outputHelp() {
    if (this.matchedCommand) {
      this.matchedCommand.outputHelp();
    } else {
      this.globalCommand.outputHelp();
    }
  }
  outputVersion() {
    this.globalCommand.outputVersion();
  }
  setParsedInfo({ args, options }, matchedCommand, matchedCommandName) {
    this.args = args;
    this.options = options;
    if (matchedCommand) {
      this.matchedCommand = matchedCommand;
    }
    if (matchedCommandName) {
      this.matchedCommandName = matchedCommandName;
    }
    return this;
  }
  unsetMatchedCommand() {
    this.matchedCommand = void 0;
    this.matchedCommandName = void 0;
  }
  parse(argv = processArgs, {
    run = true
  } = {}) {
    this.rawArgs = argv;
    if (!this.name) {
      this.name = argv[1] ? getFileName(argv[1]) : "cli";
    }
    let shouldParse = true;
    for (const command of this.commands) {
      const parsed = this.mri(argv.slice(2), command);
      const commandName = parsed.args[0];
      if (command.isMatched(commandName)) {
        shouldParse = false;
        const parsedInfo = __assign(__assign({}, parsed), {
          args: parsed.args.slice(1)
        });
        this.setParsedInfo(parsedInfo, command, commandName);
        this.emit(`command:${commandName}`, command);
      }
    }
    if (shouldParse) {
      for (const command of this.commands) {
        if (command.name === "") {
          shouldParse = false;
          const parsed = this.mri(argv.slice(2), command);
          this.setParsedInfo(parsed, command);
          this.emit(`command:!`, command);
        }
      }
    }
    if (shouldParse) {
      const parsed = this.mri(argv.slice(2));
      this.setParsedInfo(parsed);
    }
    if (this.options.help && this.showHelpOnExit) {
      this.outputHelp();
      run = false;
      this.unsetMatchedCommand();
    }
    if (this.options.version && this.showVersionOnExit && this.matchedCommandName == null) {
      this.outputVersion();
      run = false;
      this.unsetMatchedCommand();
    }
    const parsedArgv = { args: this.args, options: this.options };
    if (run) {
      this.runMatchedCommand();
    }
    if (!this.matchedCommand && this.args[0]) {
      this.emit("command:*");
    }
    return parsedArgv;
  }
  mri(argv, command) {
    const cliOptions = [
      ...this.globalCommand.options,
      ...command ? command.options : []
    ];
    const mriOptions = getMriOptions(cliOptions);
    let argsAfterDoubleDashes = [];
    const doubleDashesIndex = argv.indexOf("--");
    if (doubleDashesIndex > -1) {
      argsAfterDoubleDashes = argv.slice(doubleDashesIndex + 1);
      argv = argv.slice(0, doubleDashesIndex);
    }
    let parsed = mri2(argv, mriOptions);
    parsed = Object.keys(parsed).reduce((res, name) => {
      return __assign(__assign({}, res), {
        [camelcaseOptionName(name)]: parsed[name]
      });
    }, { _: [] });
    const args = parsed._;
    const options = {
      "--": argsAfterDoubleDashes
    };
    const ignoreDefault = command && command.config.ignoreOptionDefaultValue ? command.config.ignoreOptionDefaultValue : this.globalCommand.config.ignoreOptionDefaultValue;
    let transforms = /* @__PURE__ */ Object.create(null);
    for (const cliOption of cliOptions) {
      if (!ignoreDefault && cliOption.config.default !== void 0) {
        for (const name of cliOption.names) {
          options[name] = cliOption.config.default;
        }
      }
      if (Array.isArray(cliOption.config.type)) {
        if (transforms[cliOption.name] === void 0) {
          transforms[cliOption.name] = /* @__PURE__ */ Object.create(null);
          transforms[cliOption.name]["shouldTransform"] = true;
          transforms[cliOption.name]["transformFunction"] = cliOption.config.type[0];
        }
      }
    }
    for (const key of Object.keys(parsed)) {
      if (key !== "_") {
        const keys = key.split(".");
        setDotProp(options, keys, parsed[key]);
        setByType(options, transforms);
      }
    }
    return {
      args,
      options
    };
  }
  runMatchedCommand() {
    const { args, options, matchedCommand: command } = this;
    if (!command || !command.commandAction)
      return;
    command.checkUnknownOptions();
    command.checkOptionValue();
    command.checkRequiredArgs();
    const actionArgs = [];
    command.args.forEach((arg, index) => {
      if (arg.variadic) {
        actionArgs.push(args.slice(index));
      } else {
        actionArgs.push(args[index]);
      }
    });
    actionArgs.push(options);
    return command.commandAction.apply(this, actionArgs);
  }
};
var cac = (name = "") => new CAC(name);

// src/aggregate.ts
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function parseWorkflowAction(value) {
  if (!isRecord(value)) {
    throw new Error("workflow action must be an object");
  }
  const action = String(value.action ?? "");
  const kind = String(value.kind ?? "");
  const status = String(value.status ?? "");
  if (action.length === 0) {
    throw new Error("workflow action name is required");
  }
  if (kind !== "real" && kind !== "placeholder") {
    throw new Error(`unsupported workflow action kind: ${kind}`);
  }
  if (status !== "success" && status !== "failure" && status !== "not-run") {
    throw new Error(`unsupported workflow action status: ${status}`);
  }
  return {
    action,
    kind,
    status,
    steps: Array.isArray(value.steps) ? value.steps : void 0
  };
}
function parseWorkflowResult(value) {
  if (!isRecord(value)) {
    throw new Error("workflow result must be an object");
  }
  if (value.schemaVersion !== 1) {
    throw new Error(`unsupported workflow result schemaVersion: ${String(value.schemaVersion)}`);
  }
  if (!Array.isArray(value.actions)) {
    throw new Error("workflow result actions must be an array");
  }
  return {
    actions: value.actions.map(parseWorkflowAction),
    eventName: String(value.eventName ?? ""),
    headSha: String(value.headSha ?? ""),
    mode: String(value.mode ?? ""),
    provider: String(value.provider ?? ""),
    runAttempt: String(value.runAttempt ?? ""),
    runId: String(value.runId ?? ""),
    schemaVersion: 1
  };
}
function resultByAction(result) {
  const map = /* @__PURE__ */ new Map();
  for (const action of result.actions) {
    if (map.has(action.action)) {
      throw new Error(`${result.provider} result has duplicate action: ${action.action}`);
    }
    map.set(action.action, action);
  }
  return map;
}
function summarizeAction(action, runner, hosted) {
  const candidates = [runner, hosted].flatMap((result) => result.actions.filter((entry) => entry.action === action).map((entry) => ({ ...entry, provider: result.provider })));
  const realCandidates = candidates.filter((entry) => entry.kind === "real");
  const successes = realCandidates.filter((entry) => entry.status === "success");
  if (successes.length > 0) {
    return {
      action,
      passed: true,
      reason: `success via ${successes.map((entry) => entry.provider).join(", ")}`
    };
  }
  if (realCandidates.length > 0) {
    return {
      action,
      passed: false,
      reason: `real results but no success (${realCandidates.map((entry) => `${entry.provider}:${entry.status}`).join(", ")})`
    };
  }
  return {
    action,
    passed: false,
    reason: "no real result available"
  };
}
function aggregateWorkflowResults(runner, hosted) {
  const runnerActions = resultByAction(runner);
  const hostedActions = resultByAction(hosted);
  const actions = [.../* @__PURE__ */ new Set([...runnerActions.keys(), ...hostedActions.keys()])].sort();
  const actionResults = actions.map((action) => summarizeAction(action, runner, hosted));
  return {
    actions: actionResults,
    hosted: {
      provider: hosted.provider,
      runId: hosted.runId
    },
    passed: actionResults.every((action) => action.passed),
    runner: {
      provider: runner.provider,
      runId: runner.runId
    },
    schemaVersion: 1
  };
}
async function aggregateWorkflowResultFiles(options) {
  const runner = parseWorkflowResult(JSON.parse(await readFile(resolve(options.runnerResultsPath), "utf8")));
  const hosted = parseWorkflowResult(JSON.parse(await readFile(resolve(options.hostedResultsPath), "utf8")));
  const result = aggregateWorkflowResults(runner, hosted);
  if (options.outPath != null) {
    await writeFile(resolve(options.outPath), `${JSON.stringify(result, null, 2)}
`, "utf8");
  }
  return result;
}

// src/atoms.ts
import { access, readFile as readFile2 } from "node:fs/promises";
import { dirname, sep, resolve as resolve2 } from "node:path";
var atomDomains = ["workspace", "packages", "apps", "e2e", "nix"];
var atomCapabilities = ["node", "pnpm", "nix", "playwright", "chromium"];
var atomSetupProfiles = ["none", "pnpm-workspace", "nix-flake", "browser-e2e"];
var atomCacheProfiles = ["none", "node-pnpm", "nix", "browser"];
var atomArtifactProfiles = ["standard", "browser", "nix"];
var atomNamePattern = /^[a-z][a-z0-9-]*$/;
var atomKeyPattern = /^[a-z][a-z0-9-]*$/;
var relativeScriptPattern = /^[A-Za-z0-9._/-]+\.sh$/;
function isRecord2(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function formatPath(path2, field) {
  return `${path2}.${String(field)}`;
}
function assertString(value, path2) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${path2} must be a non-empty string`);
  }
  return value;
}
function assertBoolean(value, path2) {
  if (typeof value !== "boolean") {
    throw new Error(`${path2} must be a boolean`);
  }
  return value;
}
function assertPositiveInteger(value, path2) {
  if (!Number.isInteger(value) || typeof value !== "number" || value <= 0) {
    throw new Error(`${path2} must be a positive integer`);
  }
  return value;
}
function assertEnum(value, allowed, path2) {
  if (typeof value !== "string" || !allowed.includes(value)) {
    throw new Error(`${path2} must be one of: ${allowed.join(", ")}`);
  }
  return value;
}
function optionalString(value, path2) {
  if (value == null) return void 0;
  return assertString(value, path2);
}
function assertStringEnumArray(value, allowed, path2) {
  if (!Array.isArray(value)) {
    throw new Error(`${path2} must be an array`);
  }
  const items = value.map((item, index) => assertEnum(item, allowed, formatPath(path2, index)));
  return [...new Set(items)];
}
function atomNameFromIdentity(domain, key) {
  if (domain === "nix" && key === "flake") return "nix";
  if (domain === "packages" && key === "unit") return "unit";
  if (domain === "e2e" && key === "browser") return "browser";
  return key;
}
function deriveAtomIdentity(name) {
  switch (name) {
    case "guard":
      return { domain: "workspace", key: "guard", call: "pnpm guard" };
    case "i18n":
      return { domain: "workspace", key: "i18n", call: "pnpm i18n:check" };
    case "typecheck":
      return { domain: "workspace", key: "typecheck", call: "workspace type declarations and typecheck" };
    case "build":
      return { domain: "workspace", key: "build", call: "workspace build closure" };
    case "unit":
      return { domain: "packages", key: "unit", call: "workspace package and tool unit tests" };
    case "daemon":
      return { domain: "apps", key: "daemon", call: "daemon build and tests" };
    case "web":
      return { domain: "apps", key: "web", call: "web sidecar build and tests" };
    case "browser":
      return { domain: "e2e", key: "browser", call: "browser e2e and critical Playwright" };
    case "nix":
      return { domain: "nix", key: "flake", call: "nix flake check --print-build-logs --keep-going" };
    default:
      return { domain: "workspace", key: name, call: name };
  }
}
function parseAtomDefinition(value, path2) {
  if (!isRecord2(value)) {
    throw new Error(`${path2} must be an object`);
  }
  const explicitName = optionalString(value.name, formatPath(path2, "name"));
  const parsedDomain = value.domain == null ? void 0 : assertEnum(value.domain, atomDomains, formatPath(path2, "domain"));
  const parsedKey = optionalString(value.key, formatPath(path2, "key"));
  if (explicitName == null && (parsedDomain == null || parsedKey == null)) {
    throw new Error(`${path2} must define either name or domain/key`);
  }
  const legacyIdentity = explicitName == null ? void 0 : deriveAtomIdentity(explicitName);
  const domain = parsedDomain ?? legacyIdentity?.domain;
  const key = parsedKey ?? legacyIdentity?.key;
  if (domain == null || key == null) {
    throw new Error(`${path2} must define domain and key`);
  }
  if (!atomKeyPattern.test(key)) {
    throw new Error(`${formatPath(path2, "key")} must match ${atomKeyPattern}`);
  }
  const name = explicitName ?? atomNameFromIdentity(domain, key);
  if (!atomNamePattern.test(name)) {
    throw new Error(`${formatPath(path2, "name")} must match ${atomNamePattern}`);
  }
  if (parsedDomain != null && parsedKey != null && explicitName != null && atomNameFromIdentity(parsedDomain, parsedKey) !== explicitName) {
    throw new Error(`${path2}.name must match domain/key identity`);
  }
  const script = assertString(value.script, formatPath(path2, "script"));
  if (script.startsWith("/") || script.includes("..") || !relativeScriptPattern.test(script)) {
    throw new Error(`${formatPath(path2, "script")} must be a repo-relative shell script path`);
  }
  return {
    artifactProfile: assertEnum(value.artifactProfile, atomArtifactProfiles, formatPath(path2, "artifactProfile")),
    call: optionalString(value.call, formatPath(path2, "call")) ?? legacyIdentity?.call ?? name,
    cacheProfile: assertEnum(value.cacheProfile, atomCacheProfiles, formatPath(path2, "cacheProfile")),
    domain,
    key,
    name,
    requires: assertStringEnumArray(value.requires, atomCapabilities, formatPath(path2, "requires")),
    resultRequired: assertBoolean(value.resultRequired, formatPath(path2, "resultRequired")),
    script,
    setup: assertEnum(value.setup, atomSetupProfiles, formatPath(path2, "setup")),
    timeoutSeconds: assertPositiveInteger(value.timeoutSeconds, formatPath(path2, "timeoutSeconds"))
  };
}
function parseAtomManifest(value) {
  if (!isRecord2(value)) {
    throw new Error("atom manifest must be an object");
  }
  if (value.schemaVersion !== 1) {
    throw new Error("schemaVersion must be 1");
  }
  if (!Array.isArray(value.atoms) || value.atoms.length === 0) {
    throw new Error("atoms must be a non-empty array");
  }
  const atoms = value.atoms.map((atom, index) => parseAtomDefinition(atom, `atoms.${index}`));
  const seen = /* @__PURE__ */ new Set();
  const seenIdentity = /* @__PURE__ */ new Set();
  for (const atom of atoms) {
    if (seen.has(atom.name)) {
      throw new Error(`duplicate atom name: ${atom.name}`);
    }
    seen.add(atom.name);
    const identity = `${atom.domain}/${atom.key}`;
    if (seenIdentity.has(identity)) {
      throw new Error(`duplicate atom identity: ${identity}`);
    }
    seenIdentity.add(identity);
  }
  return {
    atoms,
    schemaVersion: 1
  };
}
async function assertScriptFiles(manifest, repoRoot) {
  for (const atom of manifest.atoms) {
    const scriptPath = resolve2(repoRoot, atom.script);
    await access(scriptPath).catch(() => {
      throw new Error(`atom script not found for ${atom.name}: ${scriptPath}`);
    });
  }
}
async function loadAtomManifest(manifestPath) {
  return parseAtomManifest(JSON.parse(await readFile2(manifestPath, "utf8")));
}
async function validateAtomManifest(manifestPath, options = {}) {
  const resolvedManifestPath = resolve2(manifestPath);
  const manifest = await loadAtomManifest(resolvedManifestPath);
  if (options.requireScriptFiles !== false) {
    const repoRoot = options.repoRoot == null ? resolveDefaultRepoRoot(resolvedManifestPath) : resolve2(options.repoRoot);
    await assertScriptFiles(manifest, repoRoot);
  }
  return {
    atomCount: manifest.atoms.length,
    atomNames: manifest.atoms.map((atom) => atom.name),
    manifest
  };
}
function resolveDefaultRepoRoot(manifestPath) {
  const manifestDir = dirname(manifestPath);
  if (manifestPath.endsWith(`${sep}.github${sep}workflows${sep}scripts${sep}ci${sep}atoms.json`)) {
    return resolve2(manifestDir, "../../../..");
  }
  if (manifestPath.endsWith(`${sep}tools${sep}ci${sep}atoms.json`)) {
    return resolve2(manifestDir, "../..");
  }
  return resolve2(manifestDir, "../../../..");
}

// src/capabilities.ts
import { readFile as readFile3, writeFile as writeFile2 } from "node:fs/promises";
import { resolve as resolve3 } from "node:path";
function isRecord3(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function assertString2(value, path2) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${path2} must be a non-empty string`);
  }
  return value;
}
function assertCapability(value, path2) {
  if (typeof value !== "string" || !atomCapabilities.includes(value)) {
    throw new Error(`${path2} must be one of: ${atomCapabilities.join(", ")}`);
  }
  return value;
}
function parseCapabilities(value, path2) {
  if (!Array.isArray(value)) {
    throw new Error(`${path2} must be an array`);
  }
  return [...new Set(value.map((item, index) => assertCapability(item, `${path2}.${index}`)))];
}
function parseUnavailableReason(value, path2) {
  if (!isRecord3(value)) {
    throw new Error(`${path2} must be an object`);
  }
  return {
    capability: assertCapability(value.capability, `${path2}.capability`),
    reason: assertString2(value.reason, `${path2}.reason`)
  };
}
function parseProviderCapabilities(value) {
  if (!isRecord3(value)) {
    throw new Error("provider capabilities must be an object");
  }
  if (value.schemaVersion !== 1) {
    throw new Error("schemaVersion must be 1");
  }
  const unavailable = value.unavailable == null ? void 0 : (() => {
    if (!Array.isArray(value.unavailable)) {
      throw new Error("unavailable must be an array");
    }
    return value.unavailable.map((item, index) => parseUnavailableReason(item, `unavailable.${index}`));
  })();
  return {
    capabilities: parseCapabilities(value.capabilities, "capabilities"),
    provider: assertString2(value.provider, "provider"),
    schemaVersion: 1,
    unavailable
  };
}
async function loadProviderCapabilities(capabilitiesPath) {
  return parseProviderCapabilities(JSON.parse(await readFile3(capabilitiesPath, "utf8")));
}
function reasonForMissingCapability(capability, providerCapabilities) {
  return providerCapabilities.unavailable?.find((entry) => entry.capability === capability)?.reason ?? `missing-capability:${capability}`;
}
function unavailableSelectionForAtom(atom, providerCapabilities) {
  const available = new Set(providerCapabilities.capabilities);
  const missingCapabilities = atom.requires.filter((capability) => !available.has(capability));
  if (missingCapabilities.length === 0) {
    return null;
  }
  return {
    atom: atom.name,
    missingCapabilities,
    reason: missingCapabilities.map((capability) => reasonForMissingCapability(capability, providerCapabilities)).join(";"),
    status: "unavailable"
  };
}
function selectAtoms(manifest, providerCapabilities) {
  const selectedAtoms = [];
  const unavailable = [];
  for (const atom of manifest.atoms) {
    const unavailableAtom = unavailableSelectionForAtom(atom, providerCapabilities);
    if (unavailableAtom == null) {
      selectedAtoms.push(atom.name);
    } else {
      unavailable.push(unavailableAtom);
    }
  }
  return {
    provider: providerCapabilities.provider,
    schemaVersion: 1,
    selectedAtoms,
    unavailable
  };
}
async function selectAtomsFromFiles(options) {
  const manifest = await loadAtomManifest(resolve3(options.manifestPath));
  const capabilities = await loadProviderCapabilities(resolve3(options.capabilitiesPath));
  const selection = selectAtoms(manifest, capabilities);
  if (options.outPath != null) {
    await writeFile2(resolve3(options.outPath), `${JSON.stringify(selection, null, 2)}
`, "utf8");
  }
  return selection;
}

// src/execute.ts
import { chmod, cp, mkdir, readFile as readFile4, rm, writeFile as writeFile3 } from "node:fs/promises";
import { createWriteStream, readFileSync } from "node:fs";
import { dirname as dirname2, isAbsolute, parse, relative, resolve as resolve5 } from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";

// src/envelope.ts
import path, { resolve as resolve4 } from "node:path";
import { fileURLToPath } from "node:url";
var __dirname = path.dirname(fileURLToPath(import.meta.url));
var WORKSPACE_ROOT = resolve4(__dirname, "../../..");
var envKeys = {
  artifactsDir: "OD_CI_ARTIFACTS_DIR",
  cacheDir: "OD_CI_CACHE_DIR",
  capabilitiesPath: "OD_CI_CAPABILITIES",
  manifestPath: "OD_CI_ATOM_MANIFEST",
  providerId: "OD_CI_PROVIDER_ID",
  repoDir: "OD_CI_REPO_DIR",
  resultsDir: "OD_CI_RESULTS_DIR",
  runAttempt: "OD_CI_RUN_ATTEMPT",
  runId: "OD_CI_RUN_ID",
  tmpDir: "OD_CI_TMP_DIR",
  workDir: "OD_CI_WORK_DIR"
};
function nonEmpty(value) {
  return value == null || value.length === 0 ? void 0 : value;
}
function resolveToolCiProfile(value) {
  if (value === "ci-base" || value === "ci-playwright" || value === "nix-capable" || value === "hosted" || value === "runner" || value === "local") {
    return value;
  }
  if (value == null || value.length === 0) return "local";
  throw new Error(`unsupported tools-ci profile: ${value}`);
}
function resolveToolCiSourceMode(value) {
  if (value === "direct" || value === "copy") {
    return value;
  }
  if (value == null || value.length === 0) return "direct";
  throw new Error(`unsupported tools-ci source mode: ${value}`);
}
function resolveToolCiRoots(options) {
  const workspaceRoot = resolve4(options.workspaceRoot ?? WORKSPACE_ROOT);
  const profile = options.profile ?? "local";
  const evidenceRoot = resolve4(options.evidenceRoot ?? path.join(workspaceRoot, ".tmp", "workflows", "ci-gate"));
  const toolCiRoot = resolve4(options.toolCiRoot ?? path.join(workspaceRoot, ".tmp", "tools-ci"));
  const runRoot = path.join(evidenceRoot, "runs", options.runId);
  return {
    artifactsRoot: path.join(runRoot, "artifacts"),
    cacheRoot: path.join(toolCiRoot, "cache", profile),
    evidenceRoot,
    logsRoot: path.join(runRoot, "logs"),
    resultsRoot: runRoot,
    runRoot,
    tmpRoot: path.join(toolCiRoot, "tmp", options.runId),
    toolCiRoot,
    workRoot: path.join(toolCiRoot, "work", options.runId)
  };
}
function resolveToolCiConfig(options = {}, env = process.env) {
  const workspaceRoot = resolve4(options.workspaceRoot ?? nonEmpty(env.OD_CI_WORKSPACE_ROOT) ?? WORKSPACE_ROOT);
  const runId = options.runId ?? nonEmpty(env.OD_CI_RUN_ID) ?? nonEmpty(env.GITHUB_RUN_ID) ?? "local";
  const runAttempt = options.runAttempt ?? nonEmpty(env.OD_CI_RUN_ATTEMPT) ?? nonEmpty(env.GITHUB_RUN_ATTEMPT) ?? "1";
  const profile = options.profile ?? resolveToolCiProfile(nonEmpty(env.OD_CI_PROFILE));
  const sourceMode = options.sourceMode ?? resolveToolCiSourceMode(nonEmpty(env.OD_CI_SOURCE_MODE));
  const providerId = options.providerId ?? nonEmpty(env.OD_CI_PROVIDER_ID) ?? "local";
  const mode = options.mode ?? nonEmpty(env.OD_CI_MODE) ?? "default";
  const roots = resolveToolCiRoots({
    evidenceRoot: options.evidenceRoot ?? nonEmpty(env.OD_CI_EVIDENCE_ROOT),
    profile,
    runId,
    toolCiRoot: options.toolCiRoot ?? nonEmpty(env.OD_CI_TOOL_ROOT),
    workspaceRoot
  });
  return {
    capabilitiesPath: resolve4(options.capabilitiesPath ?? nonEmpty(env.OD_CI_CAPABILITIES) ?? path.join(workspaceRoot, "tools", "ci", "fixtures", "capabilities.hosted.json")),
    eventName: options.eventName ?? nonEmpty(env.OD_CI_EVENT_NAME) ?? nonEmpty(env.GITHUB_EVENT_NAME) ?? "unknown",
    headSha: options.headSha ?? nonEmpty(env.OD_CI_HEAD_SHA) ?? nonEmpty(env.CI_GATE_HEAD_SHA) ?? nonEmpty(env.GITHUB_SHA) ?? "unknown",
    manifestPath: resolve4(options.manifestPath ?? nonEmpty(env.OD_CI_ATOM_MANIFEST) ?? path.join(workspaceRoot, "tools", "ci", "atoms.json")),
    mode,
    profile,
    providerId,
    roots,
    runAttempt,
    runId,
    sourceMode,
    workspaceRoot
  };
}
function readNormalizedEnvelope(env = process.env) {
  const config = resolveToolCiConfig({}, env);
  const result = {};
  for (const [field, key] of Object.entries(envKeys)) {
    const value = env[key] ?? (() => {
      switch (field) {
        case "artifactsDir":
          return config.roots.artifactsRoot;
        case "cacheDir":
          return config.roots.cacheRoot;
        case "capabilitiesPath":
          return config.capabilitiesPath;
        case "manifestPath":
          return config.manifestPath;
        case "providerId":
          return config.providerId;
        case "repoDir":
          return config.workspaceRoot;
        case "resultsDir":
          return config.roots.resultsRoot;
        case "runAttempt":
          return config.runAttempt;
        case "runId":
          return config.runId;
        case "tmpDir":
          return config.roots.tmpRoot;
        case "workDir":
          return config.sourceMode === "copy" ? config.roots.workRoot : config.workspaceRoot;
        default:
          return void 0;
      }
    })();
    result[field] = value;
  }
  result.eventName = config.eventName;
  result.headSha = config.headSha;
  result.mode = config.mode;
  return result;
}

// src/execute.ts
function parseJsonLines(path2) {
  try {
    const text = readFileSyncUtf8(path2);
    return text.split("\n").filter((line) => line.trim().length > 0).map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}
function readFileSyncUtf8(path2) {
  return readFileSync(path2, "utf8");
}
function atomByName(manifest) {
  return new Map(manifest.atoms.map((atom) => [atom.name, atom]));
}
function executionEnv(envelope, extra = {}) {
  return {
    ...process.env,
    CI: process.env.CI ?? "true",
    COREPACK_ENABLE_DOWNLOAD_PROMPT: "0",
    COREPACK_HOME: resolve5(envelope.cacheDir, "corepack"),
    ELECTRON_SKIP_BINARY_DOWNLOAD: process.env.ELECTRON_SKIP_BINARY_DOWNLOAD ?? "1",
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: process.env.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD ?? "1",
    npm_config_store_dir: resolve5(envelope.cacheDir, "pnpm-store"),
    npm_config_fetch_retries: "6",
    npm_config_fetch_retry_maxtimeout: "120000",
    npm_config_fetch_retry_mintimeout: "20000",
    npm_config_network_timeout: "180000",
    OD_CI_CACHE_DIR: envelope.cacheDir,
    OD_CI_TMP_DIR: envelope.tmpDir,
    ...process.env.OD_CI_USE_COREPACK_PNPM_SHIM === "1" ? { PATH: `${resolve5(envelope.tmpDir, "bin")}:${process.env.PATH ?? ""}` } : {},
    ...extra
  };
}
async function ensureExecutionRoots(envelope) {
  await mkdir(envelope.resultsDir, { recursive: true });
  await mkdir(envelope.artifactsDir, { recursive: true });
  await mkdir(envelope.cacheDir, { recursive: true });
  await mkdir(resolve5(envelope.cacheDir, "corepack"), { recursive: true });
  await mkdir(resolve5(envelope.cacheDir, "pnpm-store"), { recursive: true });
  await mkdir(envelope.tmpDir, { recursive: true });
  if (process.env.OD_CI_USE_COREPACK_PNPM_SHIM === "1") {
    const shimPath = resolve5(envelope.tmpDir, "bin", "pnpm");
    await mkdir(dirname2(shimPath), { recursive: true });
    await writeFile3(
      shimPath,
      ["#!/usr/bin/env bash", "set -Eeuo pipefail", 'exec corepack pnpm "$@"', ""].join("\n"),
      "utf8"
    );
    await chmod(shimPath, 493);
  }
}
function isSamePath(left, right) {
  return resolve5(left) === resolve5(right);
}
function containsPath(parent, child) {
  const relativePath = relative(resolve5(parent), resolve5(child));
  return relativePath.length === 0 || !relativePath.startsWith("..") && !relativePath.startsWith("/");
}
function shouldCopySourceEntry(options) {
  const { copyNodeModules, sourcePath, sourceRoot, workDir } = options;
  const relativeSourcePath = relative(sourceRoot, sourcePath).split("\\").join("/");
  if (relativeSourcePath.length === 0) return true;
  if (relativeSourcePath === ".git" || relativeSourcePath.startsWith(".git/")) return false;
  if (relativeSourcePath === ".tmp" || relativeSourcePath.startsWith(".tmp/")) return false;
  if (!copyNodeModules && (relativeSourcePath === "node_modules" || relativeSourcePath.startsWith("node_modules/"))) {
    return false;
  }
  return !containsPath(sourcePath, workDir);
}
async function prepareWritableWorkDir(envelope) {
  if (isSamePath(envelope.repoDir, envelope.workDir)) return;
  const workDir = resolve5(envelope.workDir);
  if (workDir === parse(workDir).root) {
    throw new Error(`refusing to prepare unsafe tools-ci work directory: ${workDir}`);
  }
  if (containsPath(workDir, envelope.repoDir)) {
    throw new Error(`refusing to prepare tools-ci work directory that contains repo source: ${workDir}`);
  }
  const sourceRoot = resolve5(envelope.repoDir);
  const copyNodeModules = process.env.OD_CI_COPY_NODE_MODULES === "1";
  await rm(workDir, { force: true, recursive: true });
  await mkdir(dirname2(workDir), { recursive: true });
  await cp(sourceRoot, workDir, {
    force: true,
    recursive: true,
    verbatimSymlinks: true,
    filter: (sourcePath) => shouldCopySourceEntry({ copyNodeModules, sourcePath, sourceRoot, workDir })
  });
}
function atomIdentity(atom) {
  return { action: atom.name, domain: atom.domain, key: atom.key };
}
async function runProcess(options) {
  const child = spawn(options.command, options.args, {
    cwd: options.cwd,
    env: options.env,
    stdio: ["ignore", "pipe", "pipe"]
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  let timedOut = false;
  const timeout = options.timeoutSeconds == null ? void 0 : setTimeout(() => {
    timedOut = true;
    child.kill("SIGTERM");
  }, options.timeoutSeconds * 1e3);
  const exitCode = await new Promise((resolvePromise) => {
    child.on("error", (error) => {
      stderr += `${error instanceof Error ? error.message : String(error)}
`;
      resolvePromise(1);
    });
    child.on("close", (code) => resolvePromise(code ?? 1));
  });
  if (timeout != null) clearTimeout(timeout);
  return { exitCode, stderr, stdout, timedOut };
}
function needsWorkspaceSetup(atom) {
  return atom.setup === "pnpm-workspace" || atom.setup === "browser-e2e";
}
function workspaceSetupTimeoutSeconds() {
  const value = process.env.OD_CI_SETUP_TIMEOUT_SECONDS;
  if (value == null || value.length === 0) return 1800;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`OD_CI_SETUP_TIMEOUT_SECONDS must be a positive integer: ${value}`);
  }
  return parsed;
}
async function runWorkspaceSetup(envelope, atoms) {
  if (!atoms.some(needsWorkspaceSetup)) return null;
  const logDir = resolve5(envelope.resultsDir, "logs", "setup", "workspace");
  const stdoutPath = resolve5(logDir, "stdout.log");
  const stderrPath = resolve5(logDir, "stderr.log");
  const stepsPath = resolve5(logDir, "steps.jsonl");
  const metadataPath = resolve5(logDir, "metadata.json");
  await mkdir(logDir, { recursive: true });
  await writeFile3(stepsPath, "", "utf8");
  const startedAt = Date.now();
  const env = executionEnv(envelope);
  let exitCode = 0;
  let stdout = "";
  let stderr = "";
  let reason;
  let timedOut = false;
  const timeoutSeconds = workspaceSetupTimeoutSeconds();
  try {
    const packageJson = JSON.parse(await readFile4(resolve5(envelope.workDir, "package.json"), "utf8"));
    if (typeof packageJson.packageManager !== "string" || packageJson.packageManager.length === 0) {
      throw new Error("package.json must define packageManager for tools-ci workspace setup");
    }
    const prepare = await runProcess({
      args: ["prepare", packageJson.packageManager, "--activate"],
      command: "corepack",
      cwd: envelope.workDir,
      env,
      timeoutSeconds
    });
    exitCode = prepare.exitCode;
    stdout = prepare.stdout;
    stderr = prepare.stderr;
    timedOut = prepare.timedOut;
    if (exitCode === 0 && !timedOut) {
      const install = await runProcess({
        args: ["install", "--frozen-lockfile", "--prefer-offline", "--network-concurrency=8"],
        command: "pnpm",
        cwd: envelope.workDir,
        env,
        timeoutSeconds
      });
      exitCode = install.exitCode;
      stdout += install.stdout;
      stderr += install.stderr;
      timedOut = install.timedOut;
    }
    if (timedOut) {
      reason = `workspace setup command timed out after ${timeoutSeconds}s`;
      stderr += `${reason}
`;
    }
  } catch (error) {
    exitCode = 1;
    reason = error instanceof Error ? error.message : String(error);
    stderr += `${reason}
`;
  }
  const finishedAt = Date.now();
  await writeFile3(stdoutPath, stdout, "utf8");
  await writeFile3(stderrPath, stderr, "utf8");
  await writeAtomMetadata({
    call: "corepack prepare + pnpm install",
    envelope,
    exitCode,
    finishedAt,
    identity: { action: "setup", domain: "setup", key: "workspace" },
    metadataPath,
    startedAt,
    status: exitCode === 0 ? "success" : "failure",
    timedOut
  });
  return {
    exitCode,
    metadataPath: relativeResultPath(envelope, metadataPath),
    reason: reason ?? (exitCode === 0 ? void 0 : `tools-ci workspace setup failed; see ${relativeResultPath(envelope, metadataPath)}`),
    status: exitCode === 0 ? "success" : "failure",
    timedOut
  };
}
function atomLogDir(envelope, identity) {
  return resolve5(envelope.resultsDir, "logs", identity.domain, identity.key);
}
function atomArtifactDir(envelope, identity) {
  return resolve5(envelope.artifactsDir, identity.domain, identity.key);
}
function relativeResultPath(envelope, path2) {
  return relative(envelope.resultsDir, path2).split("\\").join("/");
}
async function writeAtomMetadata(options) {
  await writeFile3(
    options.metadataPath,
    `${JSON.stringify({
      domain: options.identity.domain,
      key: options.identity.key,
      call: options.call,
      status: options.status,
      startedAt: options.startedAt,
      finishedAt: options.finishedAt,
      durationMs: Math.max(0, options.finishedAt - options.startedAt),
      exitCode: options.exitCode,
      provider: options.envelope.providerId,
      runId: options.envelope.runId,
      runAttempt: options.envelope.runAttempt,
      ...options.timedOut == null ? {} : { timedOut: options.timedOut }
    }, null, 2)}
`,
    "utf8"
  );
}
async function writeNotRunAtom(atom, envelope, unavailable) {
  const identity = atomIdentity(atom);
  const logDir = atomLogDir(envelope, identity);
  const artifactDir = atomArtifactDir(envelope, identity);
  const stdoutPath = resolve5(logDir, "stdout.log");
  const stderrPath = resolve5(logDir, "stderr.log");
  const stepsPath = resolve5(logDir, "steps.jsonl");
  const metadataPath = resolve5(logDir, "metadata.json");
  const now = Date.now();
  await mkdir(logDir, { recursive: true });
  await mkdir(artifactDir, { recursive: true });
  await writeFile3(stdoutPath, "", "utf8");
  await writeFile3(stderrPath, `${unavailable.reason}
`, "utf8");
  await writeFile3(stepsPath, "", "utf8");
  await writeAtomMetadata({
    call: atom.call,
    envelope,
    exitCode: 0,
    finishedAt: now,
    identity,
    metadataPath,
    startedAt: now,
    status: "not-run"
  });
  return {
    action: identity.action,
    artifactDir,
    domain: identity.domain,
    exitCode: 0,
    kind: "placeholder",
    key: identity.key,
    metadataPath: relativeResultPath(envelope, metadataPath),
    missingCapabilities: unavailable.missingCapabilities,
    reason: unavailable.reason,
    status: "not-run",
    steps: [],
    stderr: stderrPath,
    stdout: stdoutPath
  };
}
async function writeSetupFailureAtom(atom, envelope, setupResult) {
  const identity = atomIdentity(atom);
  const logDir = atomLogDir(envelope, identity);
  const artifactDir = atomArtifactDir(envelope, identity);
  const stdoutPath = resolve5(logDir, "stdout.log");
  const stderrPath = resolve5(logDir, "stderr.log");
  const stepsPath = resolve5(logDir, "steps.jsonl");
  const metadataPath = resolve5(logDir, "metadata.json");
  const now = Date.now();
  const reason = `workspace-setup-failed; see ${setupResult.metadataPath}${setupResult.reason == null ? "" : `: ${setupResult.reason}`}`;
  await mkdir(logDir, { recursive: true });
  await mkdir(artifactDir, { recursive: true });
  await writeFile3(stdoutPath, "", "utf8");
  await writeFile3(stderrPath, `${reason}
`, "utf8");
  await writeFile3(stepsPath, "", "utf8");
  await writeAtomMetadata({
    call: atom.call,
    envelope,
    exitCode: setupResult.exitCode,
    finishedAt: now,
    identity,
    metadataPath,
    startedAt: now,
    status: "failure"
  });
  return {
    action: identity.action,
    artifactDir,
    domain: identity.domain,
    exitCode: setupResult.exitCode,
    kind: "placeholder",
    key: identity.key,
    metadataPath: relativeResultPath(envelope, metadataPath),
    reason,
    status: "failure",
    steps: [],
    stderr: stderrPath,
    stdout: stdoutPath
  };
}
async function runAtom(atom, envelope) {
  const identity = atomIdentity(atom);
  const logDir = atomLogDir(envelope, identity);
  const artifactDir = atomArtifactDir(envelope, identity);
  const stdoutPath = resolve5(logDir, "stdout.log");
  const stderrPath = resolve5(logDir, "stderr.log");
  const metadataPath = resolve5(logDir, "metadata.json");
  const stepsPath = resolve5(logDir, "steps.jsonl");
  await mkdir(logDir, { recursive: true });
  await mkdir(artifactDir, { recursive: true });
  await writeFile3(stepsPath, "", "utf8");
  const stdoutStream = createWriteStream(stdoutPath, { flags: "w" });
  const stderrStream = createWriteStream(stderrPath, { flags: "w" });
  const startedAt = Date.now();
  const scriptPath = resolve5(envelope.workDir, atom.script);
  const child = spawn("bash", [scriptPath], {
    cwd: envelope.workDir,
    env: {
      ...executionEnv(envelope),
      CI_GATE_ACTION_TIMINGS_PATH: stepsPath,
      CI_GATE_STEP_TIMEOUT_SECONDS: String(atom.timeoutSeconds),
      OD_CI_ARTIFACT_DIR: artifactDir
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
    stdoutStream.write(chunk);
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
    stderrStream.write(chunk);
  });
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    child.kill("SIGTERM");
  }, atom.timeoutSeconds * 1e3);
  const exitCode = await new Promise((resolvePromise) => {
    child.on("close", (code) => resolvePromise(code ?? 1));
  });
  clearTimeout(timeout);
  const finishedAt = Date.now();
  stdoutStream.end();
  stderrStream.end();
  await Promise.all([once(stdoutStream, "finish"), once(stderrStream, "finish")]);
  await writeAtomMetadata({
    call: atom.call,
    envelope,
    exitCode,
    finishedAt,
    identity,
    metadataPath,
    startedAt,
    status: exitCode === 0 ? "success" : "failure",
    timedOut
  });
  return {
    action: identity.action,
    artifactDir,
    domain: identity.domain,
    exitCode,
    kind: "real",
    key: identity.key,
    metadataPath: relativeResultPath(envelope, metadataPath),
    status: exitCode === 0 ? "success" : "failure",
    steps: parseJsonLines(stepsPath),
    stderr: stderrPath,
    stdout: stdoutPath
  };
}
async function writeActionsJsonl(envelope, actions) {
  await writeFile3(
    resolve5(envelope.resultsDir, "actions.jsonl"),
    actions.map((action) => JSON.stringify(serializeAction(envelope, action))).join("\n") + "\n",
    "utf8"
  );
}
function relativeActionPath(envelope, path2) {
  if (path2 == null) return void 0;
  return isAbsolute(path2) ? relativeResultPath(envelope, path2) : path2;
}
function serializeAction(envelope, action) {
  return {
    ...action,
    artifactDir: relativeActionPath(envelope, action.artifactDir),
    stderr: relativeActionPath(envelope, action.stderr),
    stdout: relativeActionPath(envelope, action.stdout)
  };
}
async function executeAtoms(options) {
  const envelope = options.envelope ?? readNormalizedEnvelope();
  await ensureExecutionRoots(envelope);
  await prepareWritableWorkDir(envelope);
  const atomsByName = atomByName(options.manifest);
  const selectedAtoms = options.selection.selectedAtoms.map((atomName) => {
    const atom = atomsByName.get(atomName);
    if (atom == null) {
      throw new Error(`selected atom not found in manifest: ${atomName}`);
    }
    return atom;
  });
  const setupResult = await runWorkspaceSetup(envelope, selectedAtoms);
  const actions = [];
  for (const entry of options.selection.unavailable) {
    const atom = atomsByName.get(entry.atom);
    if (atom == null) {
      throw new Error(`unavailable atom not found in manifest: ${entry.atom}`);
    }
    actions.push(await writeNotRunAtom(atom, envelope, entry));
  }
  for (const atom of selectedAtoms) {
    if (setupResult?.status === "failure" && needsWorkspaceSetup(atom)) {
      actions.push(await writeSetupFailureAtom(atom, envelope, setupResult));
    } else {
      actions.push(await runAtom(atom, envelope));
    }
  }
  const result = {
    actions: actions.map((action) => serializeAction(envelope, action)),
    eventName: envelope.eventName,
    headSha: envelope.headSha,
    mode: envelope.mode,
    provider: envelope.providerId,
    runAttempt: envelope.runAttempt,
    runId: envelope.runId,
    schemaVersion: 1
  };
  await writeActionsJsonl(envelope, actions);
  await writeFile3(resolve5(envelope.resultsDir, "ci-results.json"), `${JSON.stringify(result, null, 2)}
`, "utf8");
  return result;
}
async function executeAtomsFromFiles(options) {
  const manifest = await loadAtomManifest(resolve5(options.manifestPath));
  const selection = JSON.parse(await readFile4(resolve5(options.selectionPath), "utf8"));
  return executeAtoms({ manifest, selection });
}

// src/index.ts
function printJson(value) {
  process.stdout.write(`${JSON.stringify(value)}
`);
}
function fail(error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}
`);
  process.exit(1);
}
function notImplemented(command) {
  throw new Error(`${command} is not implemented yet`);
}
async function validateAtoms(options) {
  const manifestPath = options.manifest ?? "tools/ci/atoms.json";
  const result = await validateAtomManifest(manifestPath, { repoRoot: options.repoRoot });
  if (options.json === true) {
    printJson({
      atomCount: result.atomCount,
      atomNames: result.atomNames,
      manifestPath,
      schemaVersion: result.manifest.schemaVersion
    });
    return;
  }
  process.stdout.write(`tools-ci atoms: ${result.atomCount} valid (${result.atomNames.join(", ")})
`);
}
async function selectAtoms2(options) {
  if (options.capabilities == null || options.capabilities.length === 0) {
    throw new Error("select-atoms requires --capabilities <path>");
  }
  const manifestPath = options.manifest ?? "tools/ci/atoms.json";
  const selection = await selectAtomsFromFiles({
    capabilitiesPath: options.capabilities,
    manifestPath,
    outPath: options.out
  });
  if (options.json === true || options.out == null) {
    printJson(selection);
    return;
  }
  process.stdout.write(`tools-ci selection: ${selection.selectedAtoms.length} selected, ${selection.unavailable.length} unavailable
`);
}
async function execute(options) {
  if (options.selection == null || options.selection.length === 0) {
    throw new Error("execute requires --selection <path>");
  }
  const result = await executeAtomsFromFiles({
    manifestPath: options.manifest ?? "tools/ci/atoms.json",
    selectionPath: options.selection
  });
  const failures = result.actions.filter((action) => action.status === "failure");
  process.stdout.write(`tools-ci execute: ${result.actions.length} atoms, ${failures.length} failures
`);
  if (failures.length > 0) {
    process.exitCode = 1;
  }
}
async function aggregate(options) {
  if (options.runnerResults == null || options.runnerResults.length === 0) {
    throw new Error("aggregate requires --runner-results <path>");
  }
  if (options.hostedResults == null || options.hostedResults.length === 0) {
    throw new Error("aggregate requires --hosted-results <path>");
  }
  const result = await aggregateWorkflowResultFiles({
    hostedResultsPath: options.hostedResults,
    outPath: options.out,
    runnerResultsPath: options.runnerResults
  });
  if (options.json === true || options.out == null) {
    printJson(result);
  } else {
    process.stdout.write(`tools-ci aggregate: ${result.passed ? "success" : "failure"} (${result.actions.length} atoms)
`);
  }
  if (!result.passed) {
    process.exitCode = 1;
  }
}
process.on("uncaughtException", fail);
process.on("unhandledRejection", fail);
var cli = cac("tools-ci");
cli.command("validate-atoms", "Validate the CI atom manifest").option("--manifest <path>", "Atom manifest path", { default: "tools/ci/atoms.json" }).option("--repo-root <path>", "Repository root used for script path validation").option("--json", "Print JSON").action((options) => {
  void validateAtoms(options);
});
cli.command("validate-envelope", "Validate the normalized CI execution envelope").action(() => notImplemented("validate-envelope"));
cli.command("select-atoms", "Select atoms from manifest and provider capabilities").option("--manifest <path>", "Atom manifest path", { default: "tools/ci/atoms.json" }).option("--capabilities <path>", "Provider capability manifest path").option("--out <path>", "Write selection JSON to a file").option("--json", "Print JSON").action((options) => {
  void selectAtoms2(options);
});
cli.command("execute", "Execute selected CI atoms").option("--manifest <path>", "Atom manifest path", { default: "tools/ci/atoms.json" }).option("--selection <path>", "Atom selection JSON path").action((options) => {
  void execute(options);
});
cli.command("aggregate", "Aggregate CI atom results").option("--runner-results <path>", "Runner ci-results.json path").option("--hosted-results <path>", "Hosted ci-results.json path").option("--out <path>", "Write aggregate JSON to a file").option("--json", "Print JSON").action((options) => {
  void aggregate(options);
});
cli.help();
cli.parse();
export {
  aggregateWorkflowResultFiles,
  aggregateWorkflowResults,
  executeAtoms,
  executeAtomsFromFiles,
  loadAtomManifest,
  parseAtomManifest,
  parseProviderCapabilities,
  parseWorkflowResult,
  readNormalizedEnvelope,
  resolveToolCiConfig,
  resolveToolCiRoots,
  selectAtoms,
  selectAtomsFromFiles,
  validateAtomManifest
};
