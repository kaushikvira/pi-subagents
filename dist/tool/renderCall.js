import { Container, Text } from "@earendil-works/pi-tui";
import { formatElapsed } from "../helpers.js";
import { renderTaskAgentTitle, renderTaskTitleText } from "./taskTitle.js";
/** Sticky header only: agent • tools • duration. Tool lines stream via onUpdate content. */
export function renderCall(args, theme) {
    const container = new Container();
    const progress = args._taskRunningProgress;
    const agentType = progress?.agentType ?? String(args.agent_type ?? "task");
    const description = String(args.description ?? "").trim();
    const toolUses = progress?.toolUses ?? 0;
    const elapsedMs = progress?.durationMs ?? 0;
    const sep = theme.fg("muted", " • ");
    const summary = toolUses === 0 && elapsedMs < 1_000 && description
        ? renderTaskTitleText(agentType, description, theme)
        : renderTaskAgentTitle(agentType, theme) +
            sep +
            theme.fg("text", formatToolCount(toolUses)) +
            sep +
            theme.fg("success", formatElapsed(elapsedMs));
    container.addChild(new Text(summary, 0, 0));
    return container;
}
function formatToolCount(n) {
    return n === 1 ? "1 toolcall" : `${n} toolcalls`;
}
