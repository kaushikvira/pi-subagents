import type { TerminalHandle } from "../types.js";
export type SteerResult = {
    ok: true;
} | {
    ok: false;
    reason: "no_pane" | "pane_dead" | "inject_failed" | "empty_prompt";
};
/** Send follow-up prompt to a running tmux subagent (background steer). */
export declare function steerRunningBackgroundTask(paneId: string | null | undefined, prompt: string | undefined, handle?: TerminalHandle): SteerResult;
