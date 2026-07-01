---
name: open-design
description: Use when interacting with Open Design (OD) - the local-first design workspace - to create or iterate design artifacts (landing pages, decks, prototypes, posters, media, brand/design systems) via the mcp__open-design__* tools or the `od` CLI. Covers projects, runs, files/artifacts, media generation, brand extraction, design systems, skills/plugins, automations, memory, GenUI questions, and research.
---

# Open Design (OD)

Local-first design workspace. A daemon owns everything. Two surfaces:

- **MCP tools** (`mcp__open-design__*`) - work in **ANY project/repo** (registered
  at Claude user scope). They bridge to the daemon, so they need NO OD checkout,
  NO env vars, NO `od` binary - just the daemon running. **This is the
  cross-project surface. From a repo that is not the OD checkout, use ONLY these.**
  Covers the CORE surface: projects, files/artifacts, runs, discovery.
- **`od` CLI** - the FULL surface (media, brand, design-systems, plugins,
  automation, memory, GenUI, research, connectors, marketplace, templates,
  conversations). **CHECKOUT-ONLY.** It is NOT a global binary.

> ⚠️ **Bare `od` is NOT Open Design.** On Linux/macOS `od` is GNU coreutils
> (octal dump). OD's CLI is never on PATH. Invoke it ONLY from inside the OD
> checkout as `node apps/daemon/bin/od.mjs <cmd>` (or `pnpm exec od <cmd>`).
> In any other repo there is no `od` CLI - use the MCP tools instead.

Both surfaces hit the same daemon HTTP API. Most read/list CLI subcommands
support `--json`; long prompts via `--prompt-file <path|->`. Project resolution:
MCP `start_run` falls back to active context; CLI `run start` ALWAYS needs
`--project`; CLI `media generate` needs `--project` or daemon-injected `OD_PROJECT_ID`.

## Prerequisite
The daemon must be running, or both surfaces fail. You do NOT need the OD checkout
to USE OD from another repo - only the daemon up + the MCP tools. Start the daemon
from a machine that HAS the checkout: `pnpm tools-dev` (default namespace), kept
alive in a real terminal. The CLI auto-discovers it via `OD_DAEMON_URL` →
`OD_SIDECAR_IPC_PATH` → `http://127.0.0.1:7456`. If port 7456 answers but the MCP
still can't act, the daemon may be a stale/foreign process - restart it from the
checkout. (Inside the checkout, the canonical agent form is
`"$OD_NODE_BIN" "$OD_BIN" <cmd>`.)

## Active context (MCP read tools)
`project` (and the path on `get_file`/`get_artifact`) is OPTIONAL. Omit it →
defaults to the project/file the user has open in OD now. "this file" / "the
design I have open" → call without `project`. Response carries
`usedActiveContext`. Pass `project` to override. Expires ~5 min after last OD
interaction; if stale `get_active_context` returns `{active:false}` - ask the
user to click into a project, or pass `project`.

## MCP tools (core)
| Goal | Tool |
|---|---|
| What's open now | `get_active_context` |
| List projects on daemon | `list_projects` |
| One project's metadata (name, entryFile, kind, previewUrl) | `get_project` |
| Pull a design WHOLE (entry + every referenced sibling, depth 3) | `get_artifact` ← prefer |
| Read one known file (paged; `[od:file-window]` marks more) | `get_file` |
| Find a class/component/copy string | `search_files` |
| File metadata only | `list_files` |
| Create empty project (returns id + conversationId) | `create_project` (name req; optional id, designSystem, skill) |
| Commission OD to generate/refine (returns runId) | `start_run` (prompt and/or skill/plugin+inputs; optional agent, model, project). To set `agent`/`model`, first `list_agents` - do NOT guess `claude`/`codex`; only listed agents spawn. |
| Poll a run → status + previewUrl + agentMessage | `get_run` (status: queued/running/succeeded/failed/canceled) |
| Stop a run | `cancel_run` |
| Create one artifact entry file (rejects existing) | `create_artifact` |
| Overwrite/create any file | `write_file` |
| Delete file / project (`confirm:true`) | `delete_file` / `delete_project` |
| Discover runnable agents / skills / plugins | `list_agents` / `list_skills` / `list_plugins` |

Read each tool's schema before calling; do not invent fields.

## `od` CLI capability map (Bash, CHECKOUT-ONLY)
**These run ONLY inside the OD checkout. `od` below = `node apps/daemon/bin/od.mjs`
(or `pnpm exec od`), NOT the coreutils `od` on PATH. From any other repo these are
unavailable - use the MCP tools.**

| Domain | Command |
|---|---|
| Projects | `od project create\|import\|import-folder\|list\|info\|delete\|editors\|open-in\|handoff` |
| Runs | `od run start\|redesign\|watch <id>\|cancel\|list\|info\|result-package` (`--follow` streams) |
| Files | `od files list\|read\|write\|upload\|delete\|diff` (write reads stdin) |
| Artifacts | `od artifacts create --name <path> --input <file>` |
| **Media** | `od media generate --surface image\|video\|audio --model <id> --project <id> [--prompt --aspect --length --duration --voice --language ...]`. **`--project` is REQUIRED from an external shell** (no active-context fallback; the daemon injects `OD_PROJECT_ID` only when it spawns the agent). Valid model ids come ONLY from the `/api/media/models` HTTP endpoint - there is no `od media models` command. |
| **Brand extract** | `od brand extract <url>` (alias `create`) → open the backing project to run the agent → `od brand preview <id>` → `od brand finalize <id>` (registers as design system) · `list`/`get`/`delete` |
| Design systems | `od design-systems list\|show\|rename\|import-local\|import-github\|import-shadcn\|rebuild-token-contract` |
| Skills / atoms / craft | `od skills list\|show` · `od atoms list\|show\|info` · `od craft list\|show` |
| Templates | `od templates list\|save <projectId> --name\|delete` |
| Plugins | `od plugin list\|search\|info\|install --source\|upgrade\|uninstall\|apply\|doctor\|publish-repo\|open-design-pr` |
| Marketplace | `od marketplace add\|list\|info\|plugins\|search\|login\|refresh\|trust\|remove` |
| Automations (routines) | `od automation list\|get\|create\|update\|run\|runs\|pause\|resume\|delete` · `template`/`source`/`proposal` subtrees (self-evolution) |
| Memory tree | `od memory tree list\|view\|edit\|move` (injected into agent prompts) |
| **GenUI questions** | `od ui list --run <id>` · `od ui show` · `od ui respond --run <id> <surfaceId> --value/--value-json/--skip` · `prefill`/`revoke` |
| Conversations / side chat | `od conversation new\|list\|info` · `od chat new --project <id> [--seed-from --fork-after]` |
| Research | `od research search --query <text> [--max-sources 5]` (Tavily, JSON) |
| Connectors | `od tools connectors list\|execute\|github-design-context` |
| Live artifacts | `od tools live-artifacts create\|list\|update\|refresh` · `od mcp live-artifacts` (separate MCP server) |
| Config | `od config list\|get\|set\|unset` (app config) |
| Daemon / health | `od daemon start\|status\|stop\|db status\|db verify\|db vacuum` · `od status` · `od doctor` · `od diagnostics export` |
| Share | `od share open-design\|url` (localized social-share targets) |
| Wire into other agents | `od mcp install <agent>` (claude/codex/cursor/…; registers at user scope automatically). Flags: `--print` preview, `--uninstall` remove, `--name <n>`. No `--scope` flag. |

## Key workflows
1. **Generate a design:** `create_project` → `start_run(prompt[, skill/plugin])` → poll `get_run` every 30-60s until status is terminal → open `previewUrl` or pull with `get_artifact`. Hand-tweak with `write_file`. (To pin `agent`/`model`, `list_agents` first. CLI equivalent `od run start` REQUIRES `--project`.)
2. **Run isn't progressing:** First assume it's WORKING - runs take 5-30 min; `running` with unchanged file mtimes is the agent thinking, not a hang. Poll every 30-60s and tell the user "still working." Do NOT cancel and substitute `write_file` (that throws away OD's pipeline quality). If it truly paused for input, `get_run.agentMessage` carries a question (no previewUrl) → answer via the web Questions tab or `od ui respond --run <id> <surfaceId> --value …`. Only `cancel_run` if the user asks.
3. **Pull the active design:** `get_artifact` (no args) → entry + tokens + modules in one call.
4. **Brand → design system:** `od brand extract <url>`, open the backing project so the agent runs, `od brand finalize <id>`, then attach via `create_project(designSystem)` or the composer.
5. **Media:** get a valid `--model` from the `/api/media/models` endpoint, then `od media generate --surface … --model … --project <id> --prompt …`. Pass `--project` explicitly - media has no active-context fallback.
6. **Ambiguous "PPT / deck / slides / PDF / doc" request:** OD natively produces browser HTML/SVG (incl. HTML-rendered decks), NOT binary `.pptx`/`.docx`/`.pdf`. ASK the user which they want before starting; don't silently pick one or run both.

## Common mistakes
- Running bare `od …` in a non-OD repo and concluding "OD isn't installed" → `od` is coreutils octal-dump there. OD's CLI is checkout-only; in any other repo use the **MCP tools** - they need no checkout, no env vars, no `od` binary, only the daemon up.
- MCP failing / daemon down → start it from the OD checkout (`pnpm tools-dev`) in a real terminal and keep it alive. Port 7456 answering ≠ the right daemon; restart from the checkout if MCP still can't act.
- Reaching for a CLI-only feature (media/brand/automation/…) from outside the checkout → those need the checkout; the MCP exposes the core (projects/files/runs/discovery), not those.
- Many `get_file` calls to understand one design → one `get_artifact`.
- Guessing a path → `search_files` first.
- Calling a run "stuck" too early → 5-30 min is normal; `running` + unchanged mtimes = thinking. Don't cancel + `write_file`. Check `od ui list --run <id>` only if you suspect a pending question.
- Omitting `--project` on `od media generate` / `od run start` from an external shell → hard error; pass `--project <id>` (these have no active-context fallback, unlike MCP read tools + `start_run`).
- Guessing `agent:"claude"` for `start_run` → `list_agents` first; only installed agents spawn.
- Promising a binary `.pptx`/`.docx`/`.pdf` → OD outputs HTML/SVG; ask the user first.
- Passing `project` when the user means "the one open" → omit it on MCP read tools; confirm via `usedActiveContext`.
