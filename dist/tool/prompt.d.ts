export interface BuildTaskPromptOptions {
    description: string;
    agentName: string;
    agentSource: string;
    prompt: string;
    cwd: string;
}
export declare function buildTaskPrompt(options: BuildTaskPromptOptions): string;
