export type TerminalBackendKind = "tmux" | "herdr";
export type HerdrLayout = "attached";
export type ExecutionBackendKind = "sdk" | TerminalBackendKind;
export type RequestedBackendKind = "auto" | ExecutionBackendKind;
export type TerminalHandle = {
    backend: "tmux";
    resourceId: string;
} | {
    backend: "herdr";
    resourceId: string;
    socketPath: string;
    terminalId: string;
    parentPaneId?: string;
    agentName?: string;
    tabId?: string;
    /** This launch created and exclusively owns `tabId`; close it on teardown. */
    ownsTab?: boolean;
    workspaceId?: string;
    workspaceGroup?: string;
    herdrLayout?: HerdrLayout;
};
export type HerdrTerminalHandle = Extract<TerminalHandle, {
    backend: "herdr";
}>;
export interface TerminalLaunchInput {
    cwd: string;
    command?: string;
    agentArgs?: readonly string[];
    initialPrompt?: string;
    label?: string;
    direction?: "right" | "down";
    env?: Record<string, string>;
    remainOnExit?: boolean;
    workspaceGroup?: string;
    herdrLayout?: HerdrLayout;
    signal?: AbortSignal;
    timeoutMs?: number;
}
export interface CommandRunOptions {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    input?: string;
    signal?: AbortSignal;
    timeoutMs?: number;
}
export interface CommandResult {
    stdout: string;
    stderr: string;
    exitCode?: number;
}
export interface CommandRunner {
    run(command: string, args: readonly string[], options?: CommandRunOptions): Promise<CommandResult>;
}
export interface TerminalBackend {
    readonly kind: TerminalBackendKind;
    available(): Promise<boolean>;
    launch(input: TerminalLaunchInput): Promise<TerminalHandle>;
    isAlive(handle: TerminalHandle): Promise<boolean>;
    send(handle: TerminalHandle, message: string): Promise<void>;
    readTail(handle: TerminalHandle, lines: number): Promise<string>;
    waitForAttention?(handle: TerminalHandle, options?: {
        signal?: AbortSignal;
        timeoutMs?: number;
    }): Promise<{
        status: "idle" | "working" | "blocked" | "done" | "unknown";
    }>;
    close(handle: TerminalHandle): Promise<void>;
}
export declare function createDefaultCommandRunner(): CommandRunner;
export declare function selectTerminalBackend(input: {
    requested: RequestedBackendKind;
    hasHerdr: boolean;
    hasTmux: boolean;
}): ExecutionBackendKind | null;
export interface TmuxTerminalBackendOptions {
    run?: CommandRunner["run"];
}
export declare function createTmuxTerminalBackend(options?: TmuxTerminalBackendOptions): TerminalBackend;
export declare function isTerminalHandle(value: unknown): value is TerminalHandle;
