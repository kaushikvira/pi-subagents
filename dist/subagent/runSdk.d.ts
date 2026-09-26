import type { AgentSession, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { AgentConfig } from "../helpers.js";
export interface RunSdkSubagentOptions {
    prompt: string;
    agent: AgentConfig;
    cwd: string;
    ctx: ExtensionContext;
    model?: string;
    thinkingLevel?: string;
    tools?: string[];
    excludeTools?: string[];
    systemPrompt?: string;
    /** Called after session creation and before prompt(). */
    onSession?: (session: AgentSession) => () => void;
}
export declare function resolveSdkModel(ctx: Pick<ExtensionContext, "model" | "modelRegistry">, requested?: string): Promise<ExtensionContext["model"]>;
export declare function runSdkSubagent(options: RunSdkSubagentOptions): Promise<{
    output: string;
    sessionPath?: string;
}>;
