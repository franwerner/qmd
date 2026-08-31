/**
 * A provider that cannot be reached must not look like a search that found
 * nothing.
 *
 * Every operation in the OpenAI-compatible backend answers `null` when the
 * provider is unreachable, which is right for a caller mid-pipeline — one
 * missing embedding should not abort an ingest of ten thousand chunks. But it
 * made "the provider said there is nothing" and "the provider was never asked"
 * the same value, and at the top of a search the difference was gone: an
 * expired key printed `No results found.` and exited 0, which is
 * indistinguishable from an honest miss and therefore believed.
 */
import { describe, expect, test, beforeEach } from "vitest";
import {
  clearProviderFailures,
  noteProviderFailure,
  providerAttempted,
  providerFailure,
} from "../src/llm-openai.js";

describe("provider failure recording", () => {
  beforeEach(() => {
    clearProviderFailures();
  });

  test("nothing is claimed before anything is asked", () => {
    expect(providerFailure()).toBeNull();
    expect(providerAttempted()).toBe(false);
  });

  test("a failure is recorded with the operation that could not be made", () => {
    noteProviderFailure("embed", "401: User not found.");

    expect(providerFailure()).toEqual({
      operation: "embed",
      message: "401: User not found.",
    });
  });

  // Later failures are usually consequences of the same outage; the first one
  // names the cause, and that is what a person needs to act on.
  test("the first failure is kept, not the last", () => {
    noteProviderFailure("embed", "the cause");
    noteProviderFailure("generate", "a consequence");
    noteProviderFailure("rerank", "another consequence");

    expect(providerFailure()).toEqual({ operation: "embed", message: "the cause" });
  });

  test("clearing forgets both the failure and the attempts", () => {
    noteProviderFailure("embed", "gone after this");
    clearProviderFailures();

    expect(providerFailure()).toBeNull();
    expect(providerAttempted()).toBe(false);
  });
});
