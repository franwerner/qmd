#!/usr/bin/env bash
# Fork version scheme: <upstream-base>-mate.N
#
# This fork does not publish to any registry, and it never bumps the upstream
# base itself — the base moves only when a rebase brings in a new upstream
# release. So the base is read from package.json's version and the fork counter
# resets to 1 whenever that base changes: 2.8.3 -> 2.8.3-mate.1 -> 2.8.3-mate.2,
# and after a rebase onto 2.9.0 -> 2.9.0-mate.1.
#
# Sourced by scripts/release.sh and skills/release/scripts/release-context.sh so
# both compute the next version from one definition.

FORK_SUFFIX="mate"

# Split a version into "<base> <counter>". A version with no fork suffix has
# counter 0, which is what makes the reset fall out of the increment rule.
# Returns 1 for anything that is neither shape.
parse_fork_version() {
  local version="$1"
  if [[ "$version" =~ ^([0-9]+\.[0-9]+\.[0-9]+)-${FORK_SUFFIX}\.([0-9]+)$ ]]; then
    echo "${BASH_REMATCH[1]} ${BASH_REMATCH[2]}"
  elif [[ "$version" =~ ^([0-9]+\.[0-9]+\.[0-9]+)$ ]]; then
    echo "${BASH_REMATCH[1]} 0"
  else
    return 1
  fi
}

next_fork_version() {
  local parsed base counter
  parsed=$(parse_fork_version "$1") || return 1
  base="${parsed% *}"
  counter="${parsed#* }"
  echo "${base}-${FORK_SUFFIX}.$((counter + 1))"
}

is_fork_version() {
  [[ "$1" =~ ^[0-9]+\.[0-9]+\.[0-9]+-${FORK_SUFFIX}\.[0-9]+$ ]]
}

fork_version_base() {
  local parsed
  parsed=$(parse_fork_version "$1") || return 1
  echo "${parsed% *}"
}

# Shared rejection for the bump keywords the upstream scripts used to accept.
# They mean "move the base", and the base is not this fork's to move.
reject_bump_keyword() {
  case "$1" in
    patch|minor|major)
      echo "Error: '$1' is not a valid version for this fork." >&2
      echo "" >&2
      echo "The upstream base (X.Y.Z) only changes when a rebase brings in a new" >&2
      echo "upstream release. This fork releases as <base>-${FORK_SUFFIX}.N." >&2
      echo "" >&2
      echo "Run with no argument to take the next fork version automatically." >&2
      return 0
      ;;
  esac
  return 1
}
