#!/usr/bin/env bash
set -euo pipefail

# Extract cumulative release notes from CHANGELOG.md.
#
# For an upstream-shaped version (e.g. 1.0.5), extracts all entries from the
# current minor series back to x.x.0 (e.g. 1.0.0 through 1.0.5). This means each
# GitHub release restates the full arc of changes for the minor series.
#
# For a fork version (e.g. 2.8.3-mate.2), the series is the fork's own run on
# top of that upstream base: [2.8.3-mate.1] through [2.8.3-mate.2], and NOT
# upstream's [2.8.3] entry. The counter resets with every new base, so the notes
# then describe exactly what this fork added on top of the base it ships.
#
# The [Unreleased] section is included — it contains the content that will
# become [X.Y.Z] when the release script runs. If the version is already
# released, [Unreleased] may be empty and is omitted.
#
# Fails if neither [Unreleased] nor [X.Y.Z] has content in the changelog.
#
# Usage: scripts/extract-changelog.sh <version>
# Example: scripts/extract-changelog.sh 1.0.5
#   -> extracts [Unreleased] + [1.0.5], [1.0.4], ..., [1.0.0]

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
source "$SCRIPT_DIR/fork-version.sh"

VERSION="${1:?Usage: extract-changelog.sh <version>}"

# A fork version selects its own base's fork entries; a bare one keeps the
# upstream minor-series rollup.
if is_fork_version "$VERSION"; then
  FORK_SERIES=true
  SERIES_BASE=$(fork_version_base "$VERSION")
else
  FORK_SERIES=false
  IFS='.' read -r MAJOR MINOR PATCH <<< "$VERSION"
fi

if [[ ! -f CHANGELOG.md ]]; then
  echo "CHANGELOG.md not found" >&2
  exit 1
fi

# Extract [Unreleased] section and all [X.Y.Z] sections matching our minor series.
OUTPUT=""
CAPTURING=false
UNRELEASED_CONTENT=""
IN_UNRELEASED=false

while IFS= read -r line; do
  if [[ "$line" =~ ^##\ \[Unreleased\] ]]; then
    CAPTURING=true
    IN_UNRELEASED=true
  elif [[ "$line" =~ ^##\ \[([0-9]+\.[0-9]+\.[0-9]+(-[a-z]+\.[0-9]+)?)\] ]]; then
    IN_UNRELEASED=false
    ENTRY_VERSION="${BASH_REMATCH[1]}"
    ENTRY_BASE="${ENTRY_VERSION%%-*}"
    if $FORK_SERIES; then
      # Only this base's fork entries — upstream's own [X.Y.Z] stays out.
      IN_SERIES=$([[ "$ENTRY_BASE" == "$SERIES_BASE" ]] && is_fork_version "$ENTRY_VERSION" && echo true || echo false)
    else
      IFS='.' read -r E_MAJOR E_MINOR E_PATCH <<< "$ENTRY_BASE"
      IN_SERIES=$([[ "$E_MAJOR" == "$MAJOR" && "$E_MINOR" == "$MINOR" ]] && echo true || echo false)
    fi
    if $IN_SERIES; then
      CAPTURING=true
      OUTPUT+="$line"$'\n'
    else
      CAPTURING=false
    fi
  elif [[ "$line" =~ ^##\  ]]; then
    IN_UNRELEASED=false
    CAPTURING=false
  elif $CAPTURING; then
    if $IN_UNRELEASED; then
      UNRELEASED_CONTENT+="$line"$'\n'
    else
      OUTPUT+="$line"$'\n'
    fi
  fi
done < CHANGELOG.md

# Only include [Unreleased] if it has non-blank content
TRIMMED=$(echo "$UNRELEASED_CONTENT" | sed '/^[[:space:]]*$/d')
if [[ -n "$TRIMMED" ]]; then
  OUTPUT="## [Unreleased]"$'\n'"$UNRELEASED_CONTENT$OUTPUT"
fi

# Fail if we got nothing
TRIMMED_OUTPUT=$(echo "$OUTPUT" | sed '/^[[:space:]]*$/d')
if [[ -z "$TRIMMED_OUTPUT" ]]; then
  echo "error: no changelog content found for $VERSION" >&2
  echo "Expected either:" >&2
  echo "  ## [Unreleased]  (with content)" >&2
  echo "  ## [$VERSION] - YYYY-MM-DD" >&2
  exit 1
fi

printf '%s' "$OUTPUT"
