import type { ToolCallRecord } from "./helpers.js";
export interface WidgetTask {
    agentType: string;
    description?: string;
    startedAt: number;
    toolUses: number;
    /** Effective model for this run, if pinned. */
    model?: string;
    recentCalls?: ToolCallRecord[];
}
export interface ThemeLike {
    fg(color: string, text: string): string;
}
export declare function renderTaskWidget(params: {
    foregroundTasks: Iterable<[string, WidgetTask]>;
    backgroundTasks: Iterable<[string, WidgetTask]>;
    foregroundCount: number;
    backgroundCount: number;
    width: number;
    theme?: ThemeLike | null;
    now?: number;
}): string[];
