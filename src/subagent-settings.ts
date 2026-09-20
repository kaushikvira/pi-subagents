/**
 * Load `subagents` settings from pi settings files.
 *
 * Precedence (project overrides global):
 *   1. <project>/.pi/settings.json
 *   2. ~/.pi/agent/settings.json
 *
 * Recognized keys:
 *   subagents.defaultModel — fully-qualified model (provider/model-id)
 *   used when a task launch does not pass an explicit `model` parameter
 *   and the agent profile does not pin one.
 */

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { findPiDir } from "./helpers.js";

export interface SubagentSettings {
  defaultModel?: string;
}

function readJsonSafe(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return null;
  }
}

function pickSubagents(obj: unknown): SubagentSettings {
  if (!obj || typeof obj !== "object") return {};
  const sub = (obj as Record<string, unknown>).subagents;
  if (!sub || typeof sub !== "object") return {};
  const model = (sub as Record<string, unknown>).defaultModel;
  if (typeof model === "string" && model.trim().length > 0) {
    return { defaultModel: model.trim() };
  }
  return {};
}

export function loadSubagentSettings(cwd: string): SubagentSettings {
  const globalPath = join(homedir(), ".pi", "agent", "settings.json");
  const projectPiDir = findPiDir(cwd);
  const projectPath = projectPiDir
    ? join(projectPiDir, "settings.json")
    : null;

  const merged: SubagentSettings = {
    ...pickSubagents(readJsonSafe(globalPath)),
  };
  if (projectPath && projectPath !== globalPath) {
    Object.assign(merged, pickSubagents(readJsonSafe(projectPath)));
  }
  return merged;
}
