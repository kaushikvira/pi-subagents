/**
 * Build `pi` CLI argv for subagent spawns.
 */
import { resolveAgentToolAllowlist } from "../agent-tools.js";
export function buildPiArgv(opts) {
    const { agent, sessionName, sessionDir, promptContent, resume } = opts;
    const allowedTools = resolveAgentToolAllowlist({
        tools: agent.tools,
        disallowedTools: agent.disallowedTools,
        readonly: agent.readonly,
        parentToolNames: opts.parentToolNames,
        taskToolName: opts.taskToolName,
    });
    const args = [];
    if (process.env.PI_TASK_CHILD_NO_EXTENSIONS === "1") {
        args.push("--no-extensions");
    }
    const model = opts.model ?? agent.model;
    if (model)
        args.push("--model", model);
    if (agent.thinking)
        args.push("--thinking", agent.thinking);
    args.push("--tools", allowedTools.join(","));
    args.push("--name", sessionName);
    args.push("--session-dir", sessionDir);
    if (resume)
        args.push("--session", opts.resumeSessionRef ?? sessionName);
    args.push("--append-system-prompt", opts.promptLaunch?.systemPromptPath ?? agent.body);
    if (!opts.promptLaunch?.deferTaskPrompt)
        args.push(promptContent);
    return args;
}
