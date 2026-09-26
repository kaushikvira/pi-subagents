import { TASK_PROMPT_INSTRUCTIONS, TASK_RESULT_XML_INSTRUCTIONS } from "../helpers.js";
const TASK_WORKSPACE_SCOPE = `## Workspace scope

The **Working Directory** below is the parent Pi session cwd. Treat it as the default repository root for this task.

- **explore** and **general**: search and cite code under that directory unless the Instructions name a different absolute path.
- Do not search sibling repos, home-directory projects, or unrelated workspaces unless the Instructions explicitly require it.
- **scout**: prefer external docs/web; only read local files when the Instructions name paths or you must compare local usage under the Working Directory.`;
export function buildTaskPrompt(options) {
    return [
        `# Task: ${options.description}`,
        "",
        "## Agent",
        `${options.agentName} (${options.agentSource})`,
        "",
        "## Instructions",
        options.prompt,
        "",
        "## Working Directory",
        options.cwd,
        "",
        TASK_WORKSPACE_SCOPE,
        "",
        TASK_PROMPT_INSTRUCTIONS,
        "",
        TASK_RESULT_XML_INSTRUCTIONS,
    ].join("\n");
}
