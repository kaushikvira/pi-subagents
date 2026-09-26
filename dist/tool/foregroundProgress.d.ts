export type ForegroundProgressPollOptions = {
    taskId: string;
    sessionDir: string;
    sessionName: string;
    agentType: string;
    description: string;
    startedAt: number;
    onUpdate: (update: {
        content: Array<{
            type: "text";
            text: string;
        }>;
        details: Record<string, unknown>;
    }) => void;
};
export declare function startForegroundProgressPolling(options: ForegroundProgressPollOptions): () => void;
