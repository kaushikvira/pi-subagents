export type DoctorIssueSeverity = "error" | "warning";
export interface DoctorIssue {
    code: string;
    severity: DoctorIssueSeverity;
    message: string;
    remediation: string;
    reference?: string;
}
export interface DoctorResult {
    ok: boolean;
    status: "healthy" | "issues";
    exitCode: 0 | 1;
    issues: DoctorIssue[];
}
export interface CeremonyStep {
    name: string;
    uniqueValue: string;
}
export declare function runOrchestrationDoctor(input: {
    projectDirectory: string;
    delegationPrompt?: string;
    ceremonySteps?: readonly CeremonyStep[];
    now?: Date;
    staleAfterMs?: number;
}): Promise<DoctorResult>;
