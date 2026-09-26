import { truncateToWidth } from "@earendil-works/pi-tui";
import { formatMs } from "../helpers.js";
import { renderTaskWidget } from "../task-widget.js";
import { ignoreStaleExtensionCtx } from "../stale-ctx.js";
export function createTaskWidgetController(foregroundTasks, backgroundTasks) {
    let widgetCtx = null;
    let requestWidgetRender = null;
    let widgetTheme = null;
    function renderWidget(width) {
        try {
            return renderTaskWidget({
                foregroundTasks: foregroundTasks.entries(),
                backgroundTasks: backgroundTasks.entries(),
                foregroundCount: foregroundTasks.size,
                backgroundCount: backgroundTasks.size,
                width,
                theme: widgetTheme,
            });
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            const active = [
                ...Array.from(foregroundTasks.entries()),
                ...Array.from(backgroundTasks.entries()),
            ];
            if (active.length === 0)
                return [];
            const [, task] = active[0];
            return [
                truncateToWidth(`${task.agentType}  • ${formatMs(Date.now() - task.startedAt)}  (render error: ${msg})`, Math.min(width, 120)),
            ];
        }
    }
    function requestRender() {
        requestWidgetRender?.();
    }
    function ensureTaskWidget(targetCtx) {
        if (targetCtx.mode !== "tui")
            return;
        if (widgetCtx) {
            requestRender();
            return;
        }
        widgetCtx = targetCtx;
        ignoreStaleExtensionCtx(() => targetCtx.ui.setWidget("task", (tui, theme) => {
            widgetTheme = theme ?? null;
            requestWidgetRender = () => tui.requestRender();
            return {
                render: (width) => renderWidget(width),
                invalidate: requestRender,
                dispose: () => {
                    widgetTheme = null;
                    requestWidgetRender = null;
                },
            };
        }));
    }
    function clearTaskWidgetIfIdle() {
        if (foregroundTasks.size > 0 || backgroundTasks.size > 0) {
            requestRender();
            return;
        }
        if (widgetCtx) {
            const ctx = widgetCtx;
            ignoreStaleExtensionCtx(() => ctx.ui.setWidget("task", undefined));
            widgetCtx = null;
        }
        requestWidgetRender = null;
    }
    function dispose() {
        if (widgetCtx) {
            const ctx = widgetCtx;
            ignoreStaleExtensionCtx(() => ctx.ui.setWidget("task", undefined));
            widgetCtx = null;
        }
        widgetTheme = null;
        requestWidgetRender = null;
    }
    return { ensureTaskWidget, requestRender, clearTaskWidgetIfIdle, dispose };
}
