#!/usr/bin/env bash
set -Eeuo pipefail

source "$(dirname "$0")/../lib.sh"

flake_ref="${CI_GATE_NIX_FLAKE_REF:-.}"

ci_gate_timed_step "flake-check" nix flake check --print-build-logs --keep-going "$flake_ref"
