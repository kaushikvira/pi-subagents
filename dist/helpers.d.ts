/**
 * Task Extension — Pure helper functions.
 *
 * No side effects, no ExtensionAPI dependency. All functions here are
 * unit-testable with node:assert/strict.
 */
import type { Theme } from "@earendil-works/pi-coding-agent";
import { type PiPromptLaunchOptions } from "./subagent/buildArgv.js";
export interface AgentConfig {
    name: string;
    description: string;
    model?: string;
    thinking?: string;
    /** Explicit allowlist from frontmatter `tools:` */
    tools?: string | string[];
    disallowedTools?: string[];
    hidden?: boolean;
    proactive?: boolean;
    readonly?: boolean;
    body: string;
    source: "project" | "user" | "bundled";
    path: string;
}
export interface ParsedResult {
    status: string;
    summary: string;
    findings: string;
    evidence: string;
    files: string;
    caveats: string;
    next_steps: string;
    confidence: string;
    /**
     * Optional escalation channel: a disputed premise or a decision the parent
     * must make (options with tradeoffs). Present only when the child emitted a
     * `<needs_decision>` tag.
     */
    needs_decision?: string;
    /** Parsed, typed decision request. Untyped prose remains display-only. */
    decision_request?: TaskDecisionRequest;
    raw: string;
}
export interface TaskDecisionOption {
    id: string;
    label: string;
    tradeoff?: string;
}
export interface TaskDecisionRequest {
    question: string;
    options: TaskDecisionOption[];
    context?: string;
}
export type TaskReportedStatus = "success" | "failure" | "blocked" | "partial"
/**
 * The delegated framing was wrong and the agent delivered a corrected
 * framing instead. A valid outcome, not a failure.
 */
 | "reframed" | "unknown";
export interface TaskResultAssessment {
    reportedStatus: TaskReportedStatus;
    valid: boolean;
}
export declare function assessTaskResult(result: ParsedResult): TaskResultAssessment;
/** A single tool call extracted from a subagent session JSONL. */
export interface ToolCallRecord {
    /** Tool name (e.g. "websearch", "read", "bash") */
    name: string;
    /** Short, human-readable summary of the call's primary argument */
    detail: string;
    /** "done" if a matching toolResult was seen, "error" if isError, "in_progress" otherwise */
    status: "done" | "error" | "in_progress";
    /** Entry id of the toolCall block (used for stable sorting/debug) */
    id: string;
}
export declare const TASK_BACKGROUND_DEFAULT = true;
export declare const TASK_PROMPT_INSTRUCTIONS = "Your final assistant message IS the result the parent agent will read.\n\nWhen you are done, end with the XML envelope described below (or the <result> block from your agent instructions). Do not write a RESULT.md file \u2014 the parent reads your final assistant message from the session JSONL, not from any file.";
/**
 * XML envelope for the task result. The parent agent parses the child
 * subagent's final message with `parseResultXml`, which reads `<status>`,
 * `<summary>`, `<findings>`, `<evidence>`, and `<files>` tags. Append
 * this to the child prompt so the child knows to wrap its final result
 * in these tags (the parent then extracts them into the result section).
 */
export declare const TASK_RESULT_XML_INSTRUCTIONS = "When the task is complete, wrap the final result in this XML envelope (or the agent's <result> block with the same inner tags). Nothing after the closing tag:\n\n<status>success | failure | blocked | partial | reframed</status>\n<summary>One-line summary of the outcome.</summary>\n<findings>Key findings. Plain text, multiple lines OK.</findings>\n<evidence>Citations, URLs, command snippets. <sources> is accepted as an alias for evidence.</evidence>\n<files>Files created or modified. Leave empty if none.</files>\n<caveats>Risks, gaps, uncertainty. <blockers> is accepted as an alias.</caveats>\n<next_steps>Follow-up actions. <checks> is accepted as an alias.</next_steps>\n<confidence>high | medium | low</confidence>\n\nUse status \"reframed\" when the task's framing turned out to be wrong and you delivered the corrected framing instead \u2014 it is a valid outcome, not a failure. Explain the reframe in summary/findings.\n\nOptional tag, only when the parent must decide something you cannot. Its body MUST be one JSON object with a stable question and 2-8 options:\n<needs_decision>{\"question\":\"Which direction should I take?\",\"options\":[{\"id\":\"a\",\"label\":\"Direction A\",\"tradeoff\":\"Faster, less flexible\"},{\"id\":\"b\",\"label\":\"Direction B\",\"tradeoff\":\"Slower, more flexible\"}],\"context\":\"Why the choice is required now\"}</needs_decision>\n\nDo not put free-form prose in <needs_decision>; an unparseable request cannot pause and resume the task safely.\n\n<decisions> is merged into findings. The parent parses these tags for the task UI.";
export declare const TASK_TOOL_DESCRIPTION = "Launch a new agent to handle complex, multistep tasks autonomously.\n\nInclude relevant context from your current work in the prompt parameter \u2014\nthis becomes the subagent's instructions. The subagent knows nothing about what you've been doing except what you put in the prompt.\n\nWhen NOT to use:\n- To read a specific file path, use Read or Grep instead\n- To search for a class definition like 'class Foo', use Grep instead\n- To search code within 2-3 files, use Read instead\n- If no available agent fits the task, use other tools directly\n\nPrompt contract:\n- Outcome: the governed outcome wanted, stated as observable behavior \u2014 not an implementation\n- Frontier: the open questions the agent OWNS deciding (approach, design within scope, test strategy)\n- Locked decisions: constraints that stand, each WITH rationale and an unlock condition (\"locked because X; challenge it if you find evidence Y\")\n- Acceptance: what evidence would convince a skeptic the outcome holds \u2014 the agent chooses HOW to produce it\n- Non-goals: what to avoid or leave untouched\n- Write/read policy: whether the agent may edit files or must stay read-only\n\nDo not hand the agent a verification recipe, a chosen architecture, or pre-named acceptance criteria unless they are genuinely locked; every locked item must carry its rationale.\n\nUsage notes:\n1. Provide complete context in the prompt \u2014 the subagent starts with a fresh context\n2. Launch multiple agents concurrently when possible (use a single message with multiple tool calls)\n3. Once you delegate work, do NOT duplicate it. Continue with non-overlapping tasks, or wait for the result\n4. Background is the default. Use background:false only when you need the caller to wait inline for the tmux task result\n5. Do not trust delegated output blindly. Read changed files, review the diff, verify scope, and run the relevant checks before claiming completion\n6. Clearly tell the agent whether to write code or just research, since it doesn't know the user's intent\n7. The result returned by the agent is not visible to the user. Send a concise summary back to the user\n8. Pass task_id to resume a previous subagent session (continues with its prior context)\n\nRecommended orchestration patterns (still using only task):\n- Fan-out and synthesize: launch several read-only tasks, then one reviewer/synthesizer task\n- Adversarial verification: pair a producer task with an independent skeptic/verifier task\n- Tournament/ranking: launch competing candidates, then a comparator task with a rubric\n- Loop until done: repeat targeted tasks until no new findings or no remaining failures\n\nBackground mode (background: true):\n- Launches the subagent asynchronously and returns immediately\n- You will be notified automatically when it finishes\n- DO NOT sleep, poll, ask the task for status, or duplicate its work while it runs in background\n- Avoid working with the same files or topics the background task is using\n- Work on non-overlapping tasks, or briefly tell the user what you launched and end your response";
/** @deprecated Import from ./agent-tools.js */
export { ALL_TOOL_NAMES } from "./agent-tools.js";
export declare function extractTag(raw: string, re: RegExp): string;
export declare function parseResultXml(raw: string): ParsedResult;
export declare function parseTaskDecisionRequest(raw: string): TaskDecisionRequest | undefined;
export declare function buildTaskEnvelope(parsed: ParsedResult, meta: {
    agent_type: string;
    description: string;
    tool_uses: number;
    duration_ms: number;
    background: boolean;
}): {
    content: Array<{
        type: "text";
        text: string;
    }>;
    details: Record<string, unknown>;
};
export declare function formatMs(ms: number): string;
export declare function parseIdTimestamp(id: string): number;
export declare function shellQuote(value: string): string;
export type TmuxSplitDirection = "-h" | "-v";
export declare function chooseTmuxSplitDirection(paneWidth: number, paneHeight: number, configuredMode?: string): TmuxSplitDirection;
export declare function buildTmuxSplitWindowArgs(cwd: string, command: string, direction?: TmuxSplitDirection, targetPane?: string | null): string[];
export interface BackgroundReceiptInput {
    taskId: string;
    agentType: string;
    sessionPath: string;
    backend?: "sdk" | "tmux" | "herdr";
    backendReason?: string;
}
export declare function formatBackgroundReceipt(input: BackgroundReceiptInput): string;
export declare function findPiDir(cwd: string): string | null;
export declare function loadAgentsFromDir(dir: string, source: "project" | "user" | "bundled"): AgentConfig[];
export declare function discoverAgents(cwd: string, bundledAgentDir?: string): {
    agents: AgentConfig[];
    piDir: string;
};
export declare function parseBool(value: unknown): boolean | undefined;
export type TaskAgentPreflightError = {
    text: string;
    error: string;
};
export declare function resolveTaskAgentPreflight(agents: AgentConfig[], agentType: string): {
    ok: true;
    agent: AgentConfig;
} | {
    ok: false;
    result: TaskAgentPreflightError;
};
export declare function buildTaskToolDescription(agents: AgentConfig[]): string;
export declare function formatAgentList(agents: AgentConfig[]): string;
/**
 * Build pi CLI arguments for spawning or resuming a sub-agent session.
 *
 * - Fresh spawn: omit `resume` or pass falsy — `--session` is not included.
     * - Resume: pass `resume=true` and optionally `resumeSessionRef` —
     *   `--session <ref>` is included so pi continues an existing session.
     */
export declare function buildPiArgs(agent: AgentConfig, sessionName: string, sessionDir: string, promptContent: string, resume?: boolean, parentToolNames?: string[], taskToolName?: string, resumeSessionRef?: string, promptLaunch?: PiPromptLaunchOptions, modelOverride?: string): string[];
/**
 * Count tool uses and turns from pi JSONL session files.
 * Reads go through the incremental tail cache (only appended bytes are
 * read and parsed), so the 1s progress poll no longer re-reads the whole
 * session on every tick.
 */
export declare function countToolUses(sessionDir: string, sessionName?: string): {
    toolUses: number;
    turns: number;
};
/**
 * Extract a short, human-readable summary of a tool call's primary argument.
 * Falls back to the first string-valued property for unknown tools.
 */
export declare function summarizeArgs(toolName: string, args: unknown): string;
/**
 * Read the most recent tool calls from a pi JSONL session directory,
 * with each call's status (done / error / in_progress) determined by
 * whether a matching toolResult has been written.
 *
 * Returns total counts plus the last `limit` records in chronological order.
 * Safe against malformed lines and missing fields.
 */
export declare function readRecentToolCalls(sessionDir: string, limit?: number, sessionName?: string): {
    toolUses: number;
    turns: number;
    recent: ToolCallRecord[];
};
export declare function formatElapsed(ms: number): string;
export declare function formatForegroundProgressText(progress: {
    taskId: string;
    sessionPath: string;
    agentType: string;
    toolUses: number;
    durationMs: number;
}, _theme: Theme): string;
export declare function formatToolCallsSummaryBlock(recent: ToolCallRecord[], maxLines?: number): string;
/**
 * Subscribe to tool execution events from an AgentSession and update
 * a BackgroundTask's toolUses and recentCalls in real time.
 *
 * Returns an unsubscribe function. Call it to clean up the subscription
 * (e.g., when the session prompt completes or the task is cancelled).
 */
export declare function subscribeToolEvents(session: {
    subscribe(cb: (event: Record<string, unknown>) => void): () => void;
}, task: {
    toolUses: number;
    recentCalls: ToolCallRecord[];
}, maxCalls?: number, onUpdate?: () => void): () => void;
