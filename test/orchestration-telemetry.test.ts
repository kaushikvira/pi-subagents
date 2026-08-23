import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  appendOrchestrationEvent,
  deriveOrchestrationMetrics,
  MAX_ROTATED_SEGMENTS,
  MAX_SEGMENT_BYTES,
  readOrchestrationEvents,
  summarizeTaskSessionUsage,
} from "../src/orchestration/telemetry.ts";
import { readdir } from "node:fs/promises";

const temporaryDirectories: string[] = [];

async function createTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "md-harness-telemetry-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  delete process.env.PI_SUBAGENTS_NO_TELEMETRY;
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("task outcome telemetry", () => {
  it("aggregates model usage from a task session JSONL", async () => {
    const directory = await createTemporaryDirectory();
    const sessionPath = join(directory, "task.jsonl");
    await writeFile(
      sessionPath,
      [
        JSON.stringify({ type: "session", name: "task-example" }),
        JSON.stringify({
          type: "message",
          message: {
            role: "assistant",
            provider: "provider-a",
            model: "model-a",
            usage: {
              input: 100,
              output: 25,
              cacheRead: 50,
              cacheWrite: 10,
              cost: { total: 0.02 },
            },
          },
        }),
        JSON.stringify({
          type: "message",
          message: {
            role: "assistant",
            provider: "provider-a",
            model: "model-a",
            usage: {
              input: 40,
              output: 15,
              cacheRead: 0,
              cacheWrite: 0,
              cost: { total: 0.01 },
            },
          },
        }),
      ].join("\n"),
      "utf8",
    );

    expect(await summarizeTaskSessionUsage(sessionPath)).toEqual({
      inputTokens: 140,
      outputTokens: 40,
      cacheReadTokens: 50,
      cacheWriteTokens: 10,
      totalTokens: 240,
      cost: 0.03,
      provider: "provider-a",
      model: "model-a",
    });
  });

  it("persists lifecycle events and derives task outcome metrics", async () => {
    const directory = await createTemporaryDirectory();
    const eventPath = join(directory, "events.jsonl");

    await appendOrchestrationEvent({
      eventPath,
      event: {
        type: "task_started",
        taskId: "task-success",
        orchestrationId: "run-success",
        agentType: "general",
        timestamp: "2026-07-19T00:00:00.000Z",
      },
    });
    await appendOrchestrationEvent({
      eventPath,
      event: {
        type: "task_completed",
        taskId: "task-success",
        orchestrationId: "run-success",
        agentType: "general",
        timestamp: "2026-07-19T00:00:10.000Z",
        durationMs: 10_000,
        retryCount: 1,
        verificationPassed: true,
        evidenceCount: 2,
        usage: {
          inputTokens: 100,
          outputTokens: 50,
          cacheReadTokens: 25,
          cacheWriteTokens: 0,
          totalTokens: 175,
          cost: 0.04,
          provider: "provider-a",
          model: "model-a",
        },
      },
    });
    await appendOrchestrationEvent({
      eventPath,
      event: {
        type: "review_completed",
        taskId: "task-review",
        orchestrationId: "run-review",
        agentType: "reviewer",
        timestamp: "2026-07-19T00:00:20.000Z",
        reviewFindings: 4,
        acceptedFindings: 3,
      },
    });
    await appendOrchestrationEvent({
      eventPath,
      event: {
        type: "task_started",
        taskId: "task-stale",
        orchestrationId: "run-stale",
        agentType: "general",
        timestamp: "2026-07-19T00:00:00.000Z",
      },
    });
    await appendOrchestrationEvent({
      eventPath,
      event: {
        type: "task_resumed",
        taskId: "task-resumed-stale",
        orchestrationId: "run-resumed-stale",
        agentType: "general",
        timestamp: "2026-07-19T00:00:00.000Z",
      },
    });

    const events = await readOrchestrationEvents(eventPath);
    expect(events).toHaveLength(5);
    expect(
      deriveOrchestrationMetrics({
        events,
        now: new Date("2026-07-19T01:00:00.000Z"),
        staleAfterMs: 30 * 60 * 1_000,
      }),
    ).toEqual({
      tasksStarted: 2,
      tasksCompleted: 1,
      tasksFailed: 0,
      staleTasks: 2,
      retries: 1,
      totalDurationMs: 10_000,
      averageDurationMs: 10_000,
      totalTokens: 175,
      totalCost: 0.04,
      verificationPassRate: 1,
      reviewYield: 0.75,
      taskSuccessRate: 1,
      tokensPerCompletedTask: 175,
      costPerCompletedTask: 0.04,
    });
  });

  it("deduplicates correctness events by durable idempotency key", async () => {
    const directory = await createTemporaryDirectory();
    const eventPath = join(directory, "events.jsonl");
    const first = await appendOrchestrationEvent({
      eventPath,
      event: {
        type: "task_completed",
        taskId: "task-once",
        orchestrationId: "invocation-once",
        idempotencyKey: "invocation-once:completed",
      },
    });
    const duplicate = await appendOrchestrationEvent({
      eventPath,
      event: {
        type: "task_completed",
        taskId: "task-once",
        orchestrationId: "invocation-once",
        idempotencyKey: "invocation-once:completed",
      },
    });
    expect(duplicate.id).toBe(first.id);
    expect(await readOrchestrationEvents(eventPath)).toHaveLength(1);
  });

  it("repairs a truncated tail before allocating the next sequence under the journal lock", async () => {
    const directory = await createTemporaryDirectory();
    const eventPath = join(directory, "events.jsonl");
    const first = await appendOrchestrationEvent({
      eventPath,
      event: {
        type: "task_completed",
        taskId: "task-first",
        orchestrationId: "invocation-first",
      },
    });
    await writeFile(eventPath, `${JSON.stringify(first)}\n{\"id\":\"truncated`, "utf8");

    const second = await appendOrchestrationEvent({
      eventPath,
      event: {
        type: "task_completed",
        taskId: "task-second",
        orchestrationId: "invocation-second",
      },
    });

    expect(first.sequence).toBe(1);
    expect(second.sequence).toBe(2);
    expect((await readOrchestrationEvents(eventPath)).map((event) => event.id)).toEqual([
      first.id,
      second.id,
    ]);
  });

  it("keeps correctness events while telemetry fields are opted out", async () => {
    const directory = await createTemporaryDirectory();
    const eventPath = join(directory, "events.jsonl");
    process.env.PI_SUBAGENTS_NO_TELEMETRY = "1";
    await appendOrchestrationEvent({
      eventPath,
      event: {
        type: "task_execution_completed",
        taskId: "task-1",
        orchestrationId: "invocation-1",
        durationMs: 100,
        usage: {
          inputTokens: 1,
          outputTokens: 1,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          totalTokens: 2,
          cost: 0.01,
        },
      },
    });
    const [event] = await readOrchestrationEvents(eventPath);
    expect(event?.type).toBe("task_execution_completed");
    expect(event?.durationMs).toBeUndefined();
    expect(event?.usage).toBeUndefined();
  });

  it("strips only optional cost/usage fields under the telemetry opt-out, never correctness fields", async () => {
    const directory = await createTemporaryDirectory();
    const eventPath = join(directory, "events.jsonl");
    process.env.PI_SUBAGENTS_NO_TELEMETRY = "1";
    await appendOrchestrationEvent({
      eventPath,
      event: {
        type: "task_awaiting_decision",
        taskId: "task-contract",
        orchestrationId: "invocation-contract",
        agentType: "general",
        reportedOutcome: "awaiting-decision",
        decisionId: "decision-contract-1",
        reason: "Premise in dispute; parent must choose.",
        reasonCode: "INDEPENDENT_REVIEW_REQUIRED",
        verdict: "changes_requested",
        reviewerTaskId: "task-reviewer",
        reviewerOutputDigest: "sha256:v1:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        subjectDigest: "sha256:v1:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",

        idempotencyKey: "invocation-contract:outcome:awaiting-decision",
        durationMs: 100,
        retryCount: 1,
        reviewFindings: 3,
        acceptedFindings: 2,
        usage: {
          inputTokens: 1,
          outputTokens: 1,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          totalTokens: 2,
          cost: 0.01,
        },
      },
    });
    const [event] = await readOrchestrationEvents(eventPath);
    expect(event?.type).toBe("task_awaiting_decision");
    expect(event?.taskId).toBe("task-contract");
    expect(event?.orchestrationId).toBe("invocation-contract");
    expect(event?.reportedOutcome).toBe("awaiting-decision");
    expect(event?.decisionId).toBe("decision-contract-1");
    expect(event?.reason).toBe("Premise in dispute; parent must choose.");
    expect(event?.reasonCode).toBe("INDEPENDENT_REVIEW_REQUIRED");
    expect(event?.verdict).toBe("changes_requested");
    expect(event?.reviewerTaskId).toBe("task-reviewer");
    expect(event?.reviewerOutputDigest).toBe("sha256:v1:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    expect(event?.subjectDigest).toBe("sha256:v1:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
    expect(event?.idempotencyKey).toBe("invocation-contract:outcome:awaiting-decision");
    expect(event?.durationMs).toBeUndefined();
    expect(event?.retryCount).toBeUndefined();
    expect(event?.reviewFindings).toBeUndefined();
    expect(event?.acceptedFindings).toBeUndefined();
    expect(event?.usage).toBeUndefined();
  });

  it("clamps reason text to 1,024 characters at write time", async () => {
    const directory = await createTemporaryDirectory();
    const eventPath = join(directory, "events.jsonl");
    const shortReason = await appendOrchestrationEvent({
      eventPath,
      event: {
        type: "task_awaiting_review",
        taskId: "task-clamp",
        orchestrationId: "invocation-clamp",
        reason: "x".repeat(512),
      },
    });
    expect(shortReason.reason).toBe("x".repeat(512));

    const clamped = await appendOrchestrationEvent({
      eventPath,
      event: {
        type: "task_awaiting_review",
        taskId: "task-clamp-long",
        orchestrationId: "invocation-clamp",
        reason: `secret=super-secret ${"y".repeat(5_000)}`,
      },
    });
    expect(clamped.reason).toHaveLength(1_024);
    expect(clamped.reason).toContain("secret=[REDACTED]");
    expect(clamped.reason).not.toContain("super-secret");

    const [clampedEvent] = (await readOrchestrationEvents(eventPath)).filter(
      (event) => event.taskId === "task-clamp-long",
    );
    expect(clampedEvent?.reason).toHaveLength(1_024);
    expect(clampedEvent?.reason).not.toContain("super-secret");
  });
});

describe("journal rotation retention", () => {
  function eventLine(sequence: number, marker: string): string {
    return JSON.stringify({
      version: 1,
      id: `event-${sequence}`,
      type: "task_started",
      orchestrationId: "orch-retention",
      timestamp: new Date().toISOString(),
      sequence,
      ...(marker ? { taskId: marker } : {}),
    });
  }

  function rotatedPath(eventPath: string, generation: number): string {
    return `events.${generation}.jsonl`;
  }

  async function rotatedGenerations(directory: string): Promise<number[]> {
    const entries = await readdir(directory);
    return entries
      .filter((name) => /^events\.\d+\.jsonl$/u.test(name))
      .map((name) => Number(name.match(/^events\.(\d+)\.jsonl$/u)![1]))
      .sort((a, b) => a - b);
  }

  it("deletes rotated segments past the cap when the journal rotates", async () => {
    const directory = await createTemporaryDirectory();
    const eventPath = join(directory, "events.jsonl");

    // Twelve pre-existing rotated segments: older than the retention cap.
    for (let generation = 1; generation <= 12; generation += 1) {
      await writeFile(
        join(directory, rotatedPath(eventPath, generation)),
        `${eventLine(generation, `task-gen-${generation}`)}\n`,
        "utf8",
      );
    }

    // A live segment that crosses the rotation threshold on the next append,
    // with a valid sidecar index so no rebuild is needed.
    const liveLines: string[] = [];
    let liveBytes = 0;
    let sequence = 100;
    while (liveBytes < MAX_SEGMENT_BYTES) {
      const line = eventLine(sequence, `task-live-${sequence}`);
      liveLines.push(line);
      liveBytes += Buffer.byteLength(line, "utf8") + 1; // + the joining newline
      sequence += 1;
    }
    const live = `${liveLines.join("\n")}\n`;
    await writeFile(eventPath, live, "utf8");
    await writeFile(
      `${eventPath}.index.json`,
      `${JSON.stringify({
        version: 1,
        generation: 13,
        lastSequence: sequence - 1,
        bytes: Buffer.byteLength(live, "utf8"),
        keyed: {},
      })}\n`,
      "utf8",
    );

    const appended = await appendOrchestrationEvent({
      eventPath,
      event: { type: "task_completed", orchestrationId: "orch-retention", taskId: "task-rotate" },
    });
    expect(appended.sequence).toBe(sequence);

    // The live segment rotated into generation 13; the oldest segments were
    // deleted so at most MAX_ROTATED_SEGMENTS remain.
    const generations = await rotatedGenerations(directory);
    expect(generations[0]).toBe(4);
    expect(generations.at(-1)).toBe(13);
    expect(generations.length).toBe(MAX_ROTATED_SEGMENTS);
  });

  it("reads only live + the newest rotated segments on legacy journals", async () => {
    const directory = await createTemporaryDirectory();
    const eventPath = join(directory, "events.jsonl");

    // Fifteen rotated segments: more than the cap a legacy install may have.
    for (let generation = 1; generation <= 15; generation += 1) {
      await writeFile(
        join(directory, rotatedPath(eventPath, generation)),
        `${eventLine(generation * 1_000, `task-gen-${generation}`)}\n`,
        "utf8",
      );
    }
    await writeFile(eventPath, `${eventLine(99_999, "task-live")}\n`, "utf8");

    const events = await readOrchestrationEvents(eventPath);
    const markers = events
      .map((event) => event.taskId)
      .filter((taskId): taskId is string => taskId !== undefined);

    // Segments 1-5 were never loaded: only generations 6-15 + live are read.
    expect(markers).not.toContain("task-gen-1");
    expect(markers).not.toContain("task-gen-5");
    expect(markers).toContain("task-gen-6");
    expect(markers).toContain("task-gen-15");
    expect(markers).toContain("task-live");
    expect(events.length).toBe(MAX_ROTATED_SEGMENTS + 1);
  });
});
