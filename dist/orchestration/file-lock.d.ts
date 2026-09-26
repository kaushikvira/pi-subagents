export declare function withFileLock<T>(input: {
    lockPath: string;
    operation: () => Promise<T>;
    staleMs?: number;
}): Promise<T>;
export declare function acquireFilesystemLock(lockPath: string, staleMs: number): Promise<string>;
