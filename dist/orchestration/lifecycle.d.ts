export interface ResolveTaskSessionReferenceInput {
    projectDirectory: string;
    taskId: string;
    sessionName: string;
    recordedSessionReference?: string;
    additionalSessionRoots?: readonly string[];
}
export interface BackgroundReceiptInput {
    taskId: string;
    sessionName: string;
    sessionReference?: string;
}
export declare function resolveTaskSessionReference(input: ResolveTaskSessionReferenceInput): Promise<string | undefined>;
export declare function renderBackgroundReceipt(input: BackgroundReceiptInput): string;
export declare function readFinalAssistantText(sessionPath: string, maxCharacters?: number): Promise<string | undefined>;
