const TASK_TITLE_DESCRIPTION_MAX = 72;
export function renderTaskAgentTitle(agentType, theme) {
    return theme.fg("toolTitle", `⚙ ${agentType || "task"}`);
}
export function renderTaskTitleText(agentType, description, theme) {
    const agent = renderTaskAgentTitle(agentType, theme);
    const desc = description.trim();
    if (!desc)
        return agent;
    return (agent +
        theme.fg("muted", " • ") +
        theme.fg("muted", truncateTaskTitleDescription(desc)));
}
function truncateTaskTitleDescription(text) {
    if (text.length <= TASK_TITLE_DESCRIPTION_MAX)
        return text;
    return `${text.slice(0, TASK_TITLE_DESCRIPTION_MAX - 1)}…`;
}
