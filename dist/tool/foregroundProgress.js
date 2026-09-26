import { countToolUses, formatForegroundProgressText } from "../helpers.js";
import { FOREGROUND_PROGRESS_POLL_MS } from "../constants.js";
function flushOnUpdate(onUpdate, progress, theme) {
    const text = formatForegroundProgressText(progress, theme);
    onUpdate({
        content: text ? [{ type: "text", text }] : [],
        details: {
            _taskRunningProgress: progress,
        },
    });
}
export function startForegroundProgressPolling(options) {
    const { taskId, sessionDir, sessionName, agentType, startedAt, onUpdate } = options;
    let lastToolUses = -1;
    const push = () => {
        const { toolUses } = countToolUses(sessionDir, sessionName);
        const durationMs = Date.now() - startedAt;
        if (toolUses === lastToolUses)
            return;
        lastToolUses = toolUses;
        const progress = {
            taskId,
            sessionPath: `${sessionDir}/${sessionName}.jsonl`,
            agentType,
            toolUses,
            durationMs,
        };
        const theme = { fg: (_role, text) => text };
        flushOnUpdate(onUpdate, progress, theme);
    };
    push();
    const timer = setInterval(push, FOREGROUND_PROGRESS_POLL_MS);
    return () => clearInterval(timer);
}
