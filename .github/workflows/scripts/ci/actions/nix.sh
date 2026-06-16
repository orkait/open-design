#!/usr/bin/env bash
set -Eeuo pipefail

source "$(dirname "$0")/../lib.sh"

ci_gate_timed_nix_step() {
  local step_timeout_seconds="$1"
  shift

  local CI_GATE_STEP_TIMEOUT_SECONDS="$step_timeout_seconds"
  ci_gate_timed_step "$@"
}

flake_ref="${CI_GATE_NIX_FLAKE_REF:-.}"

export NIX_CONFIG="${NIX_CONFIG:+$NIX_CONFIG
}experimental-features = nix-command flakes
connect-timeout = 30
stalled-download-timeout = 120
download-attempts = 3"

nix_system="${CI_GATE_NIX_SYSTEM:-$(nix eval --raw --expr builtins.currentSystem)}"

printf 'nix system: %s\n' "$nix_system"
printf 'nix flake ref: %s\n' "$flake_ref"

ci_gate_timed_nix_step 60 "store-info" nix store info
ci_gate_timed_nix_step 600 "flake-archive" nix flake archive --option substituters "" --json "$flake_ref"
ci_gate_timed_nix_step 300 "flake-metadata" nix flake metadata "$flake_ref"
ci_gate_timed_nix_step 600 "flake-check-eval" nix flake check --no-build --keep-going "$flake_ref"
ci_gate_timed_nix_step 900 "build-check-daemon" nix build --print-build-logs "$flake_ref#checks.$nix_system.daemon"
ci_gate_timed_nix_step 900 "build-check-web" nix build --print-build-logs "$flake_ref#checks.$nix_system.web"
