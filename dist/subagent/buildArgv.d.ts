/**
 * Build `pi` CLI argv for subagent spawns.
 */
import type { AgentConfig } from "../helpers.js";
export interface PiPromptLaunchOptions {
    systemPromptPath: string;
    deferTaskPrompt: boolean;
}
export interface BuildPiArgvOptions {
    agent: AgentConfig;
    sessionName: string;
    sessionDir: string;
    promptContent: string;
    resume?: boolean;
    resumeSessionRef?: string;
    parentToolNames?: string[];
    taskToolName?: string;
    promptLaunch?: PiPromptLaunchOptions;
    /** Fully-qualified model override (provider/model-id); wins over agent.model. */
    model?: string;
}
export declare function buildPiArgv(opts: BuildPiArgvOptions): string[];
