export class HerdrCommandError extends Error {
    code;
    args;
    stdout;
    stderr;
    exitCode;
    transient;
    constructor(input) {
        super(input.message, { cause: input.cause });
        this.name = "HerdrCommandError";
        this.code = input.code;
        this.args = [...input.args];
        this.stdout = input.stdout ?? "";
        this.stderr = input.stderr ?? "";
        this.exitCode = input.exitCode;
        this.transient = isTransientHerdrCode(input.code, input.message);
    }
}
export class HerdrClient {
    runner;
    env;
    defaultTimeoutMs;
    constructor(options) {
        this.runner = options.runner;
        this.env = { ...options.env };
        this.defaultTimeoutMs = options.defaultTimeoutMs ?? 10_000;
    }
    async command(args, options = {}) {
        let result;
        try {
            result = await this.runner("herdr", args, {
                env: this.env,
                signal: options.signal,
                timeoutMs: options.timeoutMs ?? this.defaultTimeoutMs,
            });
        }
        catch (error) {
            throw commandError(args, error);
        }
        const output = result.stdout.trim();
        if (!output) {
            if (options.allowEmpty)
                return undefined;
            throw new HerdrCommandError({
                message: `HerdR ${args.join(" ")} returned no JSON`,
                args,
                stdout: result.stdout,
                stderr: result.stderr,
                exitCode: result.exitCode,
            });
        }
        let envelope;
        try {
            envelope = JSON.parse(output);
        }
        catch (error) {
            throw new HerdrCommandError({
                message: `HerdR ${args.join(" ")} returned invalid JSON`,
                code: "invalid_json",
                args,
                stdout: result.stdout,
                stderr: result.stderr,
                exitCode: result.exitCode,
                cause: error,
            });
        }
        if (envelope.error) {
            throw new HerdrCommandError({
                message: envelope.error.message ??
                    envelope.error.code ??
                    `HerdR ${args.join(" ")} failed`,
                code: envelope.error.code,
                args,
                stdout: result.stdout,
                stderr: result.stderr,
                exitCode: result.exitCode,
            });
        }
        if (!("result" in envelope)) {
            // Some mutation commands historically returned a raw success object. Keep
            // compatibility while requiring all failures to use the structured path.
            return envelope;
        }
        return envelope.result;
    }
    async probe(signal) {
        const snapshot = await this.command(["api", "snapshot"], { signal, timeoutMs: 5_000 }).catch(async (error) => {
            if (!(error instanceof HerdrCommandError) || !isUnsupported(error))
                throw error;
            return {};
        });
        const current = await this.currentPane(signal);
        return {
            current,
            capabilities: Array.isArray(snapshot.capabilities)
                ? snapshot.capabilities.filter((capability) => typeof capability === "string")
                : ["agent.prompt", "agent.wait", "pane.report-metadata"],
            ...(typeof snapshot.protocol_version === "string" ||
                typeof snapshot.protocol_version === "number"
                ? { protocolVersion: snapshot.protocol_version }
                : {}),
            ...(typeof snapshot.version === "string" ? { version: snapshot.version } : {}),
        };
    }
    async currentPane(signal) {
        const result = await this.command(["pane", "current", "--current"], { signal });
        return requirePane(result.pane, "pane current");
    }
    async getPane(target, signal) {
        const result = await this.command(["pane", "get", target], { signal });
        return requirePane(result.pane, "pane get");
    }
    async getAgent(target, signal) {
        const result = await this.command(["agent", "get", target], { signal });
        return requireAgent(result.agent, "agent get");
    }
    async prompt(target, text, signal) {
        const result = await this.command(["agent", "prompt", target, text], { signal });
        return requireAgent(result.agent, "agent prompt");
    }
    async wait(target, options = {}) {
        const args = ["agent", "wait", target];
        for (const status of options.until ?? [])
            args.push("--until", status);
        if (options.timeoutMs !== undefined) {
            args.push("--timeout", String(options.timeoutMs));
        }
        const result = await this.command(args, {
            signal: options.signal,
            timeoutMs: options.timeoutMs === undefined ? 30 * 60_000 : options.timeoutMs + 1_000,
        });
        return requireAgent(result.agent, "agent wait");
    }
    async createWorktree(input) {
        const args = [
            "worktree",
            "create",
            "--cwd",
            input.cwd,
            "--branch",
            input.branch,
            "--no-focus",
        ];
        if (input.base)
            args.push("--base", input.base);
        if (input.label)
            args.push("--label", input.label);
        const result = await this.command(args, { signal: input.signal, timeoutMs: 30_000 });
        return {
            workspace: result.workspace,
            rootPane: requirePane(result.root_pane, "worktree create"),
            ...(result.worktree?.path ? { path: result.worktree.path } : {}),
            ...(result.worktree?.branch ? { branch: result.worktree.branch } : {}),
            ...(result.worktree?.base_sha ? { baseSha: result.worktree.base_sha } : {}),
        };
    }
    async reportTaskMetadata(input) {
        const args = [
            "pane",
            "report-metadata",
            input.paneId,
            "--source",
            "pi-subagents",
            "--seq",
            String(input.sequence),
            "--token",
            `task_id=${input.taskId}`,
            "--token",
            `task_phase=${input.phase}`,
        ];
        if (input.agentType)
            args.push("--token", `task_agent=${input.agentType}`);
        if (input.parentPaneId)
            args.push("--token", `task_parent=${input.parentPaneId}`);
        if (input.ttlMs)
            args.push("--ttl-ms", String(input.ttlMs));
        await this.command(args, { signal: input.signal, allowEmpty: true });
    }
    async notify(input) {
        const args = ["notification", "show", input.title];
        if (input.body)
            args.push("--body", input.body);
        args.push("--sound", input.sound ?? "none");
        await this.command(args, { signal: input.signal, allowEmpty: true });
    }
}
export function isTransientHerdrCode(code, message) {
    if (code &&
        [
            "server_unavailable",
            "connection_reset",
            "timeout",
            "agent_pane_busy",
            "pane_busy",
            "temporarily_unavailable",
        ].includes(code)) {
        return true;
    }
    return /temporar|timed? out|connection reset|agent_pane_busy|pane busy/iu.test(message);
}
function commandError(args, error) {
    if (error instanceof HerdrCommandError)
        return error;
    const details = error;
    const stdout = typeof details.stdout === "string" ? details.stdout : "";
    const stderr = typeof details.stderr === "string" ? details.stderr : "";
    const parsed = parseErrorEnvelope(stderr) ?? parseErrorEnvelope(stdout);
    return new HerdrCommandError({
        message: parsed?.message ??
            parsed?.code ??
            (error instanceof Error ? error.message : String(error)),
        code: parsed?.code,
        args,
        stdout,
        stderr,
        exitCode: typeof details.exitCode === "number" ? details.exitCode : undefined,
        cause: error,
    });
}
function parseErrorEnvelope(value) {
    if (!value.trim())
        return undefined;
    try {
        const parsed = JSON.parse(value);
        return parsed.error;
    }
    catch {
        return undefined;
    }
}
function requirePane(value, operation) {
    if (!value || typeof value.pane_id !== "string" || typeof value.terminal_id !== "string") {
        throw new Error(`HerdR ${operation} response did not include pane identity`);
    }
    return value;
}
function requireAgent(value, operation) {
    const pane = requirePane(value, operation);
    if (!isAgentStatus(value?.agent_status)) {
        throw new Error(`HerdR ${operation} response did not include agent status`);
    }
    return { ...pane, ...value, agent_status: value.agent_status };
}
function isAgentStatus(value) {
    return ["idle", "working", "blocked", "done", "unknown"].includes(String(value));
}
function isUnsupported(error) {
    return (error.code === "unknown_command" ||
        error.code === "unsupported" ||
        /unknown command|unsupported/iu.test(error.message));
}
