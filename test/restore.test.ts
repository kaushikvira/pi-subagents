import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { restoreActiveBackgroundTasks } from "../src/lifecycle/restore.ts";

function makePiDir() {
  return mkdtempSync(join(tmpdir(), "pi-task-restore-"));
}

function writeJson(file: string, value: unknown) {
  writeFileSync(file, JSON.stringify(value, null, 2));
}

function readJson<T>(file: string): T {
  return JSON.parse(readFileSync(file, "utf8")) as T;
}

function writeSession(dir: string, sessionName: string, stopReason?: string) {
  mkdirSync(dir, { recursive: true });
  const now = new Date().toISOString();
  const content = [
    { type: "session_info", timestamp: now, name: sessionName },
    {
      type: "message",
      timestamp: now,
      message: {
        role: "assistant",
        stopReason,
        content: [{ type: "text", text: "done" }],
      },
    },
  ];
  writeFileSync(join(dir, "session.jsonl"), content.map((entry) => JSON.stringify(entry)).join("\n"));
}

describe("restoreActiveBackgroundTasks", () => {
  it("marks completed registry entries done and removes them from registry", () => {
    const piDir = makePiDir();
    const taskDir = join(piDir, "artifacts", "sessions", "task-1");
    writeSession(taskDir, "task-task-1", "stop");
    writeJson(join(piDir, "task-registry.json"), [
      {
        id: "task-1",
        dir: taskDir,
        sessionName: "task-task-1",
        startedAt: Date.now() - 1000,
        paneId: "%missing",
        agentType: "scout",
        description: "done task",
        background: true,
      },
    ]);
    writeJson(join(piDir, "task-session-history.json"), [
      { id: "task-1", status: "running", startedAt: Date.now() - 1000 },
    ]);

    const backgroundTasks = new Map();
    restoreActiveBackgroundTasks(piDir, backgroundTasks);

    assert.equal(backgroundTasks.size, 0);
    assert.deepEqual(readJson<unknown[]>(join(piDir, "task-registry.json")), []);
    const history = readJson<Array<{ id: string; status: string }>>(
      join(piDir, "task-session-history.json"),
    );
    assert.equal(history[0]?.status, "done");
  });

  it("preserves terminal JSONL failure truth during recovery", () => {
    const piDir = makePiDir();
    const taskDir = join(piDir, "artifacts", "sessions", "task-error");
    writeSession(taskDir, "task-task-error", "error");
    writeJson(join(piDir, "task-registry.json"), [
      {
        id: "task-error",
        dir: taskDir,
        sessionName: "task-task-error",
        startedAt: Date.now() - 1000,
        paneId: "%missing",
        agentType: "scout",
        description: "failed task",
        background: true,
      },
    ]);
    writeJson(join(piDir, "task-session-history.json"), [
      { id: "task-error", status: "running", startedAt: Date.now() - 1000 },
    ]);

    restoreActiveBackgroundTasks(piDir, new Map());
    const history = readJson<Array<{ id: string; status: string }>>(
      join(piDir, "task-session-history.json"),
    );
    assert.equal(history[0]?.status, "failed");
  });

  it("preserves durable records during a temporary backend outage", () => {
    const piDir = makePiDir();
    const taskDir = join(piDir, "artifacts", "sessions", "task-herdr");
    writeSession(taskDir, "task-task-herdr");
    const entry = {
      id: "task-herdr",
      dir: taskDir,
      sessionName: "task-task-herdr",
      startedAt: Date.now() - 1000,
      paneId: "w1:p2",
      handle: {
        backend: "herdr",
        resourceId: "w1:p2",
        socketPath: "/tmp/herdr.sock",
        terminalId: "term-2",
      },
      agentType: "scout",
      description: "temporarily unreachable",
      background: true,
    };
    writeJson(join(piDir, "task-registry.json"), [entry]);

    const backgroundTasks = new Map();
    restoreActiveBackgroundTasks(piDir, backgroundTasks, () => {
      const error = new Error("connection refused");
      error.name = "HerdrUnavailableError";
      throw error;
    });

    assert.equal(backgroundTasks.size, 0);
    assert.equal(readJson<Array<{ id: string }>>(join(piDir, "task-registry.json"))[0]?.id, "task-herdr");
  });

  it("quarantines a registry entry when the liveness check throws", () => {
    const piDir = makePiDir();
    const taskDir = join(piDir, "artifacts", "sessions", "task-quarantine");
    writeSession(taskDir, "task-task-quarantine");
    writeJson(join(piDir, "task-registry.json"), [
      {
        id: "task-quarantine",
        dir: taskDir,
        sessionName: "task-task-quarantine",
        startedAt: Date.now() - 1000,
        paneId: "w1:p2",
        handle: {
          backend: "herdr",
          resourceId: "w1:p2",
          socketPath: "/tmp/herdr.sock",
          terminalId: "term-2",
        },
        agentType: "scout",
        description: "backend down at load",
        background: true,
      },
    ]);

    const warnings: string[] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      warnings.push(args.map(String).join(" "));
    };
    let backgroundTasks: Map<string, unknown>;
    try {
      backgroundTasks = new Map();
      restoreActiveBackgroundTasks(piDir, backgroundTasks, () => {
        const error = new Error("connection refused");
        error.name = "HerdrUnavailableError";
        throw error;
      });
    } finally {
      console.warn = originalWarn;
    }

    // The entry is left in the durable registry (not silently dropped) and is
    // marked quarantined so the next session's restore can pick it up.
    const [stored] = readJson<
      Array<{ id: string; restoreQuarantinedAt?: string; restoreQuarantineReason?: string }>
    >(join(piDir, "task-registry.json"));
    assert.equal(stored?.id, "task-quarantine");
    assert.ok(stored?.restoreQuarantinedAt);
    assert.match(stored?.restoreQuarantineReason ?? "", /liveness check threw/u);
    assert.equal(backgroundTasks!.size, 0);
    assert.equal(
      warnings.some((line) => line.includes("task-quarantine")),
      true,
      "a visible console note must report the quarantined entry",
    );
  });

  it("clears a quarantine marker once the liveness check succeeds", () => {
    const piDir = makePiDir();
    const taskDir = join(piDir, "artifacts", "sessions", "task-quarantine-recovered");
    writeSession(taskDir, "task-task-quarantine-recovered");
    writeJson(join(piDir, "task-registry.json"), [
      {
        id: "task-quarantine-recovered",
        dir: taskDir,
        sessionName: "task-task-quarantine-recovered",
        startedAt: Date.now() - 1000,
        paneId: "w1:p2",
        agentType: "scout",
        description: "recovered task",
        background: true,
        restoreQuarantineReason: "liveness check threw: connection refused",
        restoreQuarantinedAt: new Date().toISOString(),
      },
    ]);

    const backgroundTasks = new Map();
    // The check succeeds this time: the quarantined entry is restored into
    // the poll loop.
    restoreActiveBackgroundTasks(piDir, backgroundTasks, () => true);

    // Restored into the poll loop, and the marker is cleared durably.
    assert.equal(backgroundTasks.size, 1);
    const [stored] = readJson<
      Array<{ id: string; restoreQuarantinedAt?: string }>
    >(join(piDir, "task-registry.json"));
    assert.equal(stored?.id, "task-quarantine-recovered");
    assert.equal(stored?.restoreQuarantinedAt, undefined);
  });

  it("marks non-terminal entries failed when their pane is gone", () => {
    const piDir = makePiDir();
    const taskDir = join(piDir, "artifacts", "sessions", "task-2");
    writeSession(taskDir, "task-task-2");
    writeJson(join(piDir, "task-registry.json"), [
      {
        id: "task-2",
        dir: taskDir,
        sessionName: "task-task-2",
        startedAt: Date.now() - 1000,
        paneId: "%missing",
        agentType: "scout",
        description: "lost task",
        background: true,
      },
    ]);
    writeJson(join(piDir, "task-session-history.json"), [
      { id: "task-2", status: "running", startedAt: Date.now() - 1000 },
    ]);

    const backgroundTasks = new Map();
    restoreActiveBackgroundTasks(piDir, backgroundTasks);

    assert.equal(backgroundTasks.size, 0);
    assert.deepEqual(readJson<unknown[]>(join(piDir, "task-registry.json")), []);
    const history = readJson<Array<{ id: string; status: string }>>(
      join(piDir, "task-session-history.json"),
    );
    assert.equal(history[0]?.status, "failed");
  });

  it("continues restoring when cleanup of a dead grouped HerdR pane fails", () => {
    const piDir = makePiDir();
    const taskDir = join(piDir, "artifacts", "sessions", "task-herdr-dead");
    writeSession(taskDir, "task-task-herdr-dead");
    writeJson(join(piDir, "task-registry.json"), [
      {
        id: "task-herdr-dead",
        dir: taskDir,
        sessionName: "task-task-herdr-dead",
        startedAt: Date.now() - 1000,
        paneId: "w1:p2",
        handle: {
          backend: "herdr",
          resourceId: "w1:p2",
          socketPath: "/tmp/herdr.sock",
          terminalId: "term-2",
          workspaceId: "w1",
          workspaceGroup: "parallel-retry",
        },
        agentType: "scout",
        description: "dead grouped task",
        background: true,
      },
    ]);

    assert.doesNotThrow(() => {
      restoreActiveBackgroundTasks(
        piDir,
        new Map(),
        () => false,
        () => {
          throw new Error("workspace_not_found");
        },
      );
    });

    assert.deepEqual(readJson<unknown[]>(join(piDir, "task-registry.json")), []);
    const history = readJson<Array<{ id: string; status: string }>>(
      join(piDir, "task-session-history.json"),
    );
    assert.equal(history[0]?.status, "failed");
  });
});
