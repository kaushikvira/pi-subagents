import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { readFinalAssistantText, resolveTaskSessionReference, } from "./lifecycle.js";
export async function getTaskSnapshot(projectDirectory, taskId) {
    const piDirectory = join(projectDirectory, ".pi");
    const registry = await readJsonArray(join(piDirectory, "task-registry.json"));
    const history = await readJsonArray(join(piDirectory, "task-session-history.json"));
    const registryEntry = findTaskRecord(registry, taskId);
    const historyEntry = findTaskRecord(history, taskId);
    const record = registryEntry ?? historyEntry;
    const sessionName = stringValue(record?.sessionName) ?? `task-${taskId}`;
    const description = stringValue(registryEntry?.description) ??
        stringValue(historyEntry?.description);
    const sessionReference = await resolveTaskSessionReference({
        projectDirectory,
        taskId,
        sessionName,
        recordedSessionReference: stringValue(record?.sessionRef),
    });
    return {
        taskId,
        status: stringValue(registryEntry?.phase) ??
            stringValue(registryEntry?.status) ??
            stringValue(historyEntry?.status) ??
            "unknown",
        ...(description ? { description } : {}),
        sessionName,
        ...(sessionReference ? { sessionReference } : {}),
    };
}
export async function getFinalTaskResult(snapshot) {
    return snapshot.sessionReference
        ? readFinalAssistantText(snapshot.sessionReference)
        : undefined;
}
function findTaskRecord(records, taskId) {
    return records.find((record) => stringValue(record.id) === taskId || stringValue(record.taskId) === taskId);
}
async function readJsonArray(path) {
    try {
        const value = JSON.parse(await readFile(path, "utf8"));
        return Array.isArray(value) ? value.filter(isRecord) : [];
    }
    catch (error) {
        if (isNodeError(error) && error.code === "ENOENT") {
            return [];
        }
        throw error;
    }
}
function stringValue(value) {
    return typeof value === "string" ? value : undefined;
}
function isRecord(value) {
    return typeof value === "object" && value !== null;
}
function isNodeError(error) {
    return error instanceof Error && "code" in error;
}
