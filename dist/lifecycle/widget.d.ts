import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { BackgroundTask } from "../types.js";
export interface TaskWidgetController {
    ensureTaskWidget(targetCtx: ExtensionContext): void;
    requestRender(): void;
    clearTaskWidgetIfIdle(): void;
    dispose(): void;
}
export declare function createTaskWidgetController(foregroundTasks: Map<string, BackgroundTask>, backgroundTasks: Map<string, BackgroundTask>): TaskWidgetController;
