import type { RegistryEntry, TaskSessionHistoryEntry } from "./types.js";
export interface TaskSessionRegistryEntry {
    task_id: string;
    updated_at: string;
}
/**
 * Reporter for a registry file that had to be quarantined. Wired to the Pi
 * event bus by the extension; losing the registry means orphaned panes and
 * processes, which an operator has to know about to clean up.
 */
export type RegistryQuarantineReporter = (info: {
    file: string;
    quarantinePath: string;
    reason: string;
}) => void;
export declare function setRegistryQuarantineReporter(reporter: RegistryQuarantineReporter): void;
/** The lock guarding a registry file. Must match `task-state.ts`. */
export declare function registryLockPath(file: string): string;
export declare function normalizeConversationId(value: unknown): string | undefined;
export declare function readTaskSessionsRegistry(piDir: string): Record<string, TaskSessionRegistryEntry>;
export declare function writeTaskSessionsRegistry(piDir: string, registry: Record<string, TaskSessionRegistryEntry>): void;
export declare function migrateRegistryEntry(entry: Record<string, unknown> | RegistryEntry): RegistryEntry;
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
export declare function mutateRegistry(piDir: string, mutate: (entries: RegistryEntry[]) => RegistryEntry[]): void;
export declare function readRegistry(piDir: string): RegistryEntry[];
export declare function writeRegistry(piDir: string, entries: RegistryEntry[]): void;
export declare function readTaskSessionHistory(piDir: string): TaskSessionHistoryEntry[];
/**
 * Merge one entry into the history.
 *
 * The read and the write are one locked operation. Interleaved as separate
 * steps, two concurrent upserts each read the same array and the second write
 * erased the first entry — the update was lost with no error anywhere.
 */
export declare function upsertTaskSessionHistory(piDir: string, entry: TaskSessionHistoryEntry): void;
export declare function findTaskSessionHistory(piDir: string, taskId: string): TaskSessionHistoryEntry | undefined;
export declare function findJsonlSessionByName(piDir: string, idOrSessionName: string, agentType?: string): TaskSessionHistoryEntry | null;
