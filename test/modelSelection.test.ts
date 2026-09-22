import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { buildPiArgs, type AgentConfig } from "../src/helpers.js";
import { buildPiArgv } from "../src/subagent/buildArgv.js";
import { loadSubagentSettings } from "../src/subagent-settings.js";
import { resolveSdkModel } from "../src/subagent/runSdk.js";

const bundledAgentDir = fileURLToPath(new URL("../agents/", import.meta.url));

test("runtime-only: ships no bundled agent profiles", () => {
  // pi-subagents is runtime-only: agents resolve from the consumer's
  // .pi/agents/ and ~/.pi/agent/agents/. The bundled dir must be empty/absent.
  let entries: string[] = [];
  try {
    entries = readdirSync(bundledAgentDir).filter((f) => f.endsWith(".md"));
  } catch {
    // missing dir is the expected runtime-only state in consumers
  }
  assert.equal(
    entries.length,
    0,
    `pi-subagents must ship no bundled agents; found: ${entries.join(", ")}`,
  );
});

test("terminal subagents defer to Pi unless an agent explicitly selects a model", () => {
  const agent: AgentConfig = {
    name: "test",
    description: "test agent",
    body: "",
    source: "bundled",
    path: "/agents/test.md",
  };

  const defaults = buildPiArgs(agent, "task-default", "/tmp", "prompt");
  assert.ok(!defaults.includes("--model"));

  const explicit = buildPiArgs(
    { ...agent, model: "anthropic/claude-sonnet" },
    "task-explicit",
    "/tmp",
    "prompt",
  );
  assert.deepEqual(
    explicit.slice(explicit.indexOf("--model"), explicit.indexOf("--model") + 2),
    ["--model", "anthropic/claude-sonnet"],
  );
});

test("SDK subagents fall back to the first available model (global default) when nothing is pinned", async () => {
  const current = { id: "gpt-5", provider: { id: "openai" } };
  const globalDefault = { id: "other", provider: { id: "other" } };

  // 9b24061: subagents no longer inherit the parent session's model;
  // with no requested/pinned model they use Pi's global default (first available).
  const resolved = await resolveSdkModel({
    model: current,
    modelRegistry: { getAll: () => [globalDefault] },
  });

  assert.equal(resolved, globalDefault);
});

test("SDK subagents preserve an explicitly configured agent model", async () => {
  const current = { id: "gpt-5", provider: { id: "openai" } };
  const configured = { id: "claude-sonnet", provider: { id: "anthropic" } };

  const resolved = await resolveSdkModel(
    {
      model: current,
      modelRegistry: {
        find: (provider: string, modelId: string) =>
          provider === "anthropic" && modelId === "claude-sonnet"
            ? configured
            : undefined,
      },
    },
    "anthropic/claude-sonnet",
  );

  assert.equal(resolved, configured);
});

test("buildPiArgv model override wins over the agent profile pin", () => {
  const agent: AgentConfig = {
    name: "test",
    description: "test agent",
    body: "",
    source: "bundled",
    path: "/agents/test.md",
    model: "anthropic/claude-sonnet",
  };

  const args = buildPiArgv({
    agent,
    sessionName: "t",
    sessionDir: "/tmp",
    promptContent: "p",
    model: "minimax/MiniMax-M3",
  });
  assert.deepEqual(
    args.slice(args.indexOf("--model"), args.indexOf("--model") + 2),
    ["--model", "minimax/MiniMax-M3"],
  );
});

test("loadSubagentSettings: global default, project override, no key", () => {
  const home = mkdtempSync(join(tmpdir(), "pi-subagents-home-"));
  const globalSettings = join(home, ".pi", "agent", "settings.json");
  mkdirSync(join(home, ".pi", "agent"), { recursive: true });
  writeFileSync(globalSettings, JSON.stringify({ subagents: { defaultModel: "global/model" } }));

  const project = mkdtempSync(join(tmpdir(), "pi-subagents-proj-"));
  const outer = join(project, "src");
  mkdirSync(join(project, ".pi"), { recursive: true });
  mkdirSync(outer, { recursive: true });

  const originalHome = process.env.HOME;
  process.env.HOME = home;
  try {
    // global only
    const globalOnly = loadSubagentSettings(project);
    assert.equal(globalOnly.defaultModel, "global/model");
    assert.equal(globalOnly.sources.projectOverrides, false);
    assert.equal(globalOnly.sources.projectPath, join(project, ".pi", "settings.json"));
    assert.equal(globalOnly.sources.globalPath, globalSettings);

    // project overrides global
    writeFileSync(
      join(project, ".pi", "settings.json"),
      JSON.stringify({ subagents: { defaultModel: "project/model" } }),
    );
    const overridden = loadSubagentSettings(outer);
    assert.equal(overridden.defaultModel, "project/model");
    assert.equal(overridden.sources.projectOverrides, true);

    // no subagents key anywhere -> empty (but sources still reported)
    rmSync(join(project, ".pi"), { recursive: true });
    writeFileSync(globalSettings, JSON.stringify({}));
    const empty = loadSubagentSettings(outer);
    assert.equal(empty.defaultModel, undefined);
    assert.equal(empty.availableModels, undefined);
    assert.equal(empty.sources.projectPath, null);
    assert.equal(empty.sources.projectOverrides, false);
  } finally {
    process.env.HOME = originalHome;
  }
});

test("loadSubagentSettings: agentModels, skipped entries, and shadowing", () => {
  const home = mkdtempSync(join(tmpdir(), "pi-subagents-home2-"));
  const globalSettings = join(home, ".pi", "agent", "settings.json");
  mkdirSync(join(home, ".pi", "agent"), { recursive: true });
  writeFileSync(
    globalSettings,
    JSON.stringify({
      subagents: {
        defaultModel: "global/model",
        availableModels: [
          "global/good",
          { model: "global/obj", description: "note" },
          "",
          { model: 42 },
          null,
        ],
        agentModels: { coder: "global/coder-model", general: 7 },
      },
    }),
  );

  const project = mkdtempSync(join(tmpdir(), "pi-subagents-proj2-"));
  mkdirSync(join(project, ".pi"), { recursive: true });
  const originalHome = process.env.HOME;
  process.env.HOME = home;
  try {
    const loaded = loadSubagentSettings(project);
    // valid entries applied, malformed ones reported (never applied)
    assert.deepEqual(loaded.availableModels, [
      { model: "global/good" },
      { model: "global/obj", description: "note" },
    ]);
    assert.deepEqual(loaded.agentModels, { coder: "global/coder-model" });
    assert.ok(loaded.availableModelSkipped);
    assert.equal(loaded.availableModelSkipped.length, 4);
    assert.match(loaded.availableModelSkipped[0], /availableModels\[3\].*empty string/);
    assert.match(loaded.availableModelSkipped[1], /availableModels\[4\].*string 'model'/);
    assert.match(loaded.availableModelSkipped[2], /availableModels\[5\].*expected/);
    assert.match(
      loaded.availableModelSkipped[3],
      /agentModels\["general"\]: expected a model string/,
    );

    // project shadowing is per-key: the project availableModels suppresses
    // the global availableModels notes, but the still-effective global
    // agentModels note remains
    writeFileSync(
      join(project, ".pi", "settings.json"),
      JSON.stringify({ subagents: { availableModels: ["project/model"] } }),
    );
    const shadowed = loadSubagentSettings(project);
    assert.deepEqual(shadowed.availableModels, [{ model: "project/model" }]);
    assert.equal(shadowed.defaultModel, "global/model");
    assert.deepEqual(shadowed.availableModelSkipped, [
      'agentModels["general"]: expected a model string',
    ]);
    assert.equal(shadowed.sources.projectOverrides, true);
  } finally {
    process.env.HOME = originalHome;
  }
});

test("SDK subagents fail clearly when a pinned model is unavailable", async () => {
  const current = { id: "gpt-5", provider: { id: "openai" } };
  const fallback = { id: "other", provider: { id: "other" }, name: "Other" };

  await assert.rejects(
    () =>
      resolveSdkModel(
        {
          model: current,
          modelRegistry: {
            find: () => undefined,
            getAll: () => [fallback],
            getAvailable: () => [fallback],
          },
        },
        "missing/provider-model",
      ),
    /requested subagent model.*not available/i,
  );
});
