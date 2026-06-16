#!/usr/bin/env bash
set -Eeuo pipefail

usage() {
  cat <<'EOF' >&2
usage: local-docker-tools-ci.sh [--provider <provider>] [--profile ci-base|ci-playwright|nix-capable] <run-id> [atom...]

Default ci-base atoms:
  guard i18n

Default ci-playwright atoms:
  browser

Default nix-capable atoms:
  nix

Supported ci-base atoms:
  guard i18n unit daemon web typecheck build

Supported ci-playwright atoms:
  browser

Supported nix-capable atoms:
  nix

Environment:
  OPEN_DESIGN_CI_IMAGE_REF          Docker image ref override
  OPEN_DESIGN_CI_BASE_IMAGE         ci-base image ref, default open-design-ci-base:v0.1.0-beta.1
  OPEN_DESIGN_CI_PLAYWRIGHT_IMAGE   ci-playwright image ref, default open-design-ci-playwright:v0.1.0-beta.2
  OPEN_DESIGN_CI_NIX_IMAGE          nix-capable image ref, default open-design-ci-nix:v0.1.0-beta.7
  OPEN_DESIGN_CI_NIX_VOLUME         nix-capable Docker volume, default open-design-tools-ci-nix-store

Evidence is written under:
  .tmp/workflows/ci-gate/runs/<run-id>
EOF
  exit 2
}

profile="ci-base"
provider="local-docker"

while [ "$#" -gt 0 ]; do
  case "$1" in
    --provider)
      provider="${2:-}"
      shift 2
      ;;
    --profile)
      profile="${2:-}"
      shift 2
      ;;
    --help|-h)
      usage
      ;;
    --)
      shift
      break
      ;;
    -*)
      echo "unknown option: $1" >&2
      usage
      ;;
    *)
      break
      ;;
  esac
done

if [ "$#" -lt 1 ]; then
  usage
fi

case "$provider" in
  ''|*/*|*' '*|*'..'*)
    echo "provider must be a simple identifier" >&2
    exit 2
    ;;
esac

case "$profile" in
  ci-base|ci-playwright|nix-capable)
    ;;
  *)
    echo "unsupported profile: $profile" >&2
    usage
    ;;
esac

run_id="$1"
shift

if [ "$#" -eq 0 ]; then
  case "$profile" in
    ci-playwright)
      selected_atoms=(browser)
      ;;
    nix-capable)
      selected_atoms=(nix)
      ;;
    *)
      selected_atoms=(guard i18n)
      ;;
  esac
else
  selected_atoms=("$@")
fi

case "$run_id" in
  ''|*/*|*' '*|*'..'*)
    echo "run-id must be a simple path segment" >&2
    exit 2
    ;;
esac

for atom in "${selected_atoms[@]}"; do
  case "$profile:$atom" in
    ci-base:guard|ci-base:i18n|ci-base:unit|ci-base:daemon|ci-base:web|ci-base:typecheck|ci-base:build)
      ;;
    ci-playwright:browser)
      ;;
    nix-capable:nix)
      ;;
    *)
      echo "unsupported $profile atom: $atom" >&2
      usage
      ;;
  esac
done

script_dir="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
repo_root="$(CDPATH= cd -- "$script_dir/../../../.." && pwd)"
case "$profile" in
  ci-playwright)
    default_image_ref="${OPEN_DESIGN_CI_PLAYWRIGHT_IMAGE:-open-design-ci-playwright:v0.1.0-beta.2}"
    ;;
  nix-capable)
    default_image_ref="${OPEN_DESIGN_CI_NIX_IMAGE:-open-design-ci-nix:v0.1.0-beta.7}"
    ;;
  *)
    default_image_ref="${OPEN_DESIGN_CI_BASE_IMAGE:-open-design-ci-base:v0.1.0-beta.1}"
    ;;
esac
image_ref="${OPEN_DESIGN_CI_IMAGE_REF:-$default_image_ref}"
evidence_root="${OPEN_DESIGN_CI_EVIDENCE_ROOT:-$repo_root/.tmp/workflows/ci-gate}"
run_root="$evidence_root/runs/$run_id"
default_tool_root="$repo_root/.tmp/tools-ci"
default_runner_cache_root=""
if [ "${GITHUB_ACTIONS:-}" = "true" ]; then
  default_runner_cache_root="${HOME:-/home/runner}/.cache/open-design-ci"
  default_tool_root="$default_runner_cache_root/tools-ci"
fi
runner_cache_root="${OPEN_DESIGN_CI_RUNNER_CACHE_ROOT:-$default_runner_cache_root}"
tool_root="${OPEN_DESIGN_CI_TOOL_ROOT:-$default_tool_root}"
selection_path="$tool_root/selections/$run_id.json"
head_sha="$(git -C "$repo_root" rev-parse HEAD 2>/dev/null || printf 'unknown')"
host_uid="$(id -u)"
host_gid="$(id -g)"
ci_mode="default"

if [ ! -f "$repo_root/package.json" ]; then
  echo "open-design package.json not found: $repo_root" >&2
  exit 1
fi

if ! node --experimental-strip-types "$repo_root/packages/metatool/src/cli.ts" check "$repo_root/tools/ci" >/dev/null 2>&1; then
  package_manager="$(node -p "JSON.parse(require('node:fs').readFileSync('$repo_root/package.json', 'utf8')).packageManager")"
  echo "tools-ci dist is missing or stale; installing workspace and rebuilding tools-ci"
  (
    cd "$repo_root"
    corepack prepare "$package_manager" --activate
    corepack pnpm install --frozen-lockfile --prefer-offline --network-concurrency=8
    corepack pnpm --filter @open-design/tools-ci build
  )
fi

mkdir -p "$run_root" "$tool_root/selections"
docker_cache_env=()
docker_cache_volumes=()
if [ -n "$runner_cache_root" ]; then
  mkdir -p "$runner_cache_root/corepack" "$runner_cache_root/pnpm-store" "$runner_cache_root/tools-ci"
  docker_cache_env=(
    --env COREPACK_HOME=/runner-cache/corepack
    --env OD_CI_CACHE_DIR=/runner-cache
    --env npm_config_store_dir=/runner-cache/pnpm-store
  )
  docker_cache_volumes=(
    --volume "$runner_cache_root:/runner-cache"
  )
fi

docker_profile_args=()
docker_profile_env=()
docker_profile_volumes=()
docker_source_env=(--env OD_CI_COPY_NODE_MODULES=1)
docker_identity_env=()
if [ "$profile" = "ci-playwright" ]; then
  docker_profile_args=(--shm-size 2g)
  docker_profile_env=(
    --env CI_GATE_E2E_VITEST_FLAGS=--no-file-parallelism
    --env CI_GATE_SKIP_PLAYWRIGHT_INSTALL=1
    --env PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
  )
fi
if [ "$profile" = "nix-capable" ]; then
  docker_source_env=()
  nix_volume="${OPEN_DESIGN_CI_NIX_VOLUME:-open-design-tools-ci-nix-store}"
  docker_profile_volumes=(
    --volume "$nix_volume:/nix"
  )
  docker_identity_env=(
    --env USER=runner
    --env LOGNAME=runner
    --env CI_GATE_NIX_FLAKE_REF="path:/tmp/tools-ci-work/$run_id"
    --env NIX_NPM_REGISTRY=https://registry.npmmirror.com
    --env $'NIX_CONFIG=experimental-features = nix-command flakes\nmax-jobs = 1\ncores = 1\nconnect-timeout = 30\ndownload-attempts = 3\nhttp-connections = 8\nmax-substitution-jobs = 8\nstalled-download-timeout = 120\nsubstituters = https://mirrors.ustc.edu.cn/nix-channels/store https://mirrors.tuna.tsinghua.edu.cn/nix-channels/store https://cache.nixos.org/\ntrusted-public-keys = cache.nixos.org-1:6NCHdD59X431o0gWypbMrAURkbJ16ZPMQFGspcDShjY='
  )
fi

OD_CI_PROVIDER_ID="$provider" node - "$selection_path" "${selected_atoms[@]}" <<'NODE'
const { writeFileSync } = require("node:fs");

const [selectionPath, ...selectedAtoms] = process.argv.slice(2);
writeFileSync(
  selectionPath,
  `${JSON.stringify({
    provider: process.env.OD_CI_PROVIDER_ID ?? "local-docker",
    schemaVersion: 1,
    selectedAtoms,
    unavailable: [],
  }, null, 2)}\n`,
  "utf8",
);
NODE

docker run --rm \
  --name "od-tools-ci-${run_id}" \
  "${docker_profile_args[@]}" \
  --user "$host_uid:$host_gid" \
  --volume "$repo_root:/repo-src:ro" \
  --volume "$evidence_root:/evidence" \
  --volume "$tool_root:/tool" \
  "${docker_cache_volumes[@]}" \
  "${docker_profile_volumes[@]}" \
  --workdir /repo-src \
  --env COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
  --env HOME=/tool/home \
  "${docker_cache_env[@]}" \
  --env OD_CI_ATOM_MANIFEST=/repo-src/tools/ci/atoms.json \
  --env OD_CI_EVIDENCE_ROOT=/evidence \
  --env OD_CI_HEAD_SHA="$head_sha" \
  --env OD_CI_MODE="$ci_mode" \
  --env OD_CI_PROFILE="$profile" \
  --env OD_CI_PROVIDER_ID="$provider" \
  --env OD_CI_REPO_DIR=/repo-src \
  --env OD_CI_RUN_ATTEMPT=1 \
  --env OD_CI_RUN_ID="$run_id" \
  --env OD_CI_SOURCE_MODE=copy \
  --env OD_CI_TOOL_ROOT=/tool \
  --env OD_CI_TMP_DIR="/tmp/tools-ci-tmp/$run_id" \
  --env OD_CI_WORK_DIR="/tmp/tools-ci-work/$run_id" \
  --env OD_CI_WORKSPACE_ROOT=/repo-src \
  --env SHELL=/bin/bash \
  "${docker_source_env[@]}" \
  "${docker_identity_env[@]}" \
  "${docker_profile_env[@]}" \
  "$image_ref" \
  bash -lc 'node /repo-src/tools/ci/dist/index.mjs execute --selection "/tool/selections/$OD_CI_RUN_ID.json"'

echo "$run_root"
