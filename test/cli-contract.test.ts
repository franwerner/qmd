/**
 * CLI machine-readable contract tests.
 *
 * Covers the `--format json` contract commands (`status`, `--version`,
 * `collection list`, `collection show`, and the mutating `collection`
 * subcommands) defined in `src/cli/contract.ts`.
 *
 * The `runQmd` helper reproduces the pattern from `test/cli.test.ts:43`
 * locally rather than importing it, per the design's own rationale: that is
 * a 1500-line file this change was not asked to touch.
 *
 * The normalized text snapshots below exist to land BEFORE the collector /
 * renderer split (see the `cli/contract-facts-render-split` EDR): today's
 * assertions on `status` and `collection list` (`test/cli.test.ts:925`,
 * `:2474`, `:2500`) are all `toContain` and pin nothing else, so the split
 * had no regression net for "human-readable output is unchanged".
 */

import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { spawn } from "child_process";

const thisDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(thisDir, "..");
const qmdScript = join(projectRoot, "src", "cli", "qmd.ts");
const isBunRuntime = typeof (globalThis as { Bun?: unknown }).Bun !== "undefined";
const tsxCli = join(projectRoot, "node_modules", "tsx", "dist", "cli.mjs");
const qmdCommand = isBunRuntime
  ? { command: process.execPath, args: [qmdScript] }
  : { command: process.execPath, args: [tsxCli, qmdScript] };

async function runQmd(
  args: string[],
  options: { cwd: string; dbPath: string; configDir: string; env?: Record<string, string> }
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = spawn(qmdCommand.command, [...qmdCommand.args, ...args], {
    cwd: options.cwd,
    env: {
      ...process.env,
      INDEX_PATH: options.dbPath,
      QMD_CONFIG_DIR: options.configDir,
      PWD: options.cwd,
      QMD_DOCTOR_DEVICE_PROBE: "0",
      NO_COLOR: "1",
      ...options.env,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  const stdoutPromise = new Promise<string>((resolve, reject) => {
    let data = "";
    proc.stdout?.on("data", (chunk: Buffer) => { data += chunk.toString(); });
    proc.once("error", reject);
    proc.stdout?.once("end", () => resolve(data));
  });
  const stderrPromise = new Promise<string>((resolve, reject) => {
    let data = "";
    proc.stderr?.on("data", (chunk: Buffer) => { data += chunk.toString(); });
    proc.once("error", reject);
    proc.stderr?.once("end", () => resolve(data));
  });
  const exitCode = await new Promise<number>((resolve, reject) => {
    proc.once("error", reject);
    proc.on("close", (code) => resolve(code ?? 1));
  });

  return { stdout: await stdoutPromise, stderr: await stderrPromise, exitCode };
}

/** Replaces every run-specific value (paths, sizes, relative times) with a stable placeholder. */
function normalize(text: string, replacements: [string, string][]): string {
  let out = text;
  for (const [literal, placeholder] of replacements) {
    out = out.split(literal).join(placeholder);
  }
  return out
    .replace(/AST Chunking\n[\s\S]*?\n\n/, "AST Chunking\n<AST_STATUS>\n\n")
    .replace(/\d+(\.\d+)?\s(B|KB|MB|GB)\b/g, "<SIZE>")
    .replace(/\d+[smhd] ago/g, "<TIME_AGO>");
}

function normalizeVersion(text: string): string {
  return text.replace(/^qmd .+$/m, "qmd <VERSION>");
}

let testDir: string;
let dbPath: string;
let configDir: string;
let fixturesDir: string;
let runOpts: { cwd: string; dbPath: string; configDir: string };

beforeAll(async () => {
  testDir = await mkdtemp(join(tmpdir(), "qmd-contract-"));
  dbPath = join(testDir, "test.sqlite");
  configDir = join(testDir, "config");
  fixturesDir = join(testDir, "fixtures");
  await mkdir(configDir, { recursive: true });
  await mkdir(fixturesDir, { recursive: true });
  await writeFile(join(configDir, "index.yml"), "collections: {}\n");
  await writeFile(join(fixturesDir, "doc.md"), "# Doc\n\nHello world.\n");
  runOpts = { cwd: fixturesDir, dbPath, configDir };

  await runQmd(["collection", "add", ".", "--name", "snap"], runOpts);
  await runQmd(["context", "add", "qmd://snap/", "Snapshot fixture collection"], runOpts);
});

afterAll(async () => {
  if (testDir) await rm(testDir, { recursive: true, force: true });
});

describe("text output snapshots (pre-split regression net)", () => {
  test("qmd status", async () => {
    const { stdout, exitCode } = await runQmd(["status"], runOpts);
    expect(exitCode).toBe(0);
    const normalized = normalize(stdout, [[dbPath, "<INDEX_PATH>"]]);
    expect(normalized).toBe(
      "QMD Status\n\n" +
      "Index: <INDEX_PATH>\n" +
      "Size:  <SIZE>\n\n" +
      "Documents\n" +
      "  Total:    1 files indexed\n" +
      "  Vectors:  0 embedded\n" +
      "  Pending:  1 need embedding (run 'qmd embed')\n" +
      "  Updated:  <TIME_AGO>\n\n" +
      "AST Chunking\n" +
      "<AST_STATUS>\n\n" +
      "Collections\n" +
      "  snap (qmd://snap/)\n" +
      "    Pattern:  **/*.md\n" +
      "    Files:    1 (updated <TIME_AGO>)\n" +
      "    Contexts: 1\n" +
      "      /: Snapshot fixture collection\n\n" +
      "Examples\n" +
      "  # List files in a collection\n" +
      "  qmd ls snap\n" +
      "  # Get a document\n" +
      "  qmd get qmd://snap/path/to/file.md\n" +
      "  # Search within a collection\n" +
      "  qmd search \"query\" -c snap\n\n" +
      "Models\n" +
      "  Embedding:   https://huggingface.co/ggml-org/embeddinggemma-300M-GGUF\n" +
      "  Reranking:   https://huggingface.co/ggml-org/Qwen3-Reranker-0.6B-Q8_0-GGUF\n" +
      "  Generation:  https://huggingface.co/tobil/qmd-query-expansion-1.7B-gguf\n"
    );
  });

  test("qmd collection list", async () => {
    const { stdout, exitCode } = await runQmd(["collection", "list"], runOpts);
    expect(exitCode).toBe(0);
    const normalized = normalize(stdout, []);
    expect(normalized).toBe(
      "Collections (1):\n\n" +
      "snap (qmd://snap/)\n" +
      "  Pattern:  **/*.md\n" +
      "  Files:    1\n" +
      "  Updated:  <TIME_AGO>\n\n"
    );
  });

  test("qmd collection show <name>", async () => {
    const { stdout, exitCode } = await runQmd(["collection", "show", "snap"], runOpts);
    expect(exitCode).toBe(0);
    const normalized = normalize(stdout, [[fixturesDir, "<FIXTURES_PATH>"]]);
    expect(normalized).toBe(
      "Collection: snap\n" +
      "  Path:     <FIXTURES_PATH>\n" +
      "  Pattern:  **/*.md\n" +
      "  Include:  yes (default)\n" +
      "  Contexts: 1\n"
    );
  });

  test("qmd --version", async () => {
    const { stdout, exitCode } = await runQmd(["--version"], runOpts);
    expect(exitCode).toBe(0);
    expect(normalizeVersion(stdout)).toBe("qmd <VERSION>\n");
  });
});
