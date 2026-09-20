import { truncateToWidth } from "@earendil-works/pi-tui";
import type { ToolCallRecord } from "./helpers.js";
import { formatMs } from "./helpers.js";

export interface WidgetTask {
  agentType: string;
  description?: string;
  startedAt: number;
  toolUses: number;
  /** Effective model for this run, if pinned. */
  model?: string;
  recentCalls?: ToolCallRecord[];
}

export interface ThemeLike {
  fg(color: string, text: string): string;
}

const TASK_WIDGET_RENDER_MS = 80;

const SPINNER_FRAMES = [
  "\u280B",
  "\u2819",
  "\u2838",
  "\u2834",
  "\u2826",
  "\u2827",
  "\u2807",
  "\u280F",
];
/** Keep status row clear when many subagent toolcalls (foreground overlap fix). */
const MAX_BACKGROUND_LINES = 8;
const MAX_WIDTH = 120;
const TREE_LAST = "\u2514\u2500"; // └─

function color(
  theme: ThemeLike | null | undefined,
  token: string,
  text: string,
): string {
  return theme?.fg ? theme.fg(token, text) : text;
}

function toolStatusMark(
  theme: ThemeLike | null | undefined,
  status: ToolCallRecord["status"] | undefined,
  spinner: string,
): string {
  switch (status) {
    case "done":
      return color(theme, "success", "\u2713");
    case "error":
      return color(theme, "error", "\u2717");
    case "in_progress":
    default:
      return color(theme, "accent", ` ${spinner}`);
  }
}

function formatToolCount(count: number): string {
  return `${count} ${count === 1 ? "tool" : "tools"}`;
}

function renderForegroundTask(

  task: WidgetTask,
  now: number,
  maxWidth: number,
  spinner: string,
  theme: ThemeLike | null | undefined,
): string[] {
  const agentName =
    task.agentType.charAt(0).toUpperCase() + task.agentType.slice(1);
  const elapsed = formatMs(now - task.startedAt);
  const description = task.description ? ` — ${task.description}` : "";
  const lines: string[] = [];

  const header =
    color(theme, "accent", ` ${spinner}`) +
    " " +
    color(theme, "toolTitle", agentName) +
    (task.model
      ? color(theme, "dim", " · ") + color(theme, "text", task.model)
      : "") +
    color(theme, "dim", description) +
    color(theme, "dim", "  \u2022 ") +
    color(theme, "warning", elapsed) +
    (task.toolUses > 0
      ? color(theme, "dim", " \u2022 ") +
        color(theme, "success", formatToolCount(task.toolUses))
      : "");
  lines.push(truncateToWidth(header, maxWidth));

  const latest = task.recentCalls?.at(-1);
  if (latest) {
    const hiddenCount = Math.max(0, (task.recentCalls?.length ?? 0) - 1);
    const detail = latest.detail ? `  ${latest.detail}` : "";
    const suffix = hiddenCount > 0 ? ` (+${hiddenCount} more)` : "";
    const line =
      " " +
      color(theme, "dim", TREE_LAST) +


      " " +
      toolStatusMark(theme, latest.status, spinner) +
      (latest.status === "in_progress" ? " " : "  ") +
      color(theme, "text", latest.name) +
      color(theme, "dim", detail + suffix);
    lines.push(truncateToWidth(line, maxWidth));
  }

  return lines;
}

function renderBackgroundTask(
  id: string,
  task: WidgetTask,
  now: number,
  maxWidth: number,
  spinner: string,
  theme: ThemeLike | null | undefined,
): string[] {
  const elapsed = formatMs(now - task.startedAt);
  const lines = [
    truncateToWidth(
      color(theme, "dim", "- ") +
        color(theme, "toolTitle", task.agentType) +
        (task.model
          ? color(theme, "dim", " · ") + color(theme, "text", task.model)
          : "") +
        color(theme, "dim", " · ") +
        color(theme, "accent", id) +
        color(theme, "dim", " · ") +
        color(theme, "warning", elapsed) +
        color(theme, "dim", " · ") +
        color(theme, "success", formatToolCount(task.toolUses)),
      maxWidth,
    ),
  ];

  const latest = task.recentCalls?.at(-1);
  if (latest) {
    const hiddenCount = Math.max(0, (task.recentCalls?.length ?? 0) - 1);
    const detail = latest.detail ? `  ${latest.detail}` : "";
    const suffix = hiddenCount > 0 ? ` (+${hiddenCount} more)` : "";
    const line =
      "  " +
      color(theme, "dim", TREE_LAST) +
      " " +
      toolStatusMark(theme, latest.status, spinner) +
      (latest.status === "in_progress" ? " " : "  ") +
      color(theme, "text", latest.name) +
      color(theme, "dim", detail + suffix);
    lines.push(truncateToWidth(line, maxWidth));
  } else {
    const line =
      "  " +
      color(theme, "dim", TREE_LAST) +
      " " +
      toolStatusMark(theme, "in_progress", spinner) +
      " " +
      color(theme, "dim", "waiting");
    lines.push(truncateToWidth(line, maxWidth));
  }

  return lines;
}


export function renderTaskWidget(params: {
  foregroundTasks: Iterable<[string, WidgetTask]>;
  backgroundTasks: Iterable<[string, WidgetTask]>;
  foregroundCount: number;
  backgroundCount: number;
  width: number;
  theme?: ThemeLike | null;
  now?: number;
}): string[] {
  const {
    foregroundTasks,
    backgroundTasks,
    foregroundCount,
    backgroundCount,
    width,
    theme,
  } = params;
  if (foregroundCount === 0 && backgroundCount === 0) return [];

  const now = params.now ?? Date.now();
  const maxWidth = Math.min(width, MAX_WIDTH);
  const tick = Math.floor(now / TASK_WIDGET_RENDER_MS);
  const spinner = SPINNER_FRAMES[tick % SPINNER_FRAMES.length];
  const lines: string[] = [];

  for (const [, task] of foregroundTasks) {
    lines.push(...renderForegroundTask(task, now, maxWidth, spinner, theme));
    lines.push("");
  }

  const renderedBackground: Array<[string, WidgetTask]> = [];
  for (const entry of backgroundTasks) {
    if (renderedBackground.length >= MAX_BACKGROUND_LINES) break;
    renderedBackground.push(entry);
  }

  for (const [id, task] of renderedBackground) {
    lines.push(...renderBackgroundTask(id, task, now, maxWidth, spinner, theme));
  }

  const hidden = backgroundCount - renderedBackground.length;
  if (hidden > 0) {
    lines.push(
      truncateToWidth(
        color(theme, "dim", `+ ${hidden} more background tasks`),
        maxWidth,
      ),
    );
  }

  // Keep a little breathing room above the editor.
  lines.push("");

  return lines;
}
