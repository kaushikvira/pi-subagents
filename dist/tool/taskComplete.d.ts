import { Box } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
/**
 * Renderer for background task completion notifications.
 * Same structured sections as foreground task renderResult (Ctrl+O).
 */
export declare function createTaskCompleteRenderer(): (message: {
    details?: unknown;
}, { expanded }: {
    expanded?: boolean;
}, theme: Theme) => Box | undefined;
