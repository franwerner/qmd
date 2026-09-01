# EDR — No-build-install check runs as its own CI job, kept out of the tarball

- **Status:** Accepted
- **Date:** 2026-09-01

## Contexto
The published tarball must install and run on a consumer machine with no build step and no devDependencies, per this project's release/distribution guarantees. Nothing currently proves that in CI: ci.yml runs vitest/bun test directly, never through npm test, so the existing package-smoke check (which also builds and runs a compiled CLI) never executes in CI at all.

## Decisión
A new, standalone script (scripts/tarball-install-smoke.mjs) is run by a new install-smoke job in ci.yml only. It is not folded into the existing package-smoke.mjs script, and it is not run from publish.yml.

## Reglas verificables
- **[auto]** .github/workflows/ci.yml declares an install-smoke job that runs `node scripts/tarball-install-smoke.mjs`, pinned by test/package.test.ts
- **[manual]** scripts/tarball-install-smoke.mjs is not listed in package.json's files[]
- **[manual]** scripts/package-smoke.mjs and test/smoke-install.sh are left unmodified by this check

## Alternativas consideradas
Extending scripts/package-smoke.mjs was considered, but that script ships inside the published tarball (package.json's files[]), so a pack-and-install routine does not belong there; and it is not run by CI today at all — only through scripts/test-all.mjs locally — so extending it would still require a new CI step, while doubling the build cost of every local npm test (npm pack re-runs prepare). Running the job from publish.yml was also considered and rejected: ci.yml does not fire on tag pushes, and a v* tag is always cut from a main this job has already gated.

## Consecuencias
Every CI run (push/PR to main) now also packs, installs into a scratch target, and runs the CLI, adding wall-clock time bounded by whether the native dependencies publish prebuilds for the runner's Node version. The job uses Node 24 to match publish.yml's own build environment.
