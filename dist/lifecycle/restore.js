import { existsSync } from "node:fs";
import { readRegistry, upsertTaskSessionHistory, writeRegistry, } from "../conversation.js";
import { getAgentTerminalStopReason, hasAgentFinished, } from "../session-text.js";
import { killAgentPane, paneExists } from "../subagent/tmux.js";
import { finalizeTaskWorktree, } from "../worktree.js";
export function restoreActiveBackgroundTasks(piDir, backgroundTasks, resourceExists, closeResource) {
    const registry = readRegistry(piDir);
    const staleIds = [];
    // True once a quarantine marker was written or cleared: the durable
    // registry must be re-persisted even when nothing was removed.
    let registryDirty = false;
    for (const entry of registry) {
        if (!existsSync(entry.dir)) {
            staleIds.push(entry.id);
            continue;
        }
        const sessionFinished = hasAgentFinished(entry.dir, entry.sessionName, entry.startedAt);
        const terminalStopReason = sessionFinished
            ? getAgentTerminalStopReason(entry.dir, entry.sessionName, entry.startedAt)
            : undefined;
        const terminalStatus = terminalStopReason === "error"
            ? "failed"
            : terminalStopReason === "aborted"
                ? "cancelled"
                : "done";
        const paneId = entry.handle?.resourceId ?? entry.paneId;
        let paneAlive;
        try {
            // Fresh check: a restore decision must never ride on a TTL-cached pane
            // observation from a poll earlier in this process.
            paneAlive = resourceExists
                ? resourceExists(entry)
                : entry.handle?.backend === "herdr"
                    ? false
                    : Boolean(paneId && paneExists(paneId, { fresh: true }));
        }
        catch (error) {
            // A temporary backend outage must not destroy the durable task record,
            // but a silent `continue` is what left still-running background tasks
            // unpolled for the whole session with no trace. Quarantine the entry
            // in the durable registry (same mark/persist/report vocabulary as the
            // store quarantine) so the next session's restore picks it up, and
            // note it where an operator can see it.
            const reason = error instanceof Error ? error.message : String(error);
            entry.restoreQuarantineReason = `liveness check threw: ${reason}`;
            entry.restoreQuarantinedAt = new Date().toISOString();
            registryDirty = true;
            console.warn(`[pi-subagents] Liveness check failed for background task ${entry.id} ` +
                `(${entry.sessionName}): ${reason}. The entry was quarantined in the ` +
                `task registry for the next session restore; it will not be polled ` +
                `this session.`);
            continue;
        }
        if (entry.restoreQuarantinedAt !== undefined) {
            // The check succeeded this time: the quarantined entry is back in the
            // poll loop, so drop the durable marker.
            delete entry.restoreQuarantinedAt;
            delete entry.restoreQuarantineReason;
            registryDirty = true;
        }
        if (sessionFinished) {
            const worktreeResult = settleWorktree(entry);
            upsertTaskSessionHistory(piDir, {
                id: entry.id,
                status: terminalStatus,
                background: true,
                agentType: entry.agentType,
                description: entry.description,
                sessionName: entry.sessionName,
                startedAt: entry.startedAt,
                piDir: entry.piDir,
                dir: entry.dir,
                cwd: entry.cwd,
                paneId: entry.paneId,
                worktree: entry.worktree,
                worktreeResult,
                completedAt: Date.now(),
            });
            if (entry.handle?.backend === "herdr" && entry.handle.workspaceId) {
                try {
                    closeResource?.(entry);
                }
                catch {
                    // A missing resource is still removed from durable state below.
                }
            }
            else if (paneAlive && paneId) {
                try {
                    if (closeResource)
                        closeResource(entry);
                    else if (entry.handle?.backend !== "herdr")
                        killAgentPane(paneId, null);
                }
                catch {
                    // A missing resource is still removed from durable state below.
                }
            }
            staleIds.push(entry.id);
            continue;
        }
        if (!paneAlive) {
            const worktreeResult = settleWorktree(entry);
            if (entry.handle?.backend === "herdr" && entry.handle.workspaceId) {
                try {
                    closeResource?.(entry);
                }
                catch {
                    // A missing resource is still removed from durable state below.
                }
            }
            upsertTaskSessionHistory(piDir, {
                id: entry.id,
                status: "failed",
                background: true,
                agentType: entry.agentType,
                description: entry.description,
                sessionName: entry.sessionName,
                startedAt: entry.startedAt,
                piDir: entry.piDir,
                dir: entry.dir,
                cwd: entry.cwd,
                paneId: entry.paneId,
                worktree: entry.worktree,
                worktreeResult,
                completedAt: Date.now(),
            });
            staleIds.push(entry.id);
            continue;
        }
        backgroundTasks.set(entry.id, {
            dir: entry.dir,
            cwd: entry.cwd,
            agentType: entry.agentType,
            sessionName: entry.sessionName,
            paneId,
            handle: entry.handle,
            backend: entry.handle?.backend ?? "tmux",
            originalPane: null,
            description: entry.description,
            startedAt: entry.startedAt,
            toolUses: 0,
            turns: 0,
            conversationId: entry.conversationId,
            model: entry.model,
            worktree: entry.worktree,
            worktreeResult: entry.worktreeResult,
            recentCalls: [],
        });
    }
    if (staleIds.length || registryDirty) {
        writeRegistry(piDir, registry.filter((entry) => !staleIds.includes(entry.id)));
    }
}
function settleWorktree(entry) {
    if (entry.worktreeResult)
        return entry.worktreeResult;
    if (!entry.worktree)
        return undefined;
    try {
        return finalizeTaskWorktree(entry.worktree);
    }
    catch {
        return {
            ...entry.worktree,
            changedPaths: [],
            diffDigest: "unavailable",
            retained: true,
        };
    }
}
