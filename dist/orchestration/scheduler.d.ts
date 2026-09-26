export interface TaskSchedule {
    id: string;
    name: string;
    projectDirectory: string;
    cron?: string;
    at?: string;
    timezone?: string;
    maxRuns?: number;
    runs: number;
    enabled: boolean;
    createdAt: string;
    lastRunAt?: string;
    nextRunAt?: string;
    parameters: Record<string, unknown>;
}
export interface CreateTaskScheduleInput {
    name: string;
    projectDirectory: string;
    cron?: string;
    at?: string;
    timezone?: string;
    maxRuns?: number;
    parameters: Record<string, unknown>;
}
/**
 * Called when a scheduled invocation throws. Without it croner's `catch: true`
 * silently discards the failure and the schedule keeps advancing as if the
 * task had run.
 */
export type ScheduledTaskErrorHandler = (error: unknown, schedule: TaskSchedule) => void;
export type ScheduledTaskInvoker = (parameters: Record<string, unknown>, projectDirectory: string) => Promise<void>;
export declare class TaskScheduler {
    private readonly storePath;
    private readonly jobs;
    private invoker?;
    private onError?;
    constructor(storePath: string);
    start(invoker: ScheduledTaskInvoker, onError?: ScheduledTaskErrorHandler): Promise<void>;
    add(input: CreateTaskScheduleInput): Promise<TaskSchedule>;
    list(): Promise<TaskSchedule[]>;
    cancel(id: string): Promise<boolean>;
    dispose(): void;
    private install;
    private recordRun;
    private updateDocument;
}
