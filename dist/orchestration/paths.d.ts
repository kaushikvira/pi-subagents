export interface OrchestrationPaths {
    root: string;
    leaseStore: string;
    runStore: string;
    eventLog: string;
    metricsLog: string;
    contextStore: string;
    evidenceStore: string;
    scheduleStore: string;
}
export declare function getOrchestrationPaths(projectDirectory: string): OrchestrationPaths;
