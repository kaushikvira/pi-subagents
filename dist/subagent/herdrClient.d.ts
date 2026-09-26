import type { CommandRunner } from "./terminalBackend.js";
export type HerdrAgentStatus = "idle" | "working" | "blocked" | "done" | "unknown";
export interface HerdrPaneInfo {
    pane_id: string;
    terminal_id: string;
    workspace_id?: string;
    tab_id?: string;
    agent?: string;
    agent_status?: HerdrAgentStatus;
    cwd?: string;
    foreground_cwd?: string;
}
export interface HerdrAgentInfo extends HerdrPaneInfo {
    name?: string;
    display_agent?: string;
    agent_status: HerdrAgentStatus;
}
export interface HerdrWorkspaceInfo {
    workspace_id: string;
    label?: string;
    root_pane_id?: string;
}
export declare class HerdrCommandError extends Error {
    readonly code?: string;
    readonly args: readonly string[];
    readonly stdout: string;
    readonly stderr: string;
    readonly exitCode?: number;
    readonly transient: boolean;
    constructor(input: {
        message: string;
        code?: string;
        args: readonly string[];
        stdout?: string;
        stderr?: string;
        exitCode?: number;
        cause?: unknown;
    });
}
export interface HerdrClientOptions {
    runner: CommandRunner["run"];
    env: NodeJS.ProcessEnv;
    defaultTimeoutMs?: number;
}
export declare class HerdrClient {
    private readonly runner;
    private readonly env;
    private readonly defaultTimeoutMs;
    constructor(options: HerdrClientOptions);
    command<T>(args: readonly string[], options?: {
        signal?: AbortSignal;
        timeoutMs?: number;
        allowEmpty?: boolean;
    }): Promise<T>;
    probe(signal?: AbortSignal): Promise<{
        current: HerdrPaneInfo;
        protocolVersion?: string | number;
        version?: string;
        capabilities: string[];
    }>;
    currentPane(signal?: AbortSignal): Promise<HerdrPaneInfo>;
    getPane(target: string, signal?: AbortSignal): Promise<HerdrPaneInfo>;
    getAgent(target: string, signal?: AbortSignal): Promise<HerdrAgentInfo>;
    prompt(target: string, text: string, signal?: AbortSignal): Promise<HerdrAgentInfo>;
    wait(target: string, options?: {
        until?: readonly HerdrAgentStatus[];
        timeoutMs?: number;
        signal?: AbortSignal;
    }): Promise<HerdrAgentInfo>;
    createWorktree(input: {
        cwd: string;
        branch: string;
        base?: string;
        label?: string;
        signal?: AbortSignal;
    }): Promise<{
        workspace: HerdrWorkspaceInfo;
        rootPane: HerdrPaneInfo;
        path?: string;
        branch?: string;
        baseSha?: string;
    }>;
    reportTaskMetadata(input: {
        paneId: string;
        sequence: number;
        taskId: string;
        phase: string;
        agentType?: string;
        parentPaneId?: string;
        ttlMs?: number;
        signal?: AbortSignal;
    }): Promise<void>;
    notify(input: {
        title: string;
        body?: string;
        sound?: "none" | "done" | "request";
        signal?: AbortSignal;
    }): Promise<void>;
}
export declare function isTransientHerdrCode(code: string | undefined, message: string): boolean;
