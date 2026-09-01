# EDR — Facts collector, then text renderer or payload projection, with reads hoisted ahead of printing

- **Status:** Accepted
- **Date:** 2026-09-01

## Contexto
Each contract command (status, --version, collection list, collection show) needs both its existing text output and a new --format json branch. Building the payload from a second, independent read of the same data would let the two copies drift, and the spec's payload differences (raw model URIs, untruncated context text, lastModified: null instead of 'never') are exactly what the text view's own formatting transforms hide.

## Decisión
Each command splits into three named functions: collect*Facts() does every read and returns raw values only; render*Text(facts) owns every formatting transform the text view applies today (formatBytes, formatTimeAgo, hfLink, the 60-character context truncation, the [excluded] tag, the last_modified ?? new Date() fallback) and nothing else; *Payload(facts) is an explicit object-literal projection typed as the ratified contract type. This moves every read ahead of all printing, which is what makes the payload differences fall out for free -- but it also means the one mutating side effect in status (the stale-MCP-PID unlinkSync) now runs before the first printed line instead of after 'Index:'/'Size:'.

## Reglas verificables
- **[auto]** test/cli-contract.test.ts's normalized text snapshots pin that status, collection list, collection show and --version text output is byte-identical to before the split
- **[manual]** a collect*Facts() function performs every read for its command and returns only raw values -- no console.log, no formatting transform
- **[manual]** a render*Text(facts) function performs no reads -- only console.log calls and formatting transforms over already-collected facts

## Alternativas consideradas
An incremental sink/visitor -- the collector calls a renderer callback as each fact is computed, so the exact interleaving of side effects and printed output survives and the JSON sink is a no-op that assembles the payload at the end -- was considered: it satisfies the spec's ordering clause literally, at the cost of a callback-shaped API this codebase uses nowhere. A second, independent JSON code path duplicating the computation was also considered and rejected: that is the drift the whole split exists to avoid.

## Consecuencias
The printed bytes and the filesystem end state are identical to before the split (confirmed by the byte-identical snapshot suite), and every scenario under the spec's 'Human-readable output is unchanged' requirement still holds. What is NOT literally true anymore is that requirement's own prose about side effects preserving 'their ordering relative to the output' -- status's stale-PID cleanup moves earlier. This departure was raised for ratification at the design gate rather than absorbed silently.
