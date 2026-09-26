export type EvidenceReceiptKind = "file" | "test" | "command-output" | "session" | "diff";
export interface EvidenceReceipt {
    version: 1;
    id: string;
    taskId: string;
    producerTaskId: string;
    kind: EvidenceReceiptKind;
    description: string;
    claim?: string;
    artifactPath: string;
    sha256: string;
    observedAt: string;
    exitCode?: number;
    /** Only runtime-observation receipts may satisfy the proof gate. */
    authority?: "manual-artifact" | "runtime-observation";
    command?: string;
    commandDigest?: string;
    cwd?: string;
    toolCallId?: string;
    sessionDigest?: string;
}
export declare function recordEvidenceReceipt(input: {
    storeDirectory: string;
    projectDirectory: string;
    taskId: string;
    producerTaskId: string;
    kind: EvidenceReceiptKind;
    description: string;
    claim?: string;
    artifactPath: string;
    exitCode?: number;
    now?: Date;
}): Promise<EvidenceReceipt>;
/**
 * Capture shell observations from the runtime-owned session transcript.  The
 * child cannot choose the receipt fields: command, cwd, exit status, output,
 * timestamp and transcript digest are taken from matched toolCall/toolResult
 * entries and written as one immutable canonical artifact.
 */
export declare function captureSessionCommandReceipts(input: {
    storeDirectory: string;
    projectDirectory: string;
    taskId: string;
    producerTaskId: string;
    sessionPath: string;
    notBefore?: string;
}): Promise<EvidenceReceipt[]>;
export declare function listEvidenceReceipts(storeDirectory: string, taskId: string): Promise<EvidenceReceipt[]>;
export declare function verifyEvidenceReceipt(receipt: EvidenceReceipt, projectDirectory: string): boolean;
