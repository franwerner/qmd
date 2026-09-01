# Release Contract

What this fork promises to external consumers about every published release
and CLI invocation. Four guarantees; each states what it promises and what it
explicitly does not.

## 1. Version-independent release asset

Every release carries an asset named exactly `qmd.tgz`, byte-identical to
that release's packed tarball, so that

```
https://github.com/franwerner/qmd/releases/latest/download/qmd.tgz
```

always resolves to the newest release without naming a version. The release
also keeps the version-named asset (`tobilu-qmd-<version>.tgz`), so a URL
already published for a past version stays valid.

**Does not promise**: that this URL has ever pointed anywhere before the
first release cut after this guarantee shipped. Releases published earlier do
not carry `qmd.tgz` — the stable URL starts working from the next tag push
onward, not retroactively.

## 2. Deterministic "latest" marking

Every release is marked as GitHub's latest release, and is never published as
a prerelease or a draft — notwithstanding that this fork's `-mate.N` version
suffix (e.g. `2.8.3-mate.6`) is what GitHub's own semver detection would
otherwise read as a prerelease. The release step passes `--latest` explicitly
to override that auto-detection; it never passes `--prerelease` or `--draft`.

**Does not promise**: that removing the `--latest` flag from a future edit of
the release workflow would be caught automatically. The flag is the whole
mechanism — its absence is a silent contract break, not a build failure.

## 3. No-build install

The published `qmd.tgz` installs and runs with no new build step introduced
by this package, and with `devDependencies` absent. CI packs the tarball,
installs it into a scratch target outside the repository with
`--omit=dev`, and runs the installed CLI on every push.

**Does not promise**: that no dependency of this package ever compiles.
`better-sqlite3` and `node-llama-cpp` may still fetch or build a native
binding as part of an ordinary `npm install`, exactly as they do today — that
is normal dependency installation, not a build step this package introduces.
The guarantee is scoped to *this package's own* install-time scripts
(`preinstall`/`install`/`postinstall`): none may exist, and CI fails the
release if one is added.

## 4. Machine-readable CLI contract

`qmd status`, `qmd --version`, `qmd collection list`, `qmd collection show`
(alias `info`), and the six mutating `collection` subcommands (`add`,
`remove`/`rm`, `rename`/`mv`, `update-cmd`/`set-update`, `include`,
`exclude`) each emit a single parseable JSON document on stdout when passed
`--format json`. Every payload carries a top-level `schemaVersion` integer,
currently `1`; it changes only on a non-additive change to that payload's
field set (a field removed, renamed, or retyped) — a field being added never
bumps it. The exact field set of each payload is pinned by tests.

**Does not promise**: that the human-readable (default) text output is
stable. Wording, column widths, colors, and ordering of the non-`--format
json` output may change at any time without notice — only the JSON shape
under `--format json` is the contract.
