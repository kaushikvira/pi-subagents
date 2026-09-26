/**
 * The task registry and session history — the records `restoreActiveBackgroundTasks`
 * reads to find panes, processes, and worktrees left behind by a previous run.
 *
 * Both files are also written by `orchestration/task-state.ts`. Neither module
 * used to lock, and this one wrote in place with a bare `writeFileSync`, so a
 * write interrupted at the wrong moment truncated the file and a concurrent
 * read-modify-write silently dropped whichever update lost the race. A parse
 * failure then returned an empty array, which is indistinguishable from "no
 * tasks" — so restore found nothing to restore and every pane, agent process,
 * and worktree from the previous session was orphaned with nothing reaped and
 * nothing reported.
 *
 * Writes are now atomic (temp + rename) and every read-modify-write runs under
 * the same lock `task-state.ts` takes. A file that cannot be parsed is
 * quarantined and reported rather than silently read as empty.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { withFileLockSync } from "./orchestration/file-lock-sync.js";
import { isTerminalHandle } from "./subagent/terminalBackend.js";
const ARTIFACTS_DIR = "artifacts";
const TASK_SESSIONS_REGISTRY = "task-sessions.json";
const TASK_REGISTRY = "task-registry.json";
const TASK_SESSION_HISTORY = "task-session-history.json";
let reportQuarantine = () => undefined;
export function setRegistryQuarantineReporter(reporter) {
    reportQuarantine = reporter;
}
/** The lock guarding a registry file. Must match `task-state.ts`. */
export function registryLockPath(file) {
    return `${file}.lock`;
}
function ensureDir(path) {
    mkdirSync(path, { recursive: true });
}
function readJsonFile(file, fallback) {
    if (!existsSync(file))
        return fallback;
    let raw;
    try {
        raw = readFileSync(file, "utf-8");
    }
    catch {
        return fallback;
    }
    try {
        return JSON.parse(raw);
    }
    catch (error) {
        quarantineRegistryFile(file, `unparseable JSON: ${error.message}`);
        return fallback;
    }
}
/**
 * Move a corrupt registry aside and say so. Returning the fallback keeps the
 * extension alive, but silence here is what turned a truncated file into
 * orphaned processes nobody knew to clean up.
 */
function quarantineRegistryFile(file, reason) {
    const quarantinePath = `${file}.corrupt-${Date.now()}-${randomUUID().slice(0, 8)}`;
    try {
        renameSync(file, quarantinePath);
    }
    catch {
        // If it cannot be moved we still report; the next write replaces it.
    }
    try {
        reportQuarantine({ file, quarantinePath, reason });
    }
    catch {
        // A reporter must never be able to break the registry.
    }
}
function writeJsonFile(file, value) {
    ensureDir(dirname(file));
    // Temp + rename: a reader either sees the whole previous file or the whole
    // new one. A bare `writeFileSync` truncates first, so a reader arriving mid
    // write — or a crash — saw a partial file that parsed as nothing.
    const temporaryPath = `${file}.${process.pid}.${randomUUID()}.tmp`;
    writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
    renameSync(temporaryPath, file);
}
/** Read, mutate, and write a registry file as one atomic, locked operation. */
function updateJsonFile(file, fallback, mutate) {
    ensureDir(dirname(file));
    withFileLockSync({
        lockPath: registryLockPath(file),
        operation: () => {
            writeJsonFile(file, mutate(readJsonFile(file, fallback)));
        },
    });
}
export function normalizeConversationId(value) {
    if (typeof value !== "string")
        return undefined;
    const normalized = value.trim().replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 80);
    return normalized.length > 0 ? normalized : undefined;
}
function getArtifactDir(piDir) {
    return join(piDir, ARTIFACTS_DIR);
}
function getTaskSessionsRegistryPath(piDir) {
    return join(getArtifactDir(piDir), TASK_SESSIONS_REGISTRY);
}
export function readTaskSessionsRegistry(piDir) {
    const raw = readJsonFile(getTaskSessionsRegistryPath(piDir), {});
    const out = {};
    for (const [key, value] of Object.entries(raw)) {
        if (!value || typeof value !== "object")
            continue;
        const record = value;
        if (typeof record.task_id !== "string")
            continue;
        out[key] = {
            task_id: record.task_id,
            updated_at: typeof record.updated_at === "string"
                ? record.updated_at
                : new Date(0).toISOString(),
        };
    }
    return out;
}
export function writeTaskSessionsRegistry(piDir, registry) {
    const file = getTaskSessionsRegistryPath(piDir);
    ensureDir(dirname(file));
    withFileLockSync({
        lockPath: registryLockPath(file),
        operation: () => writeJsonFile(file, registry),
    });
}
function getRegistryPath(piDir) {
    return join(piDir, TASK_REGISTRY);
}
export function migrateRegistryEntry(entry) {
    const migrated = { ...entry };
    const legacyPaneId = migrated.paneId;
    const existingHandle = migrated.handle;
    if (!isTerminalHandle(existingHandle)) {
        if (typeof legacyPaneId === "string" && legacyPaneId.length > 0) {
            migrated.handle = { backend: "tmux", resourceId: legacyPaneId };
        }
        else {
            delete migrated.handle;
        }
    }
    if (isTerminalHandle(migrated.handle)) {
        migrated.backend = migrated.handle.backend;
    }
    delete migrated.paneId;
    return migrated;
}
/**
 * Read, mutate, and write the task registry as one atomic, locked operation.
 *
 * The launch, completion, and stop paths each did their own unlocked
 * read-modify-write (`readRegistry` -> filter/push -> `writeRegistry`). Each
 * step is atomic on its own, but the sequence is not: a registry written by
 * another Pi session between the read and the write is silently reverted, and
 * the dropped entry is a background task whose pane, agent process, and
 * worktree are never reaped by restore. Mutating under the same lock the write
 * takes closes that window.
 */
export function mutateRegistry(piDir, mutate) {
    const file = getRegistryPath(piDir);
    ensureDir(dirname(file));
    withFileLockSync({
        lockPath: registryLockPath(file),
        operation: () => {
            const parsed = readJsonFile(file, []);
            const entries = Array.isArray(parsed)
                ? parsed
                    .filter((entry) => Boolean(entry) && typeof entry === "object")
                    .map((entry) => migrateRegistryEntry(entry))
                : [];
            writeJsonFile(file, mutate(entries).map((entry) => migrateRegistryEntry(entry)));
        },
    });
}
export function readRegistry(piDir) {
    const parsed = readJsonFile(getRegistryPath(piDir), []);
    if (!Array.isArray(parsed))
        return [];
    return parsed
        .filter((entry) => Boolean(entry) && typeof entry === "object")
        .map((entry) => migrateRegistryEntry(entry));
}
export function writeRegistry(piDir, entries) {
    const file = getRegistryPath(piDir);
    ensureDir(dirname(file));
    withFileLockSync({
        lockPath: registryLockPath(file),
        operation: () => writeJsonFile(file, entries.map((entry) => migrateRegistryEntry(entry))),
    });
}
function getTaskSessionHistoryPath(piDir) {
    return join(piDir, TASK_SESSION_HISTORY);
}
export function readTaskSessionHistory(piDir) {
    const parsed = readJsonFile(getTaskSessionHistoryPath(piDir), []);
    return Array.isArray(parsed) ? parsed : [];
}
/**
 * Merge one entry into the history.
 *
 * The read and the write are one locked operation. Interleaved as separate
 * steps, two concurrent upserts each read the same array and the second write
 * erased the first entry — the update was lost with no error anywhere.
 */
export function upsertTaskSessionHistory(piDir, entry) {
    updateJsonFile(getTaskSessionHistoryPath(piDir), [], (current) => {
        const entries = Array.isArray(current)
            ? current
            : [];
        const idx = entries.findIndex((existing) => existing.id === entry.id);
        if (idx >= 0) {
            entries[idx] = { ...entries[idx], ...entry };
        }
        else {
            entries.push(entry);
        }
        return entries;
    });
}
export function findTaskSessionHistory(piDir, taskId) {
    return readTaskSessionHistory(piDir).find((entry) => entry.id === taskId);
}
function sessionFileMatches(file, sessionName) {
    try {
        const content = readFileSync(file, "utf-8");
        return (content.includes(`\"name\":\"${sessionName}\"`) ||
            content.includes(`\"name\": \"${sessionName}\"`));
    }
    catch {
        return false;
    }
}
export function findJsonlSessionByName(piDir, idOrSessionName, agentType) {
    const sessionsRoot = join(getArtifactDir(piDir), "sessions");
    if (!existsSync(sessionsRoot))
        return null;
    const history = readTaskSessionHistory(piDir);
    for (const dirent of readdirSync(sessionsRoot, { withFileTypes: true })) {
        if (!dirent.isDirectory())
            continue;
        const taskId = dirent.name;
        const taskDir = join(sessionsRoot, taskId);
        const historyEntry = history.find((entry) => entry.id === taskId);
        if (!historyEntry)
            continue;
        const sessionName = historyEntry.sessionName;
        if (taskId !== idOrSessionName && sessionName !== idOrSessionName)
            continue;
        if (agentType && historyEntry.agentType !== agentType)
            continue;
        const sessionRef = readdirSync(taskDir)
            .filter((entry) => entry.endsWith(".jsonl"))
            .map((entry) => join(taskDir, entry))
            .find((file) => sessionFileMatches(file, sessionName));
        if (!sessionRef)
            continue;
        return {
            ...historyEntry,
            sessionRef,
            dir: taskDir,
        };
    }
    return null;
}
