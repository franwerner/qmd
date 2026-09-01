# EDR — test/cli-contract.test.ts pins the CLI contract's key sets and byte-identical text, additive-tolerant

- **Status:** Accepted
- **Date:** 2026-09-01

## Contexto
The five --format json payloads need a regression net against dropped or renamed fields, and the human-readable text output of status/collection list/collection show/--version had none: today's assertions in test/cli.test.ts (:925, :2474, :2500) are all toContain, so the collector/renderer split had nothing to catch an unintended text change.

## Decisión
A new test/cli-contract.test.ts, spawned via the runQmd pattern reproduced from test/cli.test.ts:43. Key-set assertions check every expected dotted path is present with the expected type and tolerate extra keys, so additive payload evolution never fails the suite. The same file adds normalized text snapshots — the absolute index path, the byte size and the relative-time strings replaced with placeholders, the rest pinned verbatim — landed and passing before the collector/renderer split.

## Reglas verificables
- **[auto]** `npx vitest run test/cli-contract.test.ts` and `bun test test/cli-contract.test.ts` both fail on any unintended text change to the status/collection list/collection show/--version output
- **[manual]** key-set assertions for the five payloads tolerate extra keys and fail on a dropped or renamed one

## Alternativas consideradas
Extracting the runQmd spawn helper out of test/cli.test.ts into a shared module was considered and rejected: that is a 1500-line file this change was not asked to touch, and duplicating the ~40-line helper locally is cheaper than that refactor.

## Consecuencias
Two copies of the runQmd spawn helper now exist (test/cli.test.ts and test/cli-contract.test.ts); a change to how the CLI is spawned for tests has to be made in both places.
