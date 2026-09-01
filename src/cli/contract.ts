/**
 * contract.ts - The machine-readable `--format json` contract for qmd's CLI.
 *
 * Payload shapes are the stable surface external consumers may depend on;
 * human-readable text output is NOT part of this contract and stays free to
 * change. See docs/RELEASE-CONTRACT.md.
 *
 * Imports nothing from qmd.ts, so it can be imported for its types alone
 * without pulling in the CLI's own module-scope side effects.
 */

export const CONTRACT_SCHEMA_VERSION = 1;

type WithSchema<T> = { schemaVersion: number } & T;

export type StatusPayload = WithSchema<{
  index: { path: string; sizeBytes: number };
  mcp: { running: boolean; pid: number | null };
  documents: {
    total: number;
    vectors: number;
    orphanedVectors: number;
    pendingEmbedding: number;
    lastModified: string | null;
  };
  ast: {
    available: boolean;
    languages: { language: string; available: boolean; error: string | null }[];
  };
  collections: {
    name: string;
    globPattern: string;
    fileCount: number;
    lastModified: string | null;
    contexts: { pathPrefix: string; context: string }[];
  }[];
  models: { embed: string; rerank: string; generate: string };
}>;

export type VersionPayload = WithSchema<{ version: string; commit: string | null }>;

export type CollectionListPayload = WithSchema<{
  collections: {
    name: string;
    globPattern: string;
    ignore: string[];
    fileCount: number;
    lastModified: string | null;
    includeByDefault: boolean;
  }[];
}>;

export type CollectionShowPayload = WithSchema<{
  name: string;
  path: string;
  pattern: string;
  ignore: string[];
  includeByDefault: boolean;
  update: string | null;
  contextCount: number;
}>;

export type CollectionAckPayload = WithSchema<{
  command: string;
  collection: string;
  ok: boolean;
  message: string;
}>;

/** Prints one JSON document to stdout, prefixed with the contract's schema version. */
export function emitContract(body: object): void {
  console.log(JSON.stringify({ schemaVersion: CONTRACT_SCHEMA_VERSION, ...body }, null, 2));
}
