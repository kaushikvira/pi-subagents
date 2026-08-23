import { afterEach, describe, expect, it } from "vitest";
import { ORCHESTRATION_REASON_MAX_CHARS } from "../src/orchestration/reason-codes.js";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  completeDurableRun,
  createDurableRun,
  getDurableRunByTaskId,
  listDurableRuns,
  patchDurableRun,
  putDurableRun,
  RUN_STORE_MAX_RUNS,
  RUN_STORE_RETENTION_MS,
  type DurableTaskRun,
} from "../src/orchestration/run-store.ts";
import { taggedDigest } from "../src/learning-contract.ts";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("durable task run store", () => {
  it("persists allocation before task identity and binds it atomically later", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pi-runs-"));
    directories.push(directory);
    const path = join(directory, "runs.json");
    const run = createDurableRun({
      invocationId: "invocation-1",
      correlationId: "user-label",
      projectDirectory: directory,
      claims: [{ kind: "write", resource: "src", mode: "exclusive" }],
    });
    await putDurableRun(path, run);
    await patchDurableRun(path, run.invocationId, {
      taskId: "task-1",
      executionPhase: "working",
    });

    const loaded = await getDurableRunByTaskId(path, "task-1");
    expect(loaded).toMatchObject({
      invocationId: "invocation-1",
      correlationId: "user-label",
      executionPhase: "working",
    });
    expect(await listDurableRuns(path)).toHaveLength(1);
  });

  it("round-trips a bounded, redacted optional blocked reason code while accepting legacy runs", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pi-runs-reason-code-"));
    directories.push(directory);
    const path = join(directory, "runs.json");
    const run = createDurableRun({ invocationId: "blocked", projectDirectory: directory });
    const blockedReason = `secret=super-secret ${"z".repeat(5_000)}`;
    await putDurableRun(path, run);
    await patchDurableRun(path, run.invocationId, {
      executionPhase: "blocked",
      blockedReason,
      blockedReasonCode: "CLAIM_LEASE_LOST",
    });

    const [stored] = await listDurableRuns(path);
    expect(stored).toEqual(
      expect.objectContaining({
        blockedReasonCode: "CLAIM_LEASE_LOST",
      }),
    );
    expect(stored?.blockedReason).toHaveLength(ORCHESTRATION_REASON_MAX_CHARS);
    expect(stored?.blockedReason).toContain("secret=[REDACTED]");
    expect(stored?.blockedReason).not.toContain("super-secret");
  });

  it("normalizes legacy single-repo runs to their control project", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pi-runs-legacy-workspace-"));
    directories.push(directory);
    const path = join(directory, "runs.json");
    const legacy = structuredClone(
      createDurableRun({ invocationId: "legacy-workspace", projectDirectory: directory }),
    ) as Record<string, unknown>;
    delete legacy.workspaceDirectory;
    await writeFile(path, JSON.stringify({ version: 1, runs: [legacy] }));

    const [loaded] = await listDurableRuns(path);

    expect(loaded?.workspaceDirectory).toBe(directory);
  });

  it("rejects resurrection or rewriting of a terminal execution phase", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pi-runs-"));
    directories.push(directory);
    const path = join(directory, "runs.json");
    const run = createDurableRun({ invocationId: "terminal", projectDirectory: directory });
    await putDurableRun(path, run);
    await patchDurableRun(path, run.invocationId, { executionPhase: "working" });
    await patchDurableRun(path, run.invocationId, { executionPhase: "completed" });
    await expect(
      patchDurableRun(path, run.invocationId, { executionPhase: "working" }),
    ).rejects.toThrow(/Invalid task execution transition/u);
    await expect(
      patchDurableRun(path, run.invocationId, { executionPhase: "failed" }),
    ).rejects.toThrow(/Invalid task execution transition/u);
  });

  it("keeps runtime identity immutable across patches", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pi-runs-"));
    directories.push(directory);
    const path = join(directory, "runs.json");
    const run = createDurableRun({ invocationId: "owner", projectDirectory: directory });
    await putDurableRun(path, run);
    await patchDurableRun(path, "owner", {
      invocationId: "forged",
      verificationPhase: "failed",
      verificationIssues: ["bad evidence"],
    });
    const [loaded] = await listDurableRuns(path);
    expect(loaded?.invocationId).toBe("owner");
    expect(loaded?.verificationIssues).toEqual(["bad evidence"]);
  });

  it("claims terminal completion once and permits only an identical replay", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pi-runs-"));
    directories.push(directory);
    const path = join(directory, "runs.json");
    const run = createDurableRun({ invocationId: "completion-cas", projectDirectory: directory });
    await putDurableRun(path, run);
    await patchDurableRun(path, run.invocationId, { executionPhase: "working" });
    const digest = taggedDigest({ outcome: "success" });
    const first = await completeDurableRun(path, run.invocationId, digest, {
      executionPhase: "completed",
      reportedOutcome: "success",
    });
    const replay = await completeDurableRun(path, run.invocationId, digest, {
      executionPhase: "completed",
      reportedOutcome: "success",
    });
    expect(replay).toEqual(first);
    await expect(
      completeDurableRun(path, run.invocationId, taggedDigest({ outcome: "failure" }), {
        executionPhase: "failed",
        reportedOutcome: "failure",
      }),
    ).rejects.toThrow(/Conflicting terminal result/u);
    await expect(putDurableRun(path, run)).rejects.toThrow(/Cannot overwrite terminal/u);
  });

  it("allows only one durable invocation for a decision-resume correlation", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pi-runs-"));
    directories.push(directory);
    const path = join(directory, "runs.json");
    const first = createDurableRun({
      invocationId: "resume-1",
      correlationId: "decision-resume:subject:decision",
      projectDirectory: directory,
    });
    const second = createDurableRun({
      invocationId: "resume-2",
      correlationId: first.correlationId,
      projectDirectory: directory,
    });
    await putDurableRun(path, first);
    await expect(putDurableRun(path, second)).rejects.toThrow(
      /already has a durable invocation/u,
    );
  });

  it("does not create or re-expose the legacy persisted semantic secret", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pi-runs-"));
    directories.push(directory);
    const path = join(directory, "runs.json");
    const run = createDurableRun({
      invocationId: "legacy-secret",
      projectDirectory: directory,
    });
    expect("semanticBindingKey" in run).toBe(false);
    await writeFile(
      path,
      JSON.stringify({
        version: 1,
        runs: [{ ...run, semanticBindingKey: "must-not-leak" }],
      }),
      "utf8",
    );
    const [loaded] = await listDurableRuns(path);
    expect(loaded).toBeDefined();
    expect("semanticBindingKey" in (loaded as object)).toBe(false);
  });
});

describe("run store retention", () => {
  const daysAgo = (days: number) =>
    new Date(Date.now() - days * 24 * 60 * 60 * 1_000).toISOString();

  async function writeStore(
    path: string,
    runs: DurableTaskRun[],
  ): Promise<void> {
    await writeFile(path, JSON.stringify({ version: 1, runs }), "utf8");
  }

  function terminalRun(directory: string, invocationId: string, updatedAt: string): DurableTaskRun {
    const run = createDurableRun({ invocationId, projectDirectory: directory });
    run.executionPhase = "completed";
    run.updatedAt = updatedAt;
    return run;
  }

  it("prunes terminal runs past retention when the store exceeds the cap, lazily on write", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pi-runs-prune-"));
    directories.push(directory);
    const path = join(directory, "runs.json");

    const runs: DurableTaskRun[] = [];
    for (let i = 0; i < RUN_STORE_MAX_RUNS; i += 1) {
      runs.push(terminalRun(directory, `old-${i}`, daysAgo(8))); // past the 7-day retention
    }
    for (let i = 0; i < 10; i += 1) {
      runs.push(terminalRun(directory, `fresh-${i}`, daysAgo(1)));
    }
    runs.push(createDurableRun({ invocationId: "active-working", projectDirectory: directory }));
    runs.push(createDurableRun({ invocationId: "active-blocked", projectDirectory: directory }));
    await writeStore(path, runs);

    // Under the cap nothing is pruned, even with stale terminal runs present.
    const small = await listDurableRuns(path);
    expect(small).toHaveLength(runs.length);

    const trigger = createDurableRun({ invocationId: "new-arrival", projectDirectory: directory });
    await putDurableRun(path, trigger);

    const loaded = await listDurableRuns(path);
    const ids = new Set(loaded.map((run) => run.invocationId));
    // The past-retention terminal runs were shed; the store is back under the
    // cap with the fresh terminal, active, and triggering runs intact.
    expect(loaded.length).toBeLessThanOrEqual(RUN_STORE_MAX_RUNS);
    expect(loaded.length).toBe(13);
    expect(ids.has("new-arrival")).toBe(true);
    expect(ids.has("active-working")).toBe(true);
    expect(ids.has("active-blocked")).toBe(true);
    expect(ids.has("fresh-0")).toBe(true);
    expect(ids.has("old-0")).toBe(false);
    expect(ids.has("old-999")).toBe(false);
  });

  it("sheds the oldest terminal runs when retention alone cannot get under the cap", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pi-runs-prune-cap-"));
    directories.push(directory);
    const path = join(directory, "runs.json");

    const runs: DurableTaskRun[] = [];
    const base = Date.now() - 24 * 60 * 60 * 1_000; // 1 day ago: within retention
    for (let i = 0; i < RUN_STORE_MAX_RUNS + 5; i += 1) {
      // All within retention; oldest-first updatedAt so the cap sheds `young-*`.
      runs.push(terminalRun(directory, `young-${i}`, new Date(base + i).toISOString()));
    }
    await writeStore(path, runs);

    const trigger = createDurableRun({ invocationId: "cap-trigger", projectDirectory: directory });
    await putDurableRun(path, trigger);

    const loaded = await listDurableRuns(path);
    const ids = new Set(loaded.map((run) => run.invocationId));
    expect(loaded.length).toBeLessThanOrEqual(RUN_STORE_MAX_RUNS);
    expect(ids.has("cap-trigger")).toBe(true);
    // The five oldest terminal runs were shed to get under the cap.
    expect(ids.has("young-0")).toBe(false);
    expect(ids.has(`young-${RUN_STORE_MAX_RUNS - 1}`)).toBe(true);
  });

  it("never prunes runs with an active lease or a pending durable decision", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pi-runs-prune-hold-"));
    directories.push(directory);
    const path = join(directory, "runs.json");

    const leased = terminalRun(directory, "terminal-leased", daysAgo(30));
    leased.lease = {
      id: "lease-1",
      owner: "task-leased",
      claims: [{ kind: "write", resource: "src", mode: "exclusive" }],
      acquiredAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60 * 60 * 1_000).toISOString(),
      fence: 1,
    };

    const deciding = terminalRun(directory, "terminal-deciding", daysAgo(30));
    deciding.decisionRequest = {
      id: "decision-1",
      question: "Which direction?",
      options: [
        { id: "a", label: "A" },
        { id: "b", label: "B" },
      ],
      requestedAt: new Date().toISOString(),
      requestDigest: `sha256:v1:${"ab".repeat(32)}`,
      status: "pending",
    };

    const runs: DurableTaskRun[] = [];
    for (let i = 0; i < RUN_STORE_MAX_RUNS; i += 1) {
      runs.push(terminalRun(directory, `old-${i}`, daysAgo(8)));
    }
    runs.push(leased, deciding);
    await writeStore(path, runs);

    const trigger = createDurableRun({ invocationId: "hold-trigger", projectDirectory: directory });
    await putDurableRun(path, trigger);

    const ids = new Set((await listDurableRuns(path)).map((run) => run.invocationId));
    expect(ids.has("terminal-leased")).toBe(true);
    expect(ids.has("terminal-deciding")).toBe(true);
    expect(ids.has("hold-trigger")).toBe(true);
    expect(ids.has("old-0")).toBe(false);
  });

  it("retention window and cap are the documented constants", () => {
    expect(RUN_STORE_RETENTION_MS).toBe(7 * 24 * 60 * 60 * 1_000);
    expect(RUN_STORE_MAX_RUNS).toBe(1_000);
  });
});
