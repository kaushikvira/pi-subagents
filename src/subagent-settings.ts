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
 *   subagents.availableModels — static, hand-curated list of launchable
 *   models for the task tool. Each entry is a "provider/model-id" string
 *   or an object { model, description? }. Surfaced by the list_models
 *   tool and used to validate the task tool's model argument.
 */

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { findPiDir } from "./helpers.js";

export interface AvailableModelEntry {
  /** Fully-qualified model (provider/model-id). */
  model: string;
  /** Optional human note (e.g. "fast local model for flash-class work"). */
  description?: string;
}

export interface SubagentSettings {
  defaultModel?: string;
  availableModels?: AvailableModelEntry[];
}

function readJsonSafe(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return null;
  }
}

function parseAvailableModels(
  raw: unknown,
): AvailableModelEntry[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const entries: AvailableModelEntry[] = [];
  for (const item of raw) {
    if (typeof item === "string") {
      if (item.trim().length > 0) entries.push({ model: item.trim() });
    } else if (item && typeof item === "object") {
      const model = (item as Record<string, unknown>).model;
      const description = (item as Record<string, unknown>).description;
      if (typeof model === "string" && model.trim().length > 0) {
        const entry: AvailableModelEntry = { model: model.trim() };
        if (
          typeof description === "string" &&
          description.trim().length > 0
        ) {
          entry.description = description.trim();
        }
        entries.push(entry);
      }
    }
  }
  return entries.length > 0 ? entries : undefined;
}

function pickSubagents(obj: unknown): SubagentSettings {
  if (!obj || typeof obj !== "object") return {};
  const sub = (obj as Record<string, unknown>).subagents;
  if (!sub || typeof sub !== "object") return {};
  const result: SubagentSettings = {};
  const model = (sub as Record<string, unknown>).defaultModel;
  if (typeof model === "string" && model.trim().length > 0) {
    result.defaultModel = model.trim();
  }
  const available = parseAvailableModels(
    (sub as Record<string, unknown>).availableModels,
  );
  if (available !== undefined) {
    result.availableModels = available;
  }
  return result;
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
