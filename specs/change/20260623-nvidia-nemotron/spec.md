# NVIDIA Nemotron support

## Why

Users want to run NVIDIA Nemotron models in Open Design. NVIDIA serves them
through an OpenAI-compatible endpoint (`https://integrate.api.nvidia.com/v1`),
so the work is additive and reuses existing OpenAI-compatible plumbing. Today
there is no NVIDIA provider; the only Nemotron presence is a couple of
`nemotron-3-*` strings in the Ollama Cloud catalog.

## Scope

1. **BYOK** - add a dedicated `NVIDIA` provider tab (the only surface where the
   user's `nvapi-` key actually works). Mirrors the existing AIHubMix /
   SenseAudio / Ollama Cloud tab pattern.
2. **Local CLI (light)** - add verified Nemotron ids to OpenCode's
   `fallbackModels` for discoverability. OpenCode already lists Nemotron via its
   own catalog (`opencode/nemotron-3-ultra-free`, `openrouter/nvidia/...:free`).

## Non-goals

- No OpenCode custom-provider config writing and no `agentCliEnv` allowlist
  expansion. Consequence (explicit): the `nvapi-` key is **not** usable in Local
  CLI mode; OpenCode reaches Nemotron only through its own free
  `opencode/` / `openrouter/` routes, which do not consume the NVIDIA key. The
  key is a BYOK-only credential.
- No new `ApiProtocol` semantics beyond an OpenAI-compatible gateway entry.
- No changes to the Nemotron model families themselves (reasoning vs instruct);
  the daemon forwards whatever model id is selected.

## Evidence (probed live against the user's key)

Endpoint `GET /v1/models` -> 200, OpenAI envelope, 121 models, 25 Nemotron ids.
Per-model `POST /v1/chat/completions` servability:

| Servable (ship in suggested list) | Not servable -> exclude (in /models but chat 404) |
|---|---|
| `nvidia/llama-3.3-nemotron-super-49b-v1.5` | `nvidia/llama-3.1-nemotron-ultra-253b-v1` |
| `nvidia/nemotron-3-super-120b-a12b` | `nvidia/nemotron-4-340b-instruct` |
| `nvidia/nemotron-3-ultra-550b-a55b` | `nvidia/llama-3.1-nemotron-70b-instruct` |
| `nvidia/nemotron-3-nano-30b-a3b` | `nvidia/llama-3.1-nemotron-51b-instruct` |
| `nvidia/nvidia-nemotron-nano-9b-v2` | `nvidia/nemotron-nano-3-30b-a3b` |
| `nvidia/llama-3.3-nemotron-super-49b-v1` | |
| `nvidia/llama-3.1-nemotron-nano-8b-v1` | |
| `nvidia/nemotron-mini-4b-instruct` | |
| `mistralai/mistral-nemotron` | |

Default model: `nvidia/llama-3.3-nemotron-super-49b-v1.5`. The live `/v1/models`
fetch still runs once a key is entered (same as every provider), so the curated
list is only the pre-key suggestion set.

## Design

### A. BYOK NVIDIA tab (OpenAI-compatible, fixed-origin gateway)

`ApiProtocol` and `ConnectionTestProtocol` are exhaustive `Record<...>` keys, so
adding `'nvidia'` forces every map to gain an entry - the typechecker is the
completeness guard.

| File | Change |
|---|---|
| `apps/web/src/types.ts:108` | add `'nvidia'` to `ApiProtocol` |
| `packages/contracts/src/api/connectionTest.ts:182` | add `'nvidia'` to `ConnectionTestProtocol` |
| `apps/web/src/state/apiProtocols.ts` | `API_PROTOCOL_TABS` += `{id:'nvidia',title:'NVIDIA'}`; `SUGGESTED_MODELS_BY_PROTOCOL.nvidia` = 9 verified ids; `API_PROTOCOL_LABELS.nvidia='NVIDIA API'`; `API_KEY_PLACEHOLDERS.nvidia='nvapi-...'`; `DEFAULT_BASE_URL_BY_PROTOCOL.nvidia='https://integrate.api.nvidia.com/v1'`; `FIXED_ORIGIN_GATEWAYS` += `'nvidia'` (base URL is implied, field hidden) |
| `apps/daemon/src/integrations/provider-models.ts` | extend the `openai \|\| senseaudio` branches in `providerModelsUrl`, `providerModelsHeaders`, `extractModels` to also accept `'nvidia'` (Bearer auth, `/v1/models`, `extractOpenAiModels`) |
| `apps/daemon/src/connectionTest.ts` | route `'nvidia'` through the OpenAI-compatible connection-test path |

No new i18n keys: tab title / labels are plain strings, consistent with the
other gateway tabs.

### B. OpenCode fallbackModels

| File | Change |
|---|---|
| `apps/daemon/src/runtimes/defs/opencode.ts:21` | add the OpenCode-resolvable Nemotron ids (e.g. `opencode/nemotron-3-ultra-free`, `openrouter/nvidia/nemotron-3-nano-30b-a3b:free`) to `fallbackModels` so they surface when live `opencode models` times out |

## Capability dual-track (AGENTS.md)

BYOK provider selection has no dedicated `od` subcommand; it is set through
app-config, which the existing `od` config path already covers - adding a
protocol enum value needs no new CLI command. No new endpoint or contract shape
is introduced (reuses `/api/*` connection-test + provider-models with one new
enum member). Surface-area checklist: API/contract (enum member only), no UI
route added beyond the new tab, no new env var, no i18n keys.

## Verification

- `pnpm --filter @open-design/web typecheck` + `pnpm --filter @open-design/daemon typecheck` (the `Record<ApiProtocol,...>` maps must all compile).
- `pnpm guard`.
- Live BYOK smoke: start daemon, set BYOK NVIDIA + key, hit the provider-models
  list endpoint (expect Nemotron ids) and run one chat completion with
  `nvidia/llama-3.3-nemotron-super-49b-v1` (verified 200).
- Browser check: BYOK tab shows `NVIDIA`, base-URL field hidden, suggested
  Nemotron models listed, extraction/chat runs.
- OpenCode: `opencode models | grep nemotron` already lists them; confirm the
  fallback list renders if live fetch is disabled.

## Rollback

Pure additive enum + map entries + one fallback array. Revert the commit to
remove the tab; no migration, no persisted-schema change.
