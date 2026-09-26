export async function resolveSdkModel(ctx, requested) {
    const registry = ctx.modelRegistry;
    if (requested) {
        const [provider, ...rest] = requested.split("/");
        const modelId = rest.join("/");
        if (modelId) {
            const exact = registry.find(provider, modelId);
            if (exact)
                return exact;
        }
    }
    // MODIFIED: Subagents use Pi's global defaults, not the parent session's current model.
    // This gives subagents independence from temporary parent model switches.
    // Removed: } else if (ctx.model) { return ctx.model; }
    const all = registry.getAll();
    const available = all.length > 0 ? all : registry.getAvailable();
    if (requested) {
        const byId = available.find((model) => model.id === requested ||
            `${model.provider}/${model.id}` === requested ||
            model.name === requested);
        if (byId)
            return byId;
        throw new Error(`Requested subagent model "${requested}" is not available`);
    }
    // Returns the first available model (Pi's default configuration order)
    return available[0];
}
export async function runSdkSubagent(options) {
    const model = await resolveSdkModel(options.ctx, options.model ?? options.agent.model);
    if (!model) {
        throw new Error("No model available for SDK subagent execution");
    }
    const { createAgentSession, DefaultResourceLoader, getAgentDir } = await import("@earendil-works/pi-coding-agent");
    let session;
    let unsubSession;
    try {
        const agentDir = getAgentDir();
        const resourceLoader = new DefaultResourceLoader({
            cwd: options.cwd,
            agentDir,
            systemPrompt: options.systemPrompt,
            noExtensions: true,
        });
        await resourceLoader.reload();
        ({ session } = await createAgentSession({
            cwd: options.cwd,
            agentDir,
            model,
            thinkingLevel: normalizeThinkingLevel(options.thinkingLevel),
            tools: options.tools,
            excludeTools: options.excludeTools,
            resourceLoader,
        }));
        if (options.onSession) {
            unsubSession = options.onSession(session);
        }
        await session.prompt(options.prompt);
        const sessionPath = session.sessionFile;
        const output = getLastAssistantText(session.messages);
        return { output: output.trim(), sessionPath };
    }
    finally {
        unsubSession?.();
        session?.dispose();
    }
}
function normalizeThinkingLevel(value) {
    if (value === "off" ||
        value === "minimal" ||
        value === "low" ||
        value === "medium" ||
        value === "high" ||
        value === "xhigh") {
        return value;
    }
    return undefined;
}
function getLastAssistantText(messages) {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
        const message = messages[index];
        if (!isRecord(message) || message.role !== "assistant")
            continue;
        const content = message.content;
        if (typeof content === "string")
            return content;
        if (Array.isArray(content)) {
            return content
                .map((part) => {
                if (typeof part === "string")
                    return part;
                if (isRecord(part) && typeof part.text === "string")
                    return part.text;
                return "";
            })
                .filter(Boolean)
                .join("\n");
        }
    }
    return "";
}
function isRecord(value) {
    return typeof value === "object" && value !== null;
}
