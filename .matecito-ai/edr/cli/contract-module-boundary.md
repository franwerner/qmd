# EDR — Contract types and emitter live in src/cli/contract.ts; collectors and renderers stay in qmd.ts

- **Status:** Accepted
- **Date:** 2026-09-01

## Contexto
The five machine-readable payload shapes and their JSON emitter need a home separate from src/cli/qmd.ts (a 5000+ line file with module-scope side effects in its isMain guard), while the fact collectors that build those payloads need three qmd.ts-local helpers: mcpDaemonPaths, resolveModelsForCli, resolveEmbedModelForCli.

## Decisión
A new src/cli/contract.ts carries CONTRACT_SCHEMA_VERSION, the five payload types, and emitContract(), and imports nothing from qmd.ts. The fact collectors, text renderers and payload projections for each contract command stay in src/cli/qmd.ts, each immediately above the command it serves.

## Reglas verificables
- **[auto]** src/cli/contract.ts imports nothing from ./qmd.js — `tsc -p tsconfig.build.json --noEmit` passes with contract.ts standalone
- **[manual]** the collector/renderer/projection functions for status, --version and collection list/show live in src/cli/qmd.ts, not in contract.ts

## Alternativas consideradas
A full src/cli/status-facts.ts (or similar) that also owns the collectors was considered and rejected: the collectors need mcpDaemonPaths (qmd.ts:219), resolveModelsForCli (:2187) and resolveEmbedModelForCli (:2175); moving the collectors out means either relocating those three helpers too or creating a qmd.ts <-> module import cycle, in a file whose top-level isMain block has side effects.

## Consecuencias
Splitting types from behavior matches what src/cli/formatter.ts and src/cli/version.ts already do in this codebase; splitting behavior out of qmd.ts does not, so this stays a partial extraction rather than a full one.
