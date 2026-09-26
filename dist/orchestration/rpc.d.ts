export declare const TASK_RPC_PROTOCOL_VERSION = 3;
/**
 * Reduce a caller's options to the allowlisted surface. Unknown keys are
 * dropped rather than rejected so that additive fields in newer callers do not
 * break older runtimes — but dropped keys are reported back in the reply, so a
 * caller relying on one finds out from the response instead of from silence.
 */
export declare function sanitizeSpawnOptions(options: Record<string, unknown> | undefined): {
    options: Record<string, unknown> | undefined;
    dropped: string[];
};
export interface EventBus {
    on(event: string, handler: (data: unknown) => void | Promise<void>): () => void;
    emit(event: string, data: unknown): void;
}
export interface TaskRpcDependencies {
    events: EventBus;
    spawn: (input: {
        agentType: string;
        prompt: string;
        description: string;
        options?: Record<string, unknown>;
    }) => Promise<string>;
    stopTask: (taskId: string) => Promise<void>;
    isTaskSettled: (taskId: string) => boolean;
}
export interface TaskRpcHandle {
    dispose(): void;
    settleTask(taskId: string): void;
}
export declare function registerTaskRpc(deps: TaskRpcDependencies): TaskRpcHandle;
/** An RPC failure with a machine-readable code, so callers can branch without parsing prose. */
export declare class RpcError extends Error {
    readonly code: string;
    constructor(code: string, message: string);
}
