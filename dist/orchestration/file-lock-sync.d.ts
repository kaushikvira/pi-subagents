/** Shared with the async lock. A lock older than this with a dead owner is stealable. */
export declare const LOCK_STALE_MS = 10000;
/** Shared with the async lock. How long to spin before giving up. */
export declare const LOCK_WAIT_MS = 5000;
export declare function withFileLockSync<T>(input: {
    lockPath: string;
    operation: () => T;
    staleMs?: number;
}): T;
/** Refresh the lock's mtime so a long operation is not mistaken for a stale lock. */
export declare function touchLockSync(lockPath: string): void;
