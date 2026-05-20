#!/usr/bin/env node

import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const entryDir = dirname(fileURLToPath(import.meta.url));
const distEntry = resolve(entryDir, "../dist/index.mjs");

if (!existsSync(distEntry)) {
  throw new Error(`tools-bundle dist entry not found at ${distEntry}. Run "pnpm --filter @open-design/tools-bundle build" first.`);
}

const mod = await import(pathToFileURL(distEntry).href);
await mod.main();
