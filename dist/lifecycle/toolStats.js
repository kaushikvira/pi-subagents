import { join } from "node:path";
import { readRecentToolCalls } from "../helpers.js";
export function startToolStatsPolling(foregroundTasks, backgroundTasks, intervalMs, onUpdate) {
    return setInterval(() => {
        const trackedTasks = [
            ...foregroundTasks.entries(),
            ...backgroundTasks.entries(),
        ];
        let changed = false;
        for (const [id, task] of trackedTasks) {
            if (task.backend === "sdk")
                continue;
            const sessionDir = join(task.dir, "sessions", id);
            const { toolUses, turns, recent } = readRecentToolCalls(sessionDir, 12, task.sessionName);
            if (task.toolUses !== toolUses ||
                task.turns !== turns ||
                JSON.stringify(task.recentCalls) !== JSON.stringify(recent)) {
                changed = true;
                task.toolUses = toolUses;
                task.turns = turns;
                task.recentCalls = recent;
            }
        }
        if (changed)
            onUpdate?.();
    }, intervalMs);
}
