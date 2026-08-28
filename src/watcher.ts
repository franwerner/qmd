/**
 * Watches the configured collections and re-indexes what changed.
 *
 * Without this, the index is only as fresh as the last manual `qmd update`, and
 * the gap is worst exactly where it hurts: a record written mid-flow is invisible
 * to whatever runs next, and nothing signals the absence — the search simply
 * returns without it.
 *
 * Re-indexing is content-hash based, so a pass over unchanged files embeds
 * nothing and costs nothing. Only the files whose bytes moved are re-embedded.
 */

import { watch, type FSWatcher } from "node:fs";
import { existsSync } from "node:fs";
import { extname } from "node:path";
/**
 * What the watcher needs from a store, declared structurally: it re-indexes and
 * embeds, and it asks which collections exist. Naming a concrete store type
 * here would tie the watcher to whichever one the caller happens to hold.
 */
export type WatchableStore = {
  listCollections(): Promise<{ name: string; pwd: string }[]>;
  update(opts: { collections: string[] }): Promise<{ indexed: number; updated: number; removed: number }>;
  embed(opts: { collection: string }): Promise<{ chunksEmbedded: number; errors: number }>;
  /**
   * Drops the vectors no active document references any more, returning how
   * many went. Not only deletions produce them: the index is keyed by content
   * hash, so every edit retires the previous version's hash and strands its
   * vectors. Editing is constant, so without this the strays only accumulate.
   */
  cleanup(): Promise<number>;
};

export type WatcherOptions = {
  /**
   * Quiet period after the last change before re-indexing. An editor writes a
   * file several times per save, and a `git checkout` rewrites hundreds at
   * once; without this the watcher would re-index on every one of them.
   */
  debounceMs?: number;
  /** Called after each re-index pass, for logging. */
  onIndexed?: (info: {
    collection: string;
    indexed: number;
    updated: number;
    removed: number;
    chunksEmbedded: number;
    orphansCleaned: number;
    errors: number;
  }) => void;
  onError?: (collection: string, error: Error) => void;
};

const DEFAULT_DEBOUNCE_MS = 2000;

/** Only text worth indexing triggers a pass — not the editor's swap files. */
function isIndexable(filename: string | null): boolean {
  if (!filename) return false;
  const base = filename.split("/").pop() ?? filename;
  if (base.startsWith(".") || base.endsWith("~")) return false;
  return extname(base).toLowerCase() === ".md";
}

export type Watcher = {
  /** Stop watching and drop every pending pass. */
  close(): void;
  /** Collections currently under watch. */
  readonly collections: readonly string[];
};

export async function startWatcher(
  store: WatchableStore,
  options: WatcherOptions = {},
): Promise<Watcher> {
  const debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  const watchers: FSWatcher[] = [];
  const timers = new Map<string, NodeJS.Timeout>();
  // A pass takes seconds; changes landing meanwhile must not start a second one
  // on the same collection, or two writers race on the same vectors.
  const running = new Set<string>();
  const queued = new Set<string>();
  const watched: string[] = [];

  const runPass = async (name: string): Promise<void> => {
    if (running.has(name)) {
      queued.add(name);
      return;
    }
    running.add(name);
    try {
      const reindexed = await store.update({ collections: [name] });
      const embedded = await store.embed({ collection: name });
      // Last, and once: reindexing is what strands vectors and embedding is
      // what creates the ones worth keeping, so anything left over after both
      // is genuinely unreferenced. Cheap when there is nothing — it counts
      // first and returns.
      const orphansCleaned = await store.cleanup();
      options.onIndexed?.({
        collection: name,
        indexed: reindexed?.indexed ?? 0,
        updated: reindexed?.updated ?? 0,
        removed: reindexed?.removed ?? 0,
        chunksEmbedded: embedded?.chunksEmbedded ?? 0,
        orphansCleaned: orphansCleaned ?? 0,
        errors: embedded?.errors ?? 0,
      });
    } catch (err) {
      options.onError?.(name, err as Error);
    } finally {
      running.delete(name);
      if (queued.delete(name)) void runPass(name);
    }
  };

  const schedule = (name: string): void => {
    const pending = timers.get(name);
    if (pending) clearTimeout(pending);
    timers.set(
      name,
      setTimeout(() => {
        timers.delete(name);
        void runPass(name);
      }, debounceMs),
    );
  };

  for (const col of await store.listCollections()) {
    if (!existsSync(col.pwd)) continue;
    try {
      const w = watch(col.pwd, { recursive: true }, (_event, filename) => {
        if (isIndexable(filename)) schedule(col.name);
      });
      watchers.push(w);
      watched.push(col.name);
    } catch (err) {
      // A collection that cannot be watched is reported and skipped: the rest
      // of the watcher still works, and a silent failure here would look
      // exactly like "nothing changed".
      options.onError?.(col.name, err as Error);
    }
  }

  return {
    close() {
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
      for (const w of watchers) w.close();
    },
    get collections() {
      return watched;
    },
  };
}
