/**
 * Shared agent tool allowlist resolution for task subagents.
 */
/** @deprecated Use BUILTIN_TOOL_NAMES + TASK_DEFAULT_EXTENSION_TOOLS */
export declare const ALL_TOOL_NAMES: ("read" | "bash" | "edit" | "write" | "grep" | "find" | "ls")[];
export declare function parseToolList(raw: string | string[] | undefined): string[];
export interface ResolveAgentToolsInput {
    /** Explicit `tools:` from frontmatter */
    tools?: string | string[];
    /** `disallowed_tools` from frontmatter */
    disallowedTools?: string | string[];
    /** Enforce the fail-closed read-only capability policy. */
    readonly?: boolean;
    /**
     * When set, used as base instead of default builtin+extension catalog
     * (intersection applied when agent also sets `tools:`).
     */
    parentToolNames?: string[];
    /** Name registered by pi-task in the parent session. */
    taskToolName?: string;
}
/**
 * Effective allowlist for CLI `--tools` or SDK `tools:` option.
 * Throws if the result is empty.
 */
export declare function resolveAgentToolAllowlist(input: ResolveAgentToolsInput): string[];
export declare function buildAgentToolSelection(input: ResolveAgentToolsInput): {
    tools: string[];
    excludeTools: string[];
};
export declare function assertSdkToolCapability(tools: readonly string[]): void;
