import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { isResourceClaim } from "./claims.js";
import { normalizeOrchestrationReason, } from "./reason-codes.js";
import { withFileLock } from "./file-lock.js";
const RUN_STORE_VERSION = 1;
/**
 * Retention for TERMINAL runs in the run store. The store used to grow
 * without bound: every heartbeat, launch event, and pending-completion
 * retry paid a lock + full read + full rewrite of `runs.json`, so the cost
 * was O(all tasks ever) on a hot path. Terminal runs older than this window
 * are pruned (lazily, on write, when the store exceeds the cap below).
 */
export const RUN_STORE_RETENTION_MS = 7 * 24 * 60 * 60 * 1_000; // 7 days
/** Hard cap on stored runs; oldest prunable terminal runs shed beyond it. */
export const RUN_STORE_MAX_RUNS = 1_000;
export function createDurableRun(input) {
    const now = input.startedAt ?? new Date().toISOString();
    return {
        version: RUN_STORE_VERSION,
        invocationId: input.invocationId ?? randomUUID(),
        ...(input.correlationId ? { correlationId: input.correlationId } : {}),
        ...(input.contextRequestDigest
            ? { contextRequestDigest: input.contextRequestDigest }
            : {}),
        ...(input.learningBinding ? { learningBinding: { ...input.learningBinding } } : {}),
        ...(input.usageBindings ? { usageBindings: [...input.usageBindings] } : {}),
        ...(input.batchId ? { batchId: input.batchId } : {}),
        ...(input.joinMode ? { joinMode: input.joinMode } : {}),
        ...(input.agentType ? { agentType: input.agentType } : {}),
        ...(input.description ? { description: input.description } : {}),
        projectDirectory: input.projectDirectory,
        workspaceDirectory: input.workspaceDirectory ?? input.projectDirectory,
        executionDirectory: input.executionDirectory ?? input.workspaceDirectory ?? input.projectDirectory,
        startedAt: now,
        updatedAt: now,
        heartbeatAt: now,
        executionPhase: "allocating",
        reportedOutcome: "unknown",
        verificationPhase: input.proof ? "pending" : "not-required",
        reviewPhase: input.verifier?.required ? "awaiting" : "not-required",
        verificationIssues: [],
        claims: (input.claims ?? []).map((claim) => ({ ...claim })),
        ...(input.lease ? { lease: cloneLease(input.lease) } : {}),
        ...(input.leaseTtlMs ? { leaseTtlMs: input.leaseTtlMs } : {}),
        ...(input.contextPack ? { contextPack: structuredClone(input.contextPack) } : {}),
        ...(input.proof ? { proof: structuredClone(input.proof) } : {}),
        ...(input.verifier ? { verifier: structuredClone(input.verifier) } : {}),
    };
}
export async function putDurableRun(storePath, run) {
    return withRunStore(storePath, async (document) => {
        const index = document.runs.findIndex((candidate) => candidate.invocationId === run.invocationId);
        const persisted = structuredClone(run);
        if (persisted.correlationId?.startsWith("decision-resume:") &&
            document.runs.some((candidate) => candidate.invocationId !== persisted.invocationId &&
                candidate.correlationId === persisted.correlationId)) {
            throw new Error(`Decision resume correlation ${persisted.correlationId} already has a durable invocation`);
        }
        if (index === -1) {
            document.runs.push(persisted);
        }
        else {
            const current = document.runs[index];
            if (isTerminalExecutionPhase(current.executionPhase)) {
                if (persisted.resultDigest === current.resultDigest && persisted.resultDigest) {
                    return structuredClone(current);
                }
                throw new Error(`Cannot overwrite terminal durable run ${run.invocationId}`);
            }
            document.runs[index] = persisted;
        }
        return structuredClone(persisted);
    });
}
/**
 * Atomically claim a run's terminal result. Replaying the exact digest is
 * idempotent; a competing terminal observation with different bytes fails.
 */
export async function completeDurableRun(storePath, invocationId, resultDigest, patch) {
    if (!isTaggedSha256(resultDigest)) {
        throw new Error("Terminal result digest must be a tagged SHA-256 digest");
    }
    if (!isTerminalExecutionPhase(patch.executionPhase)) {
        throw new Error(`Terminal completion requires a terminal execution phase`);
    }
    return withRunStore(storePath, async (document) => {
        const index = document.runs.findIndex((candidate) => candidate.invocationId === invocationId);
        if (index === -1)
            return undefined;
        const current = document.runs[index];
        if (isTerminalExecutionPhase(current.executionPhase)) {
            if (current.resultDigest === resultDigest)
                return structuredClone(current);
            throw new Error(`Conflicting terminal result for ${invocationId}: ` +
                `${current.resultDigest ?? "legacy-unbound"} != ${resultDigest}`);
        }
        if (!canTransitionExecution(current.executionPhase, patch.executionPhase)) {
            throw new Error(`Invalid task execution transition: ${current.executionPhase} -> ${patch.executionPhase}`);
        }
        const updated = {
            ...current,
            ...structuredClone(patch),
            version: RUN_STORE_VERSION,
            invocationId: current.invocationId,
            resultDigest,
            updatedAt: new Date().toISOString(),
        };
        document.runs[index] = updated;
        return structuredClone(updated);
    });
}
export async function patchDurableRun(storePath, invocationId, patch) {
    return withRunStore(storePath, async (document) => {
        const index = document.runs.findIndex((candidate) => candidate.invocationId === invocationId);
        if (index === -1)
            return undefined;
        const current = document.runs[index];
        const changes = typeof patch === "function" ? patch(structuredClone(current)) : patch;
        if (changes.executionPhase !== undefined &&
            !canTransitionExecution(current.executionPhase, changes.executionPhase)) {
            throw new Error(`Invalid task execution transition: ${current.executionPhase} -> ${changes.executionPhase}`);
        }
        const normalizedChanges = changes.blockedReason === undefined
            ? changes
            : { ...changes, blockedReason: normalizeOrchestrationReason(changes.blockedReason) };
        const updated = {
            ...current,
            ...structuredClone(normalizedChanges),
            version: RUN_STORE_VERSION,
            invocationId: current.invocationId,
            updatedAt: new Date().toISOString(),
        };
        document.runs[index] = updated;
        return structuredClone(updated);
    });
}
export async function getDurableRunByTaskId(storePath, taskId) {
    const document = await readRunStore(storePath);
    const run = document.runs
        .filter((candidate) => candidate.taskId === taskId)
        .sort((left, right) => right.startedAt.localeCompare(left.startedAt))[0];
    return run ? structuredClone(run) : undefined;
}
/** Find the attempt that owns a durable decision, even after a later resume. */
export async function getDurableRunByDecisionId(storePath, taskId, decisionId) {
    const document = await readRunStore(storePath);
    const run = document.runs
        .filter((candidate) => candidate.taskId === taskId &&
        candidate.decisionRequest?.id === decisionId)
        .sort((left, right) => right.startedAt.localeCompare(left.startedAt))[0];
    return run ? structuredClone(run) : undefined;
}
export async function getDurableRunByInvocationId(storePath, invocationId) {
    const document = await readRunStore(storePath);
    const run = document.runs.find((candidate) => candidate.invocationId === invocationId);
    return run ? structuredClone(run) : undefined;
}
export async function listDurableRuns(storePath) {
    return (await readRunStore(storePath)).runs.map((run) => structuredClone(run));
}
export function canTransitionExecution(current, next) {
    if (current === next)
        return true;
    const allowed = {
        allocating: ["starting", "working", "blocked", "completed", "failed", "cancelled", "timeout"],
        starting: ["working", "blocked", "failed", "cancelled", "timeout"],
        working: ["blocked", "completed", "failed", "cancelled", "timeout"],
        blocked: ["working", "completed", "failed", "cancelled", "timeout"],
        completed: [],
        failed: [],
        cancelled: [],
        timeout: [],
    };
    return allowed[current].includes(next);
}
export function isTerminalExecutionPhase(phase) {
    return (phase === "completed" ||
        phase === "failed" ||
        phase === "cancelled" ||
        phase === "timeout");
}
async function withRunStore(storePath, operation) {
    return withFileLock({
        lockPath: `${storePath}.lock`,
        operation: async () => {
            const document = await readRunStore(storePath);
            const result = await operation(document);
            // Lazy retention: only when the store is over the cap, and only on the
            // write path — reads stay cheap and never rewrite the store.
            pruneRunStore(document);
            await writeRunStore(storePath, document);
            return result;
        },
    });
}
/** Whether a terminal run is safe to drop from the store. */
function isPrunableRun(run, nowMs) {
    if (!isTerminalExecutionPhase(run.executionPhase))
        return false;
    // An unexpired lease means the run can still be re-established or reviewed.
    if (run.lease && Date.parse(run.lease.expiresAt) > nowMs)
        return false;
    // A pending durable decision is in-flight work, not history: a decision
    // response resumes through the run's correlation and must find it.
    if (run.decisionRequest?.status === "pending")
        return false;
    return true;
}
/**
 * Drop terminal runs that outgrew retention. Triggered lazily on write only
 * when the store is over the cap; under the cap the store is untouched so a
 * quiet project never pays a pruning rewrite.
 *
 * Two bounds: the retention window (terminal runs older than it are stale
 * history), and the hard cap (the oldest prunable terminal runs are shed to
 * get back under it, even if younger than the window — an unbounded store is
 * exactly the growth being fixed).
 */
function pruneRunStore(document) {
    if (document.runs.length <= RUN_STORE_MAX_RUNS)
        return;
    const nowMs = Date.now();
    const cutoffMs = nowMs - RUN_STORE_RETENTION_MS;
    document.runs = document.runs.filter((run) => {
        if (!isPrunableRun(run, nowMs))
            return true;
        const updatedAtMs = Date.parse(run.updatedAt);
        return !(Number.isFinite(updatedAtMs) && updatedAtMs < cutoffMs);
    });
    if (document.runs.length <= RUN_STORE_MAX_RUNS)
        return;
    const prunable = document.runs
        .filter((run) => isPrunableRun(run, nowMs))
        .sort((left, right) => left.updatedAt.localeCompare(right.updatedAt));
    const toDrop = new Set(prunable.slice(0, document.runs.length - RUN_STORE_MAX_RUNS).map((run) => run.invocationId));
    document.runs = document.runs.filter((run) => !toDrop.has(run.invocationId));
}
let reportRunStoreQuarantine = () => undefined;
export function setRunStoreQuarantineReporter(reporter) {
    reportRunStoreQuarantine = reporter;
}
/**
 * Read the run store, quarantining one that cannot be understood.
 *
 * Same rationale as the lease store: throwing forever on a bad file is a
 * denial of service on recovery and on every tool that lists runs, and a store
 * written by an older build can now contain claims the stricter validation
 * rejects. The bad file is moved aside as evidence and the system continues —
 * runs are re-established from panes and session history by recovery.
 */
async function readRunStore(storePath) {
    let raw;
    try {
        raw = await readFile(storePath, "utf8");
    }
    catch (error) {
        if (isNodeError(error) && error.code === "ENOENT") {
            return { version: RUN_STORE_VERSION, runs: [] };
        }
        throw error;
    }
    let value;
    try {
        value = JSON.parse(raw);
    }
    catch (error) {
        return quarantineRunStore(storePath, `unparseable JSON: ${error.message}`);
    }
    if (!isRunStoreDocument(value)) {
        return quarantineRunStore(storePath, "store failed schema validation");
    }
    return {
        version: RUN_STORE_VERSION,
        runs: value.runs.map(normalizePersistedRun),
    };
}
async function quarantineRunStore(storePath, reason) {
    const quarantinePath = `${storePath}.corrupt-${Date.now()}-${randomUUID().slice(0, 8)}`;
    try {
        await rename(storePath, quarantinePath);
    }
    catch {
        // If it cannot be moved we still continue; the next write replaces it.
    }
    try {
        reportRunStoreQuarantine({ storePath, quarantinePath, reason });
    }
    catch {
        // A reporter must never be able to break the store.
    }
    return { version: RUN_STORE_VERSION, runs: [] };
}
async function writeRunStore(storePath, document) {
    await mkdir(dirname(storePath), { recursive: true });
    const temporaryPath = `${storePath}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(document, null, 2)}\n`, "utf8");
    await rename(temporaryPath, storePath);
}
function cloneLease(lease) {
    return { ...lease, claims: lease.claims.map((claim) => ({ ...claim })) };
}
function isRunStoreDocument(value) {
    return (isRecord(value) &&
        value.version === RUN_STORE_VERSION &&
        Array.isArray(value.runs) &&
        value.runs.every(isDurableTaskRun));
}
function isDurableTaskRun(value) {
    return (isRecord(value) &&
        value.version === RUN_STORE_VERSION &&
        typeof value.invocationId === "string" &&
        typeof value.projectDirectory === "string" &&
        (value.workspaceDirectory === undefined ||
            typeof value.workspaceDirectory === "string") &&
        typeof value.executionDirectory === "string" &&
        typeof value.startedAt === "string" &&
        typeof value.updatedAt === "string" &&
        typeof value.heartbeatAt === "string" &&
        isExecutionPhase(value.executionPhase) &&
        (value.reportedOutcome === undefined || isReportedOutcome(value.reportedOutcome)) &&
        isVerificationPhase(value.verificationPhase) &&
        isReviewPhase(value.reviewPhase) &&
        Array.isArray(value.verificationIssues) &&
        value.verificationIssues.every((issue) => typeof issue === "string") &&
        // Validate the ELEMENTS, not just the array. A run whose claims were never
        // checked is re-acquired verbatim on recovery, so a malformed claim that
        // never passed through the tool boundary still reached the lease store.
        Array.isArray(value.claims) &&
        value.claims.every(isResourceClaim) &&
        (value.semanticAttestations === undefined ||
            (Array.isArray(value.semanticAttestations) &&
                value.semanticAttestations.length <= 20 &&
                value.semanticAttestations.every(isSemanticAttestation))) &&
        (value.resultDigest === undefined || isTaggedSha256(value.resultDigest)) &&
        (value.decisionRequest === undefined || isDecisionRequest(value.decisionRequest)));
}
function normalizePersistedRun(run) {
    const { semanticBindingKey: _legacySemanticBindingKey, ...withoutLegacySecret } = structuredClone(run);
    return {
        ...withoutLegacySecret,
        workspaceDirectory: run.workspaceDirectory ?? run.projectDirectory,
        // A legacy `completed` phase does not establish semantic success.  The
        // fail-closed migration keeps it unknown until a fresh child result is
        // parsed and durably recorded.
        reportedOutcome: run.reportedOutcome ?? "unknown",
    };
}
function isSemanticAttestation(value) {
    return (isRecord(value) &&
        typeof value.claim === "string" &&
        value.claim.length > 0 &&
        value.claim.length <= 1_000 &&
        (value.claimId === undefined || isTaggedSha256(value.claimId)) &&
        typeof value.receiptId === "string" &&
        value.receiptId.length > 0 &&
        value.receiptId.length <= 256 &&
        typeof value.artifactDigest === "string" &&
        /^sha256:[a-f0-9]{64}$/u.test(value.artifactDigest) &&
        typeof value.reviewerTaskId === "string" &&
        typeof value.reviewerInvocationId === "string" &&
        typeof value.reviewerOutputDigest === "string" &&
        /^sha256:[a-f0-9]{64}$/u.test(value.reviewerOutputDigest) &&
        typeof value.subjectDigest === "string" &&
        /^sha256:[a-f0-9]{64}$/u.test(value.subjectDigest) &&
        typeof value.attestedAt === "string");
}
function isReportedOutcome(value) {
    return [
        "unknown",
        "success",
        "failure",
        "blocked",
        "partial",
        "reframed",
        "awaiting-decision",
    ].includes(String(value));
}
function isDecisionRequest(value) {
    if (!isRecord(value) ||
        typeof value.id !== "string" ||
        typeof value.question !== "string" ||
        typeof value.requestedAt !== "string" ||
        !isTaggedSha256(value.requestDigest) ||
        !["pending", "resolved"].includes(String(value.status)) ||
        !Array.isArray(value.options) ||
        !value.options.every((option) => isRecord(option) &&
            typeof option.id === "string" &&
            typeof option.label === "string" &&
            (option.tradeoff === undefined || typeof option.tradeoff === "string"))) {
        return false;
    }
    if (value.context !== undefined && typeof value.context !== "string")
        return false;
    if (value.response === undefined)
        return value.status === "pending";
    return (value.status === "resolved" &&
        isRecord(value.response) &&
        (value.response.optionId === undefined || typeof value.response.optionId === "string") &&
        typeof value.response.response === "string" &&
        typeof value.response.respondedAt === "string" &&
        isTaggedSha256(value.response.responseDigest) &&
        (value.response.resumeCorrelationId === undefined ||
            typeof value.response.resumeCorrelationId === "string") &&
        (value.response.resumeState === undefined ||
            ["dispatching", "started", "failed"].includes(String(value.response.resumeState))) &&
        (value.response.resumeAttemptId === undefined ||
            typeof value.response.resumeAttemptId === "string") &&
        (value.response.resumeDispatcherId === undefined ||
            typeof value.response.resumeDispatcherId === "string") &&
        (value.response.resumeDispatchStartedAt === undefined ||
            typeof value.response.resumeDispatchStartedAt === "string") &&
        (value.response.resumeError === undefined ||
            typeof value.response.resumeError === "string") &&
        (value.response.resumedInvocationId === undefined ||
            typeof value.response.resumedInvocationId === "string"));
}
function isTaggedSha256(value) {
    return typeof value === "string" && /^sha256:v1:[a-f0-9]{64}$/u.test(value);
}
function isExecutionPhase(value) {
    return [
        "allocating",
        "starting",
        "working",
        "blocked",
        "completed",
        "failed",
        "cancelled",
        "timeout",
    ].includes(String(value));
}
function isVerificationPhase(value) {
    return [
        "not-required",
        "pending",
        "receipt-passed",
        "passed",
        "failed",
    ].includes(String(value));
}
function isReviewPhase(value) {
    return ["not-required", "awaiting", "accepted", "rejected"].includes(String(value));
}
function isRecord(value) {
    return typeof value === "object" && value !== null;
}
function isNodeError(error) {
    return error instanceof Error && "code" in error;
}
