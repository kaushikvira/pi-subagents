import { join } from "node:path";
export function startBackgroundPolling(deps, pollMs) {
    let stopped = false;
    let inFlight = false;
    const pollErrors = new Map();
    const tick = async () => {
        if (stopped || inFlight)
            return;
        inFlight = true;
        try {
            for (const [id, task] of deps.backgroundTasks) {
                if (task.backend === "sdk")
                    continue;
                try {
                    const elapsed = Date.now() - task.startedAt;
                    if (elapsed > deps.TASK_TIMEOUT_MS) {
                        deps.completeTask(deps.pi, id, task, `Task timed out after ${Math.round(deps.TASK_TIMEOUT_MS / 1000)}s without producing a result.`, "timeout", deps.piDir);
                        deps.backgroundTasks.delete(id);
                        deps.clearTaskWidgetIfIdle();
                        continue;
                    }
                    const snapshot = await deps.checkTaskCompletion({
                        sessionDir: join(task.dir, "sessions", id),
                        sessionName: task.sessionName,
                        paneId: task.paneId,
                        artifactsDir: task.dir,
                        taskId: id,
                        sinceMs: task.startedAt,
                        resourceExists: deps.resourceExists ? () => deps.resourceExists(task) : undefined,
                        exitSentinelPath: task.exitSentinelPath,
                    });
                    if (stopped)
                        return;
                    if (snapshot.status === "completed") {
                        deps.completeTask(deps.pi, id, task, snapshot.content, "done", deps.piDir);
                        deps.backgroundTasks.delete(id);
                        deps.clearTaskWidgetIfIdle();
                        pollErrors.delete(id);
                    }
                    else if (snapshot.status === "failed" || snapshot.status === "timeout") {
                        deps.completeTask(deps.pi, id, task, snapshot.content, snapshot.status === "timeout" ? "timeout" : "failed", deps.piDir);
                        deps.backgroundTasks.delete(id);
                        deps.clearTaskWidgetIfIdle();
                        pollErrors.delete(id);
                    }
                }
                catch (error) {
                    if (error instanceof Error && error.name === "HerdrUnavailableError") {
                        continue;
                    }
                    const count = (pollErrors.get(id) ?? 0) + 1;
                    pollErrors.set(id, count);
                    if (count >= deps.MAX_POLL_ERRORS) {
                        deps.completeTask(deps.pi, id, task, `Background task polling failed: ${error instanceof Error ? error.message : String(error)}`, "failed", deps.piDir);
                        deps.backgroundTasks.delete(id);
                        deps.clearTaskWidgetIfIdle();
                        pollErrors.delete(id);
                    }
                }
            }
        }
        finally {
            inFlight = false;
        }
    };
    const interval = setInterval(() => {
        void tick();
    }, pollMs);
    const stop = (() => {
        stopped = true;
        clearInterval(interval);
    });
    stop.tick = tick;
    return stop;
}
