# tools/bundle/AGENTS.md

Follow the root `AGENTS.md` and `tools/AGENTS.md` first. This tool owns local bundle production and local bundle store workflows.

## Boundary

- `tools-bundle` creates and validates direct bundle roots that contain `bundle.json`.
- `tools-bundle` may add/list/resolve/delete local `packages/bundle` store entries.
- Keep remote publishing, signing, rollout, update feeds, and compatibility range policy out of this tool until those lanes are explicitly designed.
- Keep runtime lifecycle, process stamps, app startup, logs, and IPC inspection out of this tool; those belong to `tools/dev`, packaged launchers, or app sidecars.

## Commands

```bash
pnpm --filter @open-design/tools-bundle test
pnpm --filter @open-design/tools-bundle typecheck
pnpm --filter @open-design/tools-bundle build
pnpm tools-bundle validate <bundle-path>
```
