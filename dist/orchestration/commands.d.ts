import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
export declare function stopOwnedTask(projectDirectory: string, taskId: string, reason?: string): Promise<void>;
export declare function registerTaskCommands(pi: ExtensionAPI): void;
