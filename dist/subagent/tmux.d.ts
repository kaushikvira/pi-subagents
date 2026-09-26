export type TmuxSplitResult = {
    paneId: string;
    originalPane: string | null;
};
export declare function hasTmux(): boolean;
export declare function splitWindowPane(cwd: string, command: string): TmuxSplitResult;
export declare function setPaneRemainOnExit(paneId: string, enabled: boolean): void;
export declare function setPaneSelfDestruct(paneId: string, enabled: boolean, delaySeconds?: number): void;
export declare function paneExists(paneId: string, options?: {
    fresh?: boolean;
}): boolean;
export declare function paneDead(paneId: string, options?: {
    fresh?: boolean;
}): boolean;
export declare function capturePaneTail(paneId: string, lines?: number): string;
export declare function killAgentPane(paneId: string, originalPane?: string | null): void;
/** Inject text into a running subagent pane (steer / follow-up). */
export declare function tmuxSteerPane(paneId: string, message: string): void;
export declare function wrapWithPaneExitWatcher(sessionFilePath: string, command: string): string;
