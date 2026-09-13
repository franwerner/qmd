/**
 * CLI machine-readable contract tests.
 *
 * Covers the `--format json` contract commands (`status`, `capabilities`,
 * `--version`, `collection list`, `collection show`, and the mutating
 * `collection` subcommands) defined in `src/cli/contract.ts`.
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
import { mkdtemp, mkdir, writeFile, readFile, rm, chmod, readdir } from "fs/promises";
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

/** Parses stdout as the contract's single JSON document, asserting no ANSI escapes leaked in alongside it. */
function parseJsonStdout(stdout: string): any {
  expect(stdout).not.toMatch(/\x1b\[/);
  return JSON.parse(stdout);
}

describe("payload key sets (additive-tolerant)", () => {
  test("status --format json", async () => {
    const { stdout, exitCode } = await runQmd(["status", "--format", "json"], runOpts);
    expect(exitCode).toBe(0);
    const payload = parseJsonStdout(stdout);

    expect(payload.schemaVersion).toBe(1);
    expect(typeof payload.index.path).toBe("string");
    expect(typeof payload.index.sizeBytes).toBe("number");
    expect(typeof payload.mcp.running).toBe("boolean");
    expect(payload.mcp.pid === null || typeof payload.mcp.pid === "number").toBe(true);
    expect(typeof payload.documents.total).toBe("number");
    expect(typeof payload.documents.vectors).toBe("number");
    expect(typeof payload.documents.orphanedVectors).toBe("number");
    expect(typeof payload.documents.pendingEmbedding).toBe("number");
    expect(payload.documents.lastModified === null || typeof payload.documents.lastModified === "string").toBe(true);
    expect(typeof payload.ast.available).toBe("boolean");
    expect(Array.isArray(payload.ast.languages)).toBe(true);
    for (const lang of payload.ast.languages) {
      expect(typeof lang.language).toBe("string");
      expect(typeof lang.available).toBe("boolean");
      expect(lang.error === null || typeof lang.error === "string").toBe(true);
    }
    expect(Array.isArray(payload.collections)).toBe(true);
    expect(payload.collections.length).toBeGreaterThan(0);
    for (const col of payload.collections) {
      expect(typeof col.name).toBe("string");
      expect(typeof col.globPattern).toBe("string");
      expect(typeof col.fileCount).toBe("number");
      expect(col.lastModified === null || typeof col.lastModified === "string").toBe(true);
      expect(Array.isArray(col.contexts)).toBe(true);
      for (const ctx of col.contexts) {
        expect(typeof ctx.pathPrefix).toBe("string");
        expect(typeof ctx.context).toBe("string");
      }
    }
    expect(typeof payload.models.embed).toBe("string");
    expect(typeof payload.models.rerank).toBe("string");
    expect(typeof payload.models.generate).toBe("string");
  });

  test("--version --format json", async () => {
    const { stdout, exitCode } = await runQmd(["--version", "--format", "json"], runOpts);
    expect(exitCode).toBe(0);
    const payload = parseJsonStdout(stdout);
    expect(payload.schemaVersion).toBe(1);
    expect(typeof payload.version).toBe("string");
    expect(payload.commit === null || typeof payload.commit === "string").toBe(true);
  });

  test("collection list --format json", async () => {
    const { stdout, exitCode } = await runQmd(["collection", "list", "--format", "json"], runOpts);
    expect(exitCode).toBe(0);
    const payload = parseJsonStdout(stdout);
    expect(payload.schemaVersion).toBe(1);
    expect(Array.isArray(payload.collections)).toBe(true);
    expect(payload.collections.length).toBeGreaterThan(0);
    for (const col of payload.collections) {
      expect(typeof col.name).toBe("string");
      expect(typeof col.globPattern).toBe("string");
      expect(Array.isArray(col.ignore)).toBe(true);
      expect(typeof col.fileCount).toBe("number");
      expect(col.lastModified === null || typeof col.lastModified === "string").toBe(true);
      expect(typeof col.includeByDefault).toBe("boolean");
    }
  });

  test("collection show --format json", async () => {
    const { stdout, exitCode } = await runQmd(["collection", "show", "snap", "--format", "json"], runOpts);
    expect(exitCode).toBe(0);
    const payload = parseJsonStdout(stdout);
    expect(payload.schemaVersion).toBe(1);
    expect(typeof payload.name).toBe("string");
    expect(typeof payload.path).toBe("string");
    expect(typeof payload.pattern).toBe("string");
    expect(Array.isArray(payload.ignore)).toBe(true);
    expect(typeof payload.includeByDefault).toBe("boolean");
    expect(payload.update === null || typeof payload.update === "string").toBe(true);
    expect(typeof payload.contextCount).toBe("number");
  });

  test("collection show --format json: unknown collection exits non-zero with no partial JSON", async () => {
    const { stdout, exitCode } = await runQmd(["collection", "show", "does-not-exist", "--format", "json"], runOpts);
    expect(exitCode).not.toBe(0);
    expect(stdout.trim()).toBe("");
  });
});

describe("capabilities --format json", () => {
  const ROLES = ["embed", "rerank", "generate"] as const;

  let capTestDir: string;
  let capCacheDir: string;
  let capConfigDir: string;

  /**
   * Clears every variable `capabilities` resolves through — the remote-backend
   * switch (`isOpenAIBackendConfigured`) and the three per-role model
   * overrides (`resolveModels`) — so each case's env is the whole input even
   * on a developer or CI machine that exports some of them.
   */
  const localOnlyEnv = {
    QMD_OPENAI_BASE_URL: "",
    QMD_OPENAI_API_KEY: "",
    OPENAI_API_KEY: "",
    QMD_EMBED_MODEL: "",
    QMD_RERANK_MODEL: "",
    QMD_GENERATE_MODEL: "",
  };

  /**
   * One config dir for every case: `capabilities` resolves the active models
   * without persisting them, so no run leaves behind a `models:` block that
   * would outrank the QMD_*_MODEL env vars these cases steer with.
   */
  function capOptsFor(env: Record<string, string>, configDir = capConfigDir) {
    return {
      cwd: capTestDir,
      dbPath: join(capTestDir, "test.sqlite"),
      configDir,
      env: { XDG_CACHE_HOME: capCacheDir, ...env },
    };
  }

  async function capabilities(env: Record<string, string>): Promise<any> {
    const { stdout, exitCode } = await runQmd(["capabilities", "--format", "json"], capOptsFor(env));
    expect(exitCode).toBe(0);
    return parseJsonStdout(stdout);
  }

  beforeAll(async () => {
    capTestDir = await mkdtemp(join(tmpdir(), "qmd-contract-cap-"));
    capCacheDir = join(capTestDir, "cache");
    capConfigDir = join(capTestDir, "config");
    await mkdir(capConfigDir, { recursive: true });
    await writeFile(join(capConfigDir, "index.yml"), "collections: {}\n");
    // An empty models dir: the default hf: models resolve as not-downloaded
    // regardless of what the developer running the suite has pulled.
    await mkdir(join(capCacheDir, "qmd", "models"), { recursive: true });
  });

  afterAll(async () => {
    if (capTestDir) await rm(capTestDir, { recursive: true, force: true });
  });

  test("payload key set: schemaVersion plus one Capability per role", async () => {
    const payload = await capabilities(localOnlyEnv);
    expect(Object.keys(payload).sort()).toEqual(["embed", "generate", "rerank", "schemaVersion"]);
    expect(payload.schemaVersion).toBe(1);
    for (const role of ROLES) {
      expect(Object.keys(payload[role]).sort()).toEqual(["available", "model", "reason"]);
      expect(typeof payload[role].model).toBe("string");
      expect(typeof payload[role].available).toBe("boolean");
      expect(payload[role].reason === null || typeof payload[role].reason === "string").toBe(true);
    }
  });

  test("reason is null exactly when available", async () => {
    const cases = [
      await capabilities(localOnlyEnv),
      await capabilities({ ...localOnlyEnv, QMD_OPENAI_BASE_URL: "https://example.invalid/v1", QMD_OPENAI_API_KEY: "sk-test" }),
      await capabilities({ ...localOnlyEnv, QMD_OPENAI_BASE_URL: "https://example.invalid/v1" }),
    ];
    for (const payload of cases) {
      for (const role of ROLES) {
        expect(payload[role].reason === null).toBe(payload[role].available);
      }
    }
  });

  test("a configured remote backend makes every role available", async () => {
    const payload = await capabilities({
      ...localOnlyEnv,
      QMD_OPENAI_BASE_URL: "https://example.invalid/v1",
      QMD_OPENAI_API_KEY: "sk-test",
    });
    for (const role of ROLES) {
      expect(payload[role].available).toBe(true);
      expect(payload[role].reason).toBeNull();
    }
  });

  test("credential-missing: a base URL with no key", async () => {
    const payload = await capabilities({ ...localOnlyEnv, QMD_OPENAI_BASE_URL: "https://example.invalid/v1" });
    for (const role of ROLES) {
      expect(payload[role].available).toBe(false);
      expect(payload[role].reason).toBe("credential-missing");
    }
  });

  test("model-file-missing: a local hf: model absent from the cache", async () => {
    const payload = await capabilities(localOnlyEnv);
    for (const role of ROLES) {
      expect(payload[role].model.startsWith("hf:")).toBe(true);
      expect(payload[role].available).toBe(false);
      expect(payload[role].reason).toBe("model-file-missing");
    }
  });

  test("backend-not-configured: a remote model name with no remote backend", async () => {
    const payload = await capabilities({ ...localOnlyEnv, QMD_EMBED_MODEL: "text-embedding-3-small" });
    expect(payload.embed.model).toBe("text-embedding-3-small");
    expect(payload.embed.available).toBe(false);
    expect(payload.embed.reason).toBe("backend-not-configured");
    // Resolution is per-role once no remote backend is configured.
    expect(payload.rerank.reason).toBe("model-file-missing");
  });

  test("model-file-invalid: a cached .gguf that is not a GGUF", async () => {
    const bogus = join(capTestDir, "bogus.gguf");
    await writeFile(bogus, "not a gguf at all\n");
    const payload = await capabilities({ ...localOnlyEnv, QMD_EMBED_MODEL: bogus });
    expect(payload.embed.model).toBe(bogus);
    expect(payload.embed.available).toBe(false);
    expect(payload.embed.reason).toBe("model-file-invalid");
  });

  test("an untrusted project-local models: block is reported as the defaults the runtime loads", async () => {
    const projectDir = join(capTestDir, "untrusted-project");
    const projectConfigDir = join(capTestDir, "untrusted-project-config");
    await mkdir(join(projectDir, ".qmd"), { recursive: true });
    await mkdir(projectConfigDir, { recursive: true });
    // A real GGUF: the untrusted URI must be rejected for being untrusted, not
    // for failing the same file inspection an unavailable model already fails.
    const customModel = join(projectDir, "custom-embed.gguf");
    await writeFile(customModel, Buffer.concat([Buffer.from("GGUF"), Buffer.alloc(508)]));
    await writeFile(
      join(projectDir, ".qmd", "index.yml"),
      `collections: {}\nmodels:\n  embed: ${JSON.stringify(customModel)}\n`
    );

    const { stdout, exitCode } = await runQmd(["capabilities", "--format", "json"], {
      cwd: projectDir,
      dbPath: join(projectDir, "test.sqlite"),
      configDir: projectConfigDir,
      env: {
        XDG_CACHE_HOME: capCacheDir,
        QMD_TRUST_LOCAL_CONFIG: "",
        QMD_TRUST_UPDATE_HOOKS: "",
        ...localOnlyEnv,
      },
    });

    expect(exitCode).toBe(0);
    const payload = parseJsonStdout(stdout);
    expect(payload.embed.model).not.toBe(customModel);
    expect(payload.embed.model.startsWith("hf:")).toBe(true);
    expect(payload.embed.available).toBe(false);
    expect(payload.embed.reason).toBe("model-file-missing");
  });

  test("an unreadable model cache still emits one JSON document and exits 0", async () => {
    const modelsDir = join(capCacheDir, "qmd", "models");
    await chmod(modelsDir, 0o000);
    // chmod does not deny root, so the condition this pins cannot be created
    // when the suite runs as root — skip instead of asserting on a readable dir.
    const denied = await readdir(modelsDir).then(() => false, () => true);
    try {
      if (!denied) return;
      const { stdout, exitCode } = await runQmd(["capabilities", "--format", "json"], capOptsFor(localOnlyEnv));
      expect(exitCode).toBe(0);
      const payload = parseJsonStdout(stdout);
      expect(Object.keys(payload).sort()).toEqual(["embed", "generate", "rerank", "schemaVersion"]);
      for (const role of ROLES) {
        expect(payload[role].available).toBe(false);
        expect(payload[role].reason).toBe("model-file-missing");
      }
    } finally {
      await chmod(modelsDir, 0o755);
    }
  });

  test("exits 0 with no collections configured", async () => {
    const { exitCode, stdout } = await runQmd(["capabilities"], capOptsFor(localOnlyEnv));
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Capabilities");
  });

  test("a config with no models: block is left byte-for-byte unchanged", async () => {
    const configDir = join(capTestDir, "read-only-config");
    await mkdir(configDir, { recursive: true });
    const configPath = join(configDir, "index.yml");
    const before = "collections: {}\n";
    await writeFile(configPath, before);

    const { exitCode } = await runQmd(["capabilities", "--format", "json"], capOptsFor(localOnlyEnv, configDir));
    expect(exitCode).toBe(0);
    expect(await readFile(configPath, "utf-8")).toBe(before);
  });
});

describe("status --format json (mcp daemon running)", () => {
  let daemonTestDir: string;
  let daemonCacheDir: string;
  let daemonDbPath: string;
  let daemonConfigDir: string;
  let daemonOpts: { cwd: string; dbPath: string; configDir: string; env?: Record<string, string> };
  let fakeDaemon: import("child_process").ChildProcess | undefined;

  beforeAll(async () => {
    daemonTestDir = await mkdtemp(join(tmpdir(), "qmd-contract-daemon-"));
    daemonCacheDir = join(daemonTestDir, "cache");
    daemonDbPath = join(daemonTestDir, "test.sqlite");
    daemonConfigDir = join(daemonTestDir, "config");
    await mkdir(daemonConfigDir, { recursive: true });
    await mkdir(join(daemonCacheDir, "qmd"), { recursive: true });
    await writeFile(join(daemonConfigDir, "index.yml"), "collections: {}\n");
    daemonOpts = {
      cwd: daemonTestDir,
      dbPath: daemonDbPath,
      configDir: daemonConfigDir,
      env: { XDG_CACHE_HOME: daemonCacheDir },
    };

    // A live process whose argv[0] reads "qmd" is enough to satisfy
    // isQmdMcpPid()'s cmdline check (src/cli/mcp-pid.ts) — no need to spin up
    // the real (model-loading) MCP server just to exercise status's
    // PID-liveness branch.
    fakeDaemon = spawn("sleep", ["60"], { argv0: "qmd", stdio: "ignore" });
    await writeFile(join(daemonCacheDir, "qmd", "mcp.pid"), String(fakeDaemon.pid));
  });

  afterAll(async () => {
    fakeDaemon?.kill("SIGKILL");
    if (daemonTestDir) await rm(daemonTestDir, { recursive: true, force: true });
  });

  test("mcp.running and mcp.pid reflect a live daemon", async () => {
    const { stdout, exitCode } = await runQmd(["status", "--format", "json"], daemonOpts);
    expect(exitCode).toBe(0);
    const payload = parseJsonStdout(stdout);
    expect(payload.mcp.running).toBe(true);
    expect(payload.mcp.pid).toBe(fakeDaemon!.pid);
  });
});

describe("mutation round trips (--format json)", () => {
  let mutTestDir: string;
  let mutDbPath: string;
  let mutConfigDir: string;
  let mutFixturesDir: string;
  let mutOpts: { cwd: string; dbPath: string; configDir: string };

  beforeAll(async () => {
    mutTestDir = await mkdtemp(join(tmpdir(), "qmd-contract-mut-"));
    mutDbPath = join(mutTestDir, "test.sqlite");
    mutConfigDir = join(mutTestDir, "config");
    mutFixturesDir = join(mutTestDir, "fixtures");
    await mkdir(mutConfigDir, { recursive: true });
    await writeFile(join(mutConfigDir, "index.yml"), "collections: {}\n");
    // Each mutation gets its own subdirectory so `collection add` never
    // collides on the (path, pattern) uniqueness check.
    for (const dir of ["add-target", "rename-target", "remove-target", "flags-target"]) {
      await mkdir(join(mutFixturesDir, dir), { recursive: true });
      await writeFile(join(mutFixturesDir, dir, "doc.md"), "# Doc\n\nHello.\n");
    }
    mutOpts = { cwd: mutFixturesDir, dbPath: mutDbPath, configDir: mutConfigDir };
  });

  afterAll(async () => {
    if (mutTestDir) await rm(mutTestDir, { recursive: true, force: true });
  });

  async function collectionNames(): Promise<string[]> {
    const { stdout } = await runQmd(["collection", "list", "--format", "json"], mutOpts);
    return parseJsonStdout(stdout).collections.map((c: { name: string }) => c.name);
  }

  test("collection add", async () => {
    const addPath = join(mutFixturesDir, "add-target");
    const { stdout, exitCode } = await runQmd(["collection", "add", addPath, "--name", "mutadd", "--format", "json"], mutOpts);
    expect(exitCode).toBe(0);
    const payload = parseJsonStdout(stdout);
    expect(payload).toMatchObject({ schemaVersion: 1, command: "collection.add", collection: "mutadd", ok: true });
    expect(typeof payload.message).toBe("string");

    expect(await collectionNames()).toContain("mutadd");
  });

  test("collection rename", async () => {
    const renamePath = join(mutFixturesDir, "rename-target");
    await runQmd(["collection", "add", renamePath, "--name", "mutrename-src", "--format", "json"], mutOpts);

    const { stdout, exitCode } = await runQmd(["collection", "rename", "mutrename-src", "mutrename-dst", "--format", "json"], mutOpts);
    expect(exitCode).toBe(0);
    const payload = parseJsonStdout(stdout);
    expect(payload).toMatchObject({ schemaVersion: 1, command: "collection.rename", collection: "mutrename-dst", ok: true });

    const names = await collectionNames();
    expect(names).toContain("mutrename-dst");
    expect(names).not.toContain("mutrename-src");
  });

  test("collection remove", async () => {
    const removePath = join(mutFixturesDir, "remove-target");
    await runQmd(["collection", "add", removePath, "--name", "mutremove", "--format", "json"], mutOpts);

    const { stdout, exitCode } = await runQmd(["collection", "remove", "mutremove", "--format", "json"], mutOpts);
    expect(exitCode).toBe(0);
    const payload = parseJsonStdout(stdout);
    expect(payload).toMatchObject({ schemaVersion: 1, command: "collection.remove", collection: "mutremove", ok: true });

    expect(await collectionNames()).not.toContain("mutremove");
  });

  test("collection update-cmd: set then clear", async () => {
    const flagsPath = join(mutFixturesDir, "flags-target");
    await runQmd(["collection", "add", flagsPath, "--name", "mutflags-update", "--format", "json"], mutOpts);

    const setResult = await runQmd(["collection", "update-cmd", "mutflags-update", "echo", "hi", "--format", "json"], mutOpts);
    expect(setResult.exitCode).toBe(0);
    expect(parseJsonStdout(setResult.stdout)).toMatchObject({
      schemaVersion: 1, command: "collection.update-cmd", collection: "mutflags-update", ok: true,
    });
    let shown = parseJsonStdout((await runQmd(["collection", "show", "mutflags-update", "--format", "json"], mutOpts)).stdout);
    expect(shown.update).toBe("echo hi");

    const clearResult = await runQmd(["collection", "update-cmd", "mutflags-update", "--format", "json"], mutOpts);
    expect(clearResult.exitCode).toBe(0);
    expect(parseJsonStdout(clearResult.stdout)).toMatchObject({
      schemaVersion: 1, command: "collection.update-cmd", collection: "mutflags-update", ok: true,
    });
    shown = parseJsonStdout((await runQmd(["collection", "show", "mutflags-update", "--format", "json"], mutOpts)).stdout);
    expect(shown.update).toBeNull();
  });

  test("collection exclude then include", async () => {
    const flagsPath = join(mutFixturesDir, "flags-target");
    await runQmd(["collection", "add", flagsPath, "--name", "mutflags-toggle", "--mask", "*.md", "--format", "json"], mutOpts);

    const excludeResult = await runQmd(["collection", "exclude", "mutflags-toggle", "--format", "json"], mutOpts);
    expect(excludeResult.exitCode).toBe(0);
    expect(parseJsonStdout(excludeResult.stdout)).toMatchObject({
      schemaVersion: 1, command: "collection.exclude", collection: "mutflags-toggle", ok: true,
    });
    let shown = parseJsonStdout((await runQmd(["collection", "show", "mutflags-toggle", "--format", "json"], mutOpts)).stdout);
    expect(shown.includeByDefault).toBe(false);

    const includeResult = await runQmd(["collection", "include", "mutflags-toggle", "--format", "json"], mutOpts);
    expect(includeResult.exitCode).toBe(0);
    expect(parseJsonStdout(includeResult.stdout)).toMatchObject({
      schemaVersion: 1, command: "collection.include", collection: "mutflags-toggle", ok: true,
    });
    shown = parseJsonStdout((await runQmd(["collection", "show", "mutflags-toggle", "--format", "json"], mutOpts)).stdout);
    expect(shown.includeByDefault).toBe(true);
  });
});
