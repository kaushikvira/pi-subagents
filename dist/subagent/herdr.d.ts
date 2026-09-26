import type { HerdrTerminalHandle } from "../types.js";
import { type CommandRunner, type TerminalBackend } from "./terminalBackend.js";
export declare function runWithRetry<T>(run: (args: readonly string[]) => Promise<T>, args: readonly string[], options: {
    label: string;
    backoffMs?: readonly number[];
    signal?: AbortSignal;
}): Promise<T>;
export declare function restoreHerdrWorkspaceGroups(handles: readonly HerdrTerminalHandle[]): void;
export interface HerdrTerminalBackendOptions {
    run?: CommandRunner["run"];
    env?: NodeJS.ProcessEnv;
    promptTimeoutMs?: number;
    retryTimeoutMs?: number;
    retryPollMs?: number;
}
export declare function createHerdrTerminalBackend(options?: HerdrTerminalBackendOptions): TerminalBackend;
export declare function createDefaultHerdrTerminalBackend(env?: NodeJS.ProcessEnv): TerminalBackend;
export declare function createSyncHerdrControl(env?: NodeJS.ProcessEnv, run?: (args: readonly string[], socketPath: string) => string): {
    exists(handle: HerdrTerminalHandle): boolean;
    send(handle: HerdrTerminalHandle, message: string): void;
    notify(title: string, body: string, sound?: "none" | "done" | "request"): void;
    close(handle: HerdrTerminalHandle): void;
};
