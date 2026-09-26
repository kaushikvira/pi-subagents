import { Container } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
export type TaskResultDetails = {
    agent_type?: string;
    description?: string;
    phase?: string;
    tool_uses?: number;
    duration_ms?: number;
    background?: boolean;
    summary?: string;
    findings?: string;
    evidence?: string;
    files?: string;
    caveats?: string;
    next_steps?: string;
    needs_decision?: string;
    structured_result?: boolean;
    full_output?: string;
};
/** Shared collapsed/expanded body for task tool results and task-complete notifications. */
export declare function renderTaskResultBody(details: TaskResultDetails, contentSummaryText: string, options: {
    expanded?: boolean;
    indentHint?: boolean;
}, theme: Theme): InstanceType<typeof Container>;
