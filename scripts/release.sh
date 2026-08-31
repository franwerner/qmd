#!/usr/bin/env bash
set -euo pipefail

# QMD Release Script (fork)
#
# Renames the [Unreleased] section in CHANGELOG.md to the new version,
# bumps package.json, commits, and creates a tag. Pushing the tag creates
# the GitHub release; this fork publishes to no registry.
#
# Usage: ./scripts/release.sh [<version>]
# Examples:
#   ./scripts/release.sh                # 2.8.3 -> 2.8.3-mate.1
#   ./scripts/release.sh                # 2.8.3-mate.1 -> 2.8.3-mate.2
#   ./scripts/release.sh 2.9.0-mate.1   # explicit fork version

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
source "$SCRIPT_DIR/fork-version.sh"

REQUESTED="${1:-}"

if [[ -n "$REQUESTED" ]] && reject_bump_keyword "$REQUESTED"; then
  exit 1
fi

if [[ -n "$REQUESTED" ]] && ! is_fork_version "$REQUESTED"; then
  echo "Error: '$REQUESTED' is not a fork version (expected <major>.<minor>.<patch>-$FORK_SUFFIX.<n>)" >&2
  exit 1
fi

# Ensure we're on main and clean
BRANCH=$(git branch --show-current)
if [[ "$BRANCH" != "main" ]]; then
  echo "Error: must be on main branch (currently on $BRANCH)" >&2
  exit 1
fi

if [[ -n "$(git status --porcelain)" ]]; then
  echo "Error: working directory not clean" >&2
  git status --short
  exit 1
fi

# Verify bun.lock is in sync with package.json
if ! bun install --frozen-lockfile &>/dev/null; then
  echo "Error: bun.lock is out of sync with package.json" >&2
  echo "Run 'bun install' and commit the updated lockfile." >&2
  exit 1
fi
echo "bun.lock: in sync ✓"

# Read current version
CURRENT=$(jq -r .version package.json)
echo "Current version: $CURRENT"

# Calculate new version
if [[ -n "$REQUESTED" ]]; then
  NEW="$REQUESTED"
elif ! NEW=$(next_fork_version "$CURRENT"); then
  echo "Error: package.json version '$CURRENT' is neither an upstream base (X.Y.Z)" >&2
  echo "nor a fork version (X.Y.Z-$FORK_SUFFIX.N), so the next one cannot be computed." >&2
  exit 1
fi

DATE=$(date +%Y-%m-%d)
echo "New version:     $NEW"
echo ""

if git rev-parse -q --verify "refs/tags/v$NEW" >/dev/null; then
  echo "Error: tag v$NEW already exists" >&2
  exit 1
fi

# --- Validate CHANGELOG.md ---

if [[ ! -f CHANGELOG.md ]]; then
  echo "Error: CHANGELOG.md not found" >&2
  exit 1
fi

# The [Unreleased] section must have content
if ! grep -q "^## \[Unreleased\]" CHANGELOG.md; then
  echo "Error: no [Unreleased] section in CHANGELOG.md" >&2
  echo "" >&2
  echo "Add your changes under an [Unreleased] heading first:" >&2
  echo "" >&2
  echo "  ## [Unreleased]" >&2
  echo "" >&2
  echo "  ### Changes" >&2
  echo "  - Your change here" >&2
  exit 1
fi

# --- Preview release notes ---

echo "--- Release notes (will appear on GitHub) ---"
./scripts/extract-changelog.sh "$NEW"
echo "--- End ---"
echo ""

# --- Confirm ---

read -p "Release v$NEW? [y/N] " -n 1 -r
echo ""
[[ $REPLY =~ ^[Yy]$ ]] || { echo "Aborted."; exit 1; }

# --- Rename [Unreleased] -> [X.Y.Z] - date, add fresh [Unreleased] ---

perl -0pi -e 's/^## \[Unreleased\].*/## ['"$NEW"'] - '"$DATE"'/m' CHANGELOG.md

# Insert a new empty [Unreleased] section after the header
awk '
  /^## \['"$NEW"'\]/ && !done {
    print "## [Unreleased]\n"
    done = 1
  }
  { print }
' CHANGELOG.md > CHANGELOG.md.tmp && mv CHANGELOG.md.tmp CHANGELOG.md

# --- Bump version and commit ---

jq --arg v "$NEW" '.version = $v' package.json > package.json.tmp && mv package.json.tmp package.json

# Keep the Claude Code plugin version in lockstep with the package version.
# The plugin cache is keyed on this version: if it never changes, installed
# plugins never pick up skill updates shipped in this release. (sed, not jq,
# to preserve the file's formatting; the file has a single "version" key.)
# The grep guard fails the release if the stamp didn't land (a non-matching
# sed exits 0, which set -e would never catch).
sed 's/"version": "[^"]*"/"version": "'"$NEW"'"/' \
  .claude-plugin/marketplace.json > .claude-plugin/marketplace.json.tmp
grep -qF "\"version\": \"$NEW\"" .claude-plugin/marketplace.json.tmp
mv .claude-plugin/marketplace.json.tmp .claude-plugin/marketplace.json

git add package.json CHANGELOG.md .claude-plugin/marketplace.json
git commit -m "release: v$NEW"
git tag -a "v$NEW" -m "v$NEW"

echo ""
echo "Created commit and tag v$NEW"
echo ""
echo "Next: push to create the GitHub release (no registry publish)"
echo ""
echo "  git push origin main --tags"
