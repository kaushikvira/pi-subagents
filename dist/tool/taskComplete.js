import { Box, Container, Text } from "@earendil-works/pi-tui";
import { renderTaskResultBody, } from "./renderTaskResultBody.js";
import { renderTaskTitleText } from "./taskTitle.js";
/**
 * Renderer for background task completion notifications.
 * Same structured sections as foreground task renderResult (Ctrl+O).
 */
export function createTaskCompleteRenderer() {
    return (message, { expanded }, theme) => {
        const d = (message.details ?? {});
        if (!d.agent_type && !d.description && !d.summary && !d.result) {
            return undefined;
        }
        const root = new Container();
        const agentType = d.agent_type || "task";
        const desc = d.description || "";
        const title = renderTaskTitleText(agentType, desc, theme);
        root.addChild(new Text(" " + title, 0, 0));
        const summaryText = (d.summary || "").trim();
        const body = renderTaskResultBody(d, summaryText, { expanded, indentHint: true }, theme);
        root.addChild(body);
        if (root.children.length === 0)
            return undefined;
        const box = new Box(0, 1, (text) => theme.bg("toolSuccessBg", text));
        for (const child of root.children) {
            box.addChild(child);
        }
        return box;
    };
}
