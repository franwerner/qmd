# EDR — The no-build-install check asserts both a static manifest guarantee and a real install

- **Status:** Accepted
- **Date:** 2026-09-01

## Contexto
A tarball-install check that only installs and runs the CLI cannot, by itself, catch a future install-time build: an ubuntu-latest runner already carries a compiler toolchain, so a postinstall script that shells out to it would succeed and the check would pass for the wrong reason.

## Decisión
The check asserts two things: (1) the packed manifest declares none of preinstall, install, or postinstall — deterministic regardless of what the runner has installed; and (2) the tarball really installs, with devDependencies omitted and without --ignore-scripts, into a scratch target under os.tmpdir() (outside the repository tree, so Node's module resolution can never fall back to the repo's own node_modules), then the installed binary is run and must exit 0.

## Reglas verificables
- **[auto]** `node scripts/tarball-install-smoke.mjs` fails when the packed package.json declares preinstall, install, or postinstall
- **[auto]** `node scripts/tarball-install-smoke.mjs` fails when the installed CLI does not run successfully after a --omit=dev install into an os.tmpdir() scratch directory
- **[manual]** the install step never passes --ignore-scripts, so better-sqlite3's own install script (which fetches its prebuild) still runs

## Alternativas consideradas
Installing and running alone, without the static manifest check, was rejected: it cannot satisfy the 'a future install-time build is caught' scenario on a runner that already has a compiler available. Suppressing lifecycle scripts entirely with --ignore-scripts was rejected too, since better-sqlite3's own install script is what fetches its prebuild, and suppressing it would fail for a reason unrelated to the guarantee.

## Consecuencias
Any future install-time lifecycle script — even a legitimate one — becomes a CI failure by construction; that is the guarantee, stated as a mechanical cost rather than mitigated.
