---
name: release
description: Manage releases for this project. Validates changelog, installs git hooks, and cuts releases. Use when user says "/release", "cut a release", or asks about the release process. NOT auto-invoked by the model.
disable-model-invocation: true
---

# Release

Cut a release, validate the changelog, and ensure git hooks are installed.

## Versions in this fork

This is a fork of upstream `tobi/qmd` and publishes to **no registry**. A
release is a git tag plus the GitHub release the `v*` tag triggers, which
carries the packed tarball (`npm pack`) as its asset. That tarball's URL is the
install path.

Do not document the git URL as installable. npm runs a git dependency's
`prepare` inside a clone that has no `node_modules`, so `scripts/build.mjs`
cannot resolve `tsc` and the install dies — declaring `typescript` in either
`dependencies` or `devDependencies` does not help, because nothing is installed
at that point. Installing a tarball runs no `prepare`, so the `dist/` packed
inside it is used as-is.

Versions are `<upstream-base>-mate.N`:

- The base (`X.Y.Z`) is whatever upstream release this fork sits on. It is not
  ours to bump — it moves only when a rebase brings in a new upstream version,
  and `patch`/`minor`/`major` are rejected for exactly that reason.
- The counter increments per fork release and **resets to `.1` whenever the base
  changes**, which falls out of reading the base from `package.json`: a bare
  `2.9.0` left there by a rebase yields `2.9.0-mate.1`.
- When resolving the `package.json` version conflict during such a rebase, take
  upstream's bare version.

## Usage

`/release` — takes the next fork version automatically. `/release 2.9.0-mate.1`
to name one explicitly.

## Process

When the user triggers `/release`:

1. **Gather context** — run `skills/release/scripts/release-context.sh` (with the
   explicit version, if one was given).
   This silently installs git hooks and prints everything needed: version info,
   working directory status, commits since last release, files changed, current
   `[Unreleased]` content, and the previous release entry for style reference.

2. **Commit outstanding work** — if the context shows staged, modified, or
   untracked files that belong in this release, commit them first. Use the
   /commit skill or make well-formed commits directly.

3. **Write the changelog** — if `[Unreleased]` is empty, write it now using
   the commits and file changes from the context output. Follow the changelog
   standard below. Re-run the context script after committing if needed.

4. **Check dependency updates** — before cutting the release, check for
   updates to `sqlite-vec` (and platform packages), `node-llama-cpp`,
   and `better-sqlite3`. Run `pnpm outdated` and report any available
   updates for these packages. If updates exist, bump them (pinned, no
   `^` ranges) and re-run tests before proceeding.

5. **Cut the release** — run `scripts/release.sh` (or `scripts/release.sh
   <version>` for an explicit one). This renames
   `[Unreleased]` → `[X.Y.Z] - date`, inserts a fresh `[Unreleased]`,
   bumps `package.json` and the plugin version in
   `.claude-plugin/marketplace.json` (so installed plugins see the update),
   commits, and tags.

6. **Show the final changelog** — print the full `[Unreleased]` +
   fork series rollup via `scripts/extract-changelog.sh <version>`.
   Ask the user to confirm before pushing.

7. **Push** — after explicit confirmation, run `git push origin main --tags`.

8. **Watch CI** — after the push, start a background dispatch to watch the
   release workflow. Use `interactive_shell` in dispatch mode with:
   ```
   gh run watch $(gh run list --workflow=publish.yml --limit=1 --json databaseId --jq '.[0].databaseId') --exit-status
   ```
   The agent will be notified when CI completes and should report the result.

If any step fails, stop and explain. Never force-push or skip validation.

## Dependency Policy

All dependencies must be pinned to exact versions (no `^` or `~` ranges).
The lockfile ensures reproducible installs. When adding or updating any
dependency, always use the exact version string (e.g. `"3.18.1"` not
`"^3.18.1"`).

## Changelog Standard

The changelog lives in `CHANGELOG.md` and follows [Keep a Changelog](https://keepachangelog.com/) conventions.

### Heading format

- `## [Unreleased]` — accumulates entries between releases
- `## [X.Y.Z] - YYYY-MM-DD` — released versions

### Structure of a release entry

Each version entry has two parts:

**1. Highlights (optional, 1-4 sentences of prose)**

Immediately after the version heading, before any `###` section. The elevator
pitch — what would you tell someone in 30 seconds? Only for significant
releases; skip for small patches.

```markdown
## [1.1.0] - 2026-03-01

QMD now runs on both Node.js and Bun, with up to 2.7x faster reranking
through parallel contexts. GPU auto-detection replaces the unreliable
`gpu: "auto"` with explicit CUDA/Metal/Vulkan probing.
```

**2. Detailed changelog (`### Changes` and `### Fixes`)**

```markdown
### Changes

- Runtime: support Node.js (>=22) alongside Bun. The `qmd` wrapper
  auto-detects a suitable install via PATH. #149 (thanks @igrigorik)
- Performance: parallel embedding & reranking — up to 2.7x faster on
  multi-core machines.

### Fixes

- Prevent VRAM waste from duplicate context creation during concurrent
  `embedBatch` calls. #152 (thanks @jkrems)
```

### Writing guidelines

- **Explain the why, not just the what.** The changelog is for users.
- **Include numbers.** "2.7x faster", "17x less memory".
- **Group by theme, not by file.** "Performance" not "Changes to llm.ts".
- **Don't list every commit.** Aggregate related changes.
- **Credit contributors:** end bullets with `#NNN (thanks @username)` for
  external PRs. No need to credit the repo owner.

### What not to include

- Internal refactors with no user-visible effect
- Dependency bumps (unless fixing a user-facing bug)
- CI/tooling changes (unless affecting the release artifact)
- Test additions (unless validating a fix worth mentioning)

## GitHub Release Notes

Each GitHub release includes the full changelog for this fork's run on the
current upstream base — `2.8.3-mate.1` through `2.8.3-mate.N` — and **not**
upstream's own `[2.8.3]` entry. Since the counter resets with every new base,
the notes describe exactly what this fork added on top of the base it ships.
`scripts/extract-changelog.sh` handles this, and the release workflow
(`publish.yml`) calls it to populate the GitHub release.

Releases are created with `--latest`. Every fork version carries a `-mate.N`
suffix, which GitHub reads as a semver prerelease; without the flag the
repository would permanently show no latest release, which is the one thing
people are pointed at to install.

The release also carries `tobilu-qmd-<version>.tgz`, built by `npm pack` in the
workflow. After cutting a release, update the install URL in `README.md` — it
names the version, so it goes stale on every cut.

## Git Hooks

The pre-push hook (`scripts/pre-push`) blocks `v*` tag pushes unless:

1. `package.json` version matches the tag
2. `CHANGELOG.md` has a `## [X.Y.Z] - date` entry for the version
3. CI passed on GitHub (warns in non-interactive shells, blocks in terminals)

Hooks are installed silently by the context script. They can also be installed
manually via `skills/release/scripts/install-hooks.sh` or automatically via
`bun install` (prepare script).
