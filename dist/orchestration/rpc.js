import { randomUUID } from "node:crypto";
export const TASK_RPC_PROTOCOL_VERSION = 3;
/**
 * Option keys an RPC caller may pass through to the task tool.
 *
 * `options` used to be spread into the tool parameters verbatim, ahead of the
 * named fields — so a caller on the event bus could set
 * `orchestration.context.authorization = "write-approved"` (waving itself past
 * the proof gate) or inject `claims` directly. RPC callers are other processes
 * speaking over the bus; they get the documented surface, not the internal one.
 */
const SPAWN_OPTION_ALLOWLIST = new Set([
    "workspace_group",
    "isolation",
    "conversation_id",
    "orchestration",
]);
/**
 * Fields of `orchestration` an RPC caller may provide.
 *
 * `context` is deliberately absent: authorization lives there, and
 * authorization is granted by the parent session that owns the conversation,
 * never claimed by the remote caller. `claims` stay allowed — declaring what a
 * task will write is the documented reason to pass `orchestration` at all, and
 * each claim is validated at the acquire boundary.
 */
const SPAWN_ORCHESTRATION_ALLOWLIST = new Set([
    "id",
    "batch_id",
    "join",
    "isolation",
    "schedule",
    "claims",
    "lease_ttl_ms",
    "proof",
    "verifier",
]);
/**
 * Reduce a caller's options to the allowlisted surface. Unknown keys are
 * dropped rather than rejected so that additive fields in newer callers do not
 * break older runtimes — but dropped keys are reported back in the reply, so a
 * caller relying on one finds out from the response instead of from silence.
 */
export function sanitizeSpawnOptions(options) {
    if (!options)
        return { options: undefined, dropped: [] };
    const sanitized = {};
    const dropped = [];
    for (const [key, value] of Object.entries(options)) {
        if (!SPAWN_OPTION_ALLOWLIST.has(key)) {
            dropped.push(key);
            continue;
        }
        if (key === "orchestration" && isRecord(value)) {
            const nested = {};
            for (const [orchestrationKey, orchestrationValue] of Object.entries(value)) {
                if (SPAWN_ORCHESTRATION_ALLOWLIST.has(orchestrationKey)) {
                    nested[orchestrationKey] = orchestrationValue;
                }
                else {
                    dropped.push(`orchestration.${orchestrationKey}`);
                }
            }
            sanitized[key] = nested;
            continue;
        }
        sanitized[key] = value;
    }
    return { options: sanitized, dropped };
}
function isRecord(value) {
    return typeof value === "object" && value !== null;
}
export function registerTaskRpc(deps) {
    const scopes = new Map();
    const taskOwners = new Map();
    const unsubscribers = [];
    unsubscribers.push(handleRpc(deps.events, "pi-subagents:rpc:v3:ping", () => ({
        protocolVersion: TASK_RPC_PROTOCOL_VERSION,
        capabilities: ["spawn", "stop-scope", "settled-stop", "recursive-ownership"],
    })));
    unsubscribers.push(handleRpc(deps.events, "pi-subagents:rpc:v3:spawn", async (request) => {
        requireVersion(request.protocolVersion);
        if (typeof request.agentType !== "string" ||
            typeof request.prompt !== "string" ||
            typeof request.description !== "string") {
            throw new RpcError("invalid_request", "spawn requires agentType, prompt, and description strings");
        }
        const parent = request.parentHandle
            ? requireScope(scopes, request.parentHandle)
            : undefined;
        if (parent?.frozen)
            throw new Error("Parent ownership scope is stopping");
        const { options, dropped } = sanitizeSpawnOptions(request.options);
        const scope = {
            handle: `scope-${randomUUID()}`,
            ...(parent ? { parentHandle: parent.handle } : {}),
            children: new Set(),
            taskIds: new Set(),
            frozen: false,
        };
        scopes.set(scope.handle, scope);
        parent?.children.add(scope.handle);
        try {
            const taskId = await deps.spawn({
                agentType: request.agentType,
                prompt: request.prompt,
                description: request.description,
                ...(options ? { options } : {}),
            });
            if (scope.frozen) {
                await deps.stopTask(taskId);
                throw new Error("Ownership scope was stopped while spawn was settling");
            }
            scope.taskIds.add(taskId);
            taskOwners.set(taskId, scope.handle);
            return {
                id: taskId,
                handle: scope.handle,
                ...(dropped.length > 0 ? { droppedOptions: dropped } : {}),
            };
        }
        catch (error) {
            scopes.delete(scope.handle);
            parent?.children.delete(scope.handle);
            throw error;
        }
    }));
    unsubscribers.push(handleRpc(deps.events, "pi-subagents:rpc:v3:stop", async (request) => {
        requireVersion(request.protocolVersion);
        const root = requireScope(scopes, request.handle);
        const ordered = descendantFirst(scopes, root);
        for (const scope of ordered)
            scope.frozen = true;
        const failures = [];
        for (const scope of ordered) {
            for (const taskId of scope.taskIds) {
                try {
                    await deps.stopTask(taskId);
                }
                catch (error) {
                    failures.push(`${taskId}: ${errorMessage(error)}`);
                }
            }
        }
        const taskIds = ordered.flatMap((scope) => [...scope.taskIds]);
        const timeoutMs = Math.max(1, request.timeoutMs ?? 10_000);
        const deadline = Date.now() + timeoutMs;
        while (taskIds.some((taskId) => !deps.isTaskSettled(taskId)) &&
            Date.now() < deadline) {
            await sleep(25);
        }
        const unsettled = taskIds.filter((taskId) => !deps.isTaskSettled(taskId));
        failures.push(...unsettled.map((taskId) => `${taskId}: did not settle before timeout`));
        if (unsettled.length === 0)
            removeScopes(scopes, taskOwners, ordered);
        return { settled: unsettled.length === 0, failures };
    }));
    return {
        dispose() {
            for (const unsubscribe of unsubscribers)
                unsubscribe();
            scopes.clear();
            taskOwners.clear();
        },
        settleTask(taskId) {
            const owner = taskOwners.get(taskId);
            if (!owner)
                return;
            scopes.get(owner)?.taskIds.delete(taskId);
            taskOwners.delete(taskId);
        },
    };
}
/** An RPC failure with a machine-readable code, so callers can branch without parsing prose. */
export class RpcError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.name = "RpcError";
        this.code = code;
    }
}
function handleRpc(events, channel, handler) {
    return events.on(channel, async (raw) => {
        const request = raw;
        if (!request || typeof request.requestId !== "string")
            return;
        try {
            const data = await handler(request);
            events.emit(`${channel}:reply:${request.requestId}`, { success: true, data });
        }
        catch (error) {
            events.emit(`${channel}:reply:${request.requestId}`, {
                success: false,
                error: errorMessage(error),
                ...(error instanceof RpcError ? { code: error.code } : {}),
            });
        }
    });
}
/**
 * Exact version match, as before — but the failure now names both versions in a
 * structured way. A range would be wrong until there are two versions with a
 * defined relationship; what was missing was a reply a caller can branch on
 * (`code === "unsupported_version"`) rather than message text to parse.
 */
function requireVersion(version) {
    if (version !== TASK_RPC_PROTOCOL_VERSION) {
        throw new RpcError("unsupported_version", `Unsupported task RPC protocol ${String(version)}; expected ${TASK_RPC_PROTOCOL_VERSION}`);
    }
}
function requireScope(scopes, handle) {
    const scope = scopes.get(handle);
    if (!scope)
        throw new Error("Ownership scope not found");
    return scope;
}
function descendantFirst(scopes, root) {
    const result = [];
    const visit = (scope) => {
        for (const child of scope.children) {
            const value = scopes.get(child);
            if (value)
                visit(value);
        }
        result.push(scope);
    };
    visit(root);
    return result;
}
function removeScopes(scopes, taskOwners, ordered) {
    for (const scope of ordered) {
        for (const taskId of scope.taskIds)
            taskOwners.delete(taskId);
        if (scope.parentHandle)
            scopes.get(scope.parentHandle)?.children.delete(scope.handle);
        scopes.delete(scope.handle);
    }
}
function sleep(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
function errorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}
