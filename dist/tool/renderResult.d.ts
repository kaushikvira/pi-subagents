import type { Theme } from "@earendil-works/pi-coding-agent";
export declare function renderResult(result: {
    content?: Array<{
        type?: string;
        text?: string;
    }>;
    details?: unknown;
}, options: {
    expanded?: boolean;
}, theme: Theme, _context: unknown): import("@earendil-works/pi-tui").Container;
