import type { BackgroundTask, RegistryEntry } from "../types.js";
export declare function restoreActiveBackgroundTasks(piDir: string, backgroundTasks: Map<string, BackgroundTask>, resourceExists?: (entry: RegistryEntry) => boolean, closeResource?: (entry: RegistryEntry) => void): void;
