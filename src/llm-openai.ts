/**
 * OpenAI-compatible LLM backend.
 *
 * Implements the same `LLM` contract as `LlamaCpp`, but every operation is an
 * HTTP call instead of a local GGUF model. This exists because loading models
 * locally costs minutes per cold query on modest hardware — the models are
 * reloaded far more often than they are used — while the same work over an API
 * answers in well under a second and holds no RAM between calls.
 *
 * Works against any endpoint that speaks the OpenAI shape: OpenAI itself,
 * OpenRouter, Gemini's compatibility layer, Together, a local LiteLLM proxy.
 *
 * Reranking is the one operation with no standard in that shape. See `rerank()`.
 */

import type {
  EmbedOptions,
  EmbeddingResult,
  GenerateOptions,
  GenerateResult,
  LLM,
  ModelInfo,
  Queryable,
  QueryType,
  RerankDocument,
  RerankDocumentResult,
  RerankOptions,
  RerankResult,
} from "./llm.js";

export type OpenAICompatibleConfig = {
  /** Base URL including the version segment, e.g. https://openrouter.ai/api/v1 */
  baseUrl?: string;
  apiKey?: string;
  embedModel?: string;
  generateModel?: string;
  /**
   * Dedicated rerank endpoint. Voyage, Cohere and Jina expose one and all three
   * accept the same `{query, documents, model}` body; OpenAI-shaped routers do
   * not have one at all. Absent, `rerank()` degrades — see there.
   */
  rerankUrl?: string;
  /** Defaults to `apiKey` — separate only when reranking runs on another vendor. */
  rerankApiKey?: string;
  rerankModel?: string;
  requestTimeoutMs?: number;
};

const DEFAULT_TIMEOUT_MS = 30_000;

/** Which call could not be made. */
export type ProviderOperation = "embed" | "generate" | "rerank";

/** A provider call that did not happen, as opposed to one that found nothing. */
export type ProviderFailure = {
  operation: ProviderOperation;
  message: string;
};

/**
 * Provider failures seen since the process started.
 *
 * Every operation below answers `null` — or an empty list, or the unranked
 * order — when the provider cannot be reached. That is the right thing for a
 * caller mid-pipeline: one missing embedding should not abort an ingest of ten
 * thousand chunks. But it makes "the provider said there is nothing" and "the
 * provider was never asked" the same value, and by the time it reaches the top
 * of a search the difference is gone: an expired key produces an empty result
 * set that is indistinguishable from an honest miss, printed as `No results
 * found.` and exited 0.
 *
 * So the failure is recorded here as well as logged. Nothing in the pipeline
 * changes behaviour; the command at the top asks, once, whether the work it is
 * about to report on could actually be done.
 *
 * Module-level rather than per-instance because a command builds its clients
 * where it needs them and the question is asked in a different place entirely —
 * threading a channel through every construction site would be a larger change
 * for the same answer.
 */
let firstFailure: ProviderFailure | null = null;
let attempts = 0;

/**
 * Records a provider call that could not be made.
 *
 * The **first** is kept, not the last: later failures are usually consequences
 * of the same outage, and the first one names the cause.
 */
export function noteProviderFailure(operation: ProviderOperation, message: string): void {
  if (firstFailure === null) {
    firstFailure = { operation, message };
  }
}

/** The first provider failure since the last reset, if there was one. */
export function providerFailure(): ProviderFailure | null {
  return firstFailure;
}

/**
 * Whether the provider was called at all.
 *
 * Without it, "no failure recorded" is ambiguous: it also describes a run that
 * never asked. A health check reporting *reachable* on that basis would be
 * asserting something it did not test.
 */
export function providerAttempted(): boolean {
  return attempts > 0;
}

/** Forgets what has been recorded. For tests, and for a long-lived process. */
export function clearProviderFailures(): void {
  firstFailure = null;
  attempts = 0;
}

export class OpenAICompatible implements LLM {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly embedModel: string;
  private readonly generateModel: string;
  private readonly rerankUrl?: string;
  private readonly rerankApiKey?: string;
  private readonly rerankModel?: string;
  private readonly timeoutMs: number;

  constructor(config: OpenAICompatibleConfig = {}) {
    this.baseUrl = (config.baseUrl ?? process.env.QMD_OPENAI_BASE_URL ?? "https://api.openai.com/v1")
      .replace(/\/+$/, "");
    this.apiKey = config.apiKey ?? process.env.QMD_OPENAI_API_KEY ?? process.env.OPENAI_API_KEY ?? "";
    this.embedModel = config.embedModel ?? process.env.QMD_EMBED_MODEL ?? "text-embedding-3-small";
    this.generateModel = config.generateModel ?? process.env.QMD_GENERATE_MODEL ?? "openai/gpt-4o-mini";
    this.rerankUrl = config.rerankUrl ?? process.env.QMD_RERANK_URL;
    this.rerankApiKey = config.rerankApiKey ?? process.env.QMD_RERANK_API_KEY;
    this.rerankModel = config.rerankModel ?? process.env.QMD_RERANK_MODEL;
    this.timeoutMs = config.requestTimeoutMs ?? DEFAULT_TIMEOUT_MS;

    if (!this.apiKey) {
      throw new Error(
        "OpenAICompatible requires an API key: set QMD_OPENAI_API_KEY (or OPENAI_API_KEY).",
      );
    }
  }

  private async post(url: string, body: unknown, apiKey: string): Promise<any> {
    attempts++;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new Error(`${url} -> ${res.status}: ${detail.slice(0, 400)}`);
      }
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  }

  async embed(text: string, options: EmbedOptions = {}): Promise<EmbeddingResult | null> {
    const model = options.model ?? this.embedModel;
    // The title rides along with the content: a chunk carrying its document's
    // title is distinguishable from the same heading in another document.
    const input = options.title ? `${options.title}\n${text}` : text;
    try {
      const json = await this.post(`${this.baseUrl}/embeddings`, { model, input }, this.apiKey);
      const embedding = json?.data?.[0]?.embedding;
      if (!Array.isArray(embedding)) return null;
      return { embedding, model };
    } catch (err) {
      const message = (err as Error).message;
      console.error(`[openai] embed failed: ${message}`);
      noteProviderFailure("embed", message);
      return null;
    }
  }

  /**
   * Embed several texts in one request.
   *
   * Not part of the `LLM` contract, but the ingest path embeds thousands of
   * chunks and one request per chunk is what makes API providers refuse: the
   * rate limits that bite are per-request.
   */
  async embedBatch(texts: string[], options: EmbedOptions = {}): Promise<(EmbeddingResult | null)[]> {
    if (texts.length === 0) return [];
    const model = options.model ?? this.embedModel;
    try {
      const json = await this.post(`${this.baseUrl}/embeddings`, { model, input: texts }, this.apiKey);
      const rows: any[] = json?.data ?? [];
      // Providers are allowed to return out of order; `index` is authoritative.
      const byIndex = new Map<number, number[]>();
      for (const row of rows) {
        if (Array.isArray(row?.embedding)) byIndex.set(row.index ?? byIndex.size, row.embedding);
      }
      return texts.map((_, i) => {
        const embedding = byIndex.get(i);
        return embedding ? { embedding, model } : null;
      });
    } catch (err) {
      const message = (err as Error).message;
      console.error(`[openai] embedBatch failed: ${message}`);
      noteProviderFailure("embed", message);
      return texts.map(() => null);
    }
  }

  async generate(prompt: string, options: GenerateOptions = {}): Promise<GenerateResult | null> {
    const model = (options as any).model ?? this.generateModel;
    try {
      const json = await this.post(
        `${this.baseUrl}/chat/completions`,
        {
          model,
          messages: [{ role: "user", content: prompt }],
          temperature: (options as any).temperature ?? 0,
          max_tokens: (options as any).maxTokens ?? 512,
        },
        this.apiKey,
      );
      const text = json?.choices?.[0]?.message?.content;
      if (typeof text !== "string") return null;
      return { text, model, done: true };
    } catch (err) {
      const message = (err as Error).message;
      console.error(`[openai] generate failed: ${message}`);
      noteProviderFailure("generate", message);
      return null;
    }
  }

  /**
   * Remote models are not files on disk, so existence cannot be checked without
   * spending a request. Reported as present; a wrong name surfaces as a 404 on
   * first use, with the provider's own message.
   */
  async modelExists(model: string): Promise<ModelInfo> {
    return { name: model, exists: true };
  }

  async expandQuery(
    query: string,
    options: { context?: string; includeLexical?: boolean } = {},
  ): Promise<Queryable[]> {
    const includeLexical = options.includeLexical ?? true;
    const fallback: Queryable[] = includeLexical
      ? [{ type: "vec", text: query }, { type: "lex", text: query }]
      : [{ type: "vec", text: query }];

    const prompt =
      `Expand this search query into retrieval sub-queries.\n` +
      `Answer with one per line, in the form "type: text".\n` +
      `Valid types: lex (exact keywords), vec (semantic phrasing), hyde (a hypothetical answer passage).\n` +
      `No commentary.\n\nQuery: ${query}`;

    const result = await this.generate(prompt, {} as GenerateOptions);
    if (!result?.text) return fallback;

    const parsed: Queryable[] = [];
    for (const line of result.text.split("\n")) {
      const match = /^\s*(lex|vec|hyde)\s*:\s*(.+?)\s*$/i.exec(line);
      const rawType = match?.[1];
      const text = match?.[2];
      if (!rawType || !text) continue;
      const type = rawType.toLowerCase() as QueryType;
      if (!includeLexical && type === "lex") continue;
      parsed.push({ type, text });
    }
    // A model that answered in prose leaves nothing usable — the original query
    // retrieves better than a degenerate expansion.
    return parsed.length > 0 ? parsed : fallback;
  }

  /**
   * Rerank documents against the query.
   *
   * The OpenAI shape has no rerank endpoint. Two paths:
   *
   * - `rerankUrl` configured (Voyage, Cohere, Jina — all three take the same
   *   `{query, documents, model}` body): a real rerank.
   * - otherwise: the incoming order is preserved, with scores descending. This
   *   is a deliberate no-op rather than an error, because the retrieval order
   *   is already meaningful and reranking through a chat model costs a second
   *   round-trip per search to reorder what is usually already close.
   */
  async rerank(
    query: string,
    documents: RerankDocument[],
    options: RerankOptions = {},
  ): Promise<RerankResult> {
    const passthrough = (): RerankResult => ({
      results: documents.map((doc, index): RerankDocumentResult => ({
        file: doc.file,
        index,
        score: 1 - index / Math.max(documents.length, 1),
      })),
      model: "passthrough",
    });

    if (!this.rerankUrl || documents.length === 0) return passthrough();

    const model = options.model ?? this.rerankModel;
    try {
      const json = await this.post(
        this.rerankUrl,
        {
          query,
          documents: documents.map((doc) => (doc.title ? `${doc.title}\n${doc.text}` : doc.text)),
          ...(model ? { model } : {}),
        },
        this.rerankApiKey ?? this.apiKey,
      );
      const rows: any[] = json?.results ?? json?.data ?? [];
      if (rows.length === 0) return passthrough();
      return {
        results: rows
          .map((row): RerankDocumentResult | null => {
            const index = row?.index ?? row?.document_index;
            if (typeof index !== "number" || !documents[index]) return null;
            return {
              file: documents[index].file,
              index,
              score: row?.relevance_score ?? row?.score ?? 0,
            };
          })
          .filter((row): row is RerankDocumentResult => row !== null),
        model: model ?? "rerank",
      };
    } catch (err) {
      const message = (err as Error).message;
      console.error(`[openai] rerank failed, keeping retrieval order: ${message}`);
      // Recorded, though this one degrades honestly: the results are real, only
      // their order is the retrieval order rather than the reranked one.
      noteProviderFailure("rerank", message);
      return passthrough();
    }
  }

  get embedModelName(): string {
    return this.embedModel;
  }

  get generateModelName(): string {
    return this.generateModel;
  }

  get rerankModelName(): string {
    return this.rerankModel ?? "passthrough";
  }

  /**
   * Tokenise by Unicode code point.
   *
   * A remote provider exposes no tokeniser, and the only caller uses this to
   * keep chunks under a token ceiling. One code point per token overestimates
   * the real count by roughly four to one for Latin text, so chunks come out
   * smaller than the ceiling rather than larger — the safe direction to be
   * wrong in, and exactly reversible, which `detokenize` depends on.
   */
  async tokenize(text: string): Promise<readonly number[]> {
    return Array.from(text).map((ch) => ch.codePointAt(0) ?? 0);
  }

  async detokenize(tokens: readonly number[]): Promise<string> {
    return tokens.map((code) => String.fromCodePoint(code)).join("");
  }

  /** No local device is involved; `doctor` reports the absence rather than a lie. */
  async getDeviceInfo(_options: { allowBuild?: boolean } = {}): Promise<{
    gpu: string | false;
    gpuOffloading: boolean;
    gpuDevices: string[];
    vram?: { total: number; used: number; free: number };
    cpuCores: number;
  }> {
    return {
      gpu: false,
      gpuOffloading: false,
      gpuDevices: [],
      cpuCores: 0,
    };
  }

  /** Nothing is held between calls, so there is nothing to release. */
  async dispose(): Promise<void> {}
}

/**
 * True when the store should talk to an API instead of loading local models.
 * Presence of a base URL is the switch: configuring one is the intent.
 */
export function isOpenAIBackendConfigured(): boolean {
  return Boolean(
    process.env.QMD_OPENAI_BASE_URL &&
      (process.env.QMD_OPENAI_API_KEY || process.env.OPENAI_API_KEY),
  );
}
