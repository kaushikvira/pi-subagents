export interface TaskSnapshot {
    taskId: string;
    status: string;
    description?: string;
    sessionName: string;
    sessionReference?: string;
}
export declare function getTaskSnapshot(projectDirectory: string, taskId: string): Promise<TaskSnapshot>;
export declare function getFinalTaskResult(snapshot: TaskSnapshot): Promise<string | undefined>;
