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
 *   subagents.agentModels — optional map of agent_type → launch model.
 *   Resolved after the explicit model param and before defaultModel.
 *
 * Malformed availableModels/agentModels entries are never applied; they are
 * reported in `availableModelSkipped` so list_models can warn about them.
 * `sources` reports which settings files were read and whether the project
 * file overrode at least one subagents key.
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { findPiDir } from "./helpers.js";
function readJsonSafe(path) {
    try {
        return JSON.parse(readFileSync(path, "utf-8"));
    }
    catch {
        return null;
    }
}
function parseAvailableModels(raw) {
    if (!Array.isArray(raw)) {
        return {
            entries: [],
            skipped: raw === undefined ? [] : ["availableModels is not an array"],
        };
    }
    const entries = [];
    const skipped = [];
    raw.forEach((item, index) => {
        const label = `availableModels[${index + 1}]`;
        if (typeof item === "string") {
            if (item.trim().length > 0)
                entries.push({ model: item.trim() });
            else
                skipped.push(`${label}: empty string`);
        }
        else if (item && typeof item === "object") {
            const model = item.model;
            const description = item.description;
            if (typeof model === "string" && model.trim().length > 0) {
                const entry = { model: model.trim() };
                if (typeof description === "string" &&
                    description.trim().length > 0) {
                    entry.description = description.trim();
                }
                entries.push(entry);
            }
            else {
                skipped.push(`${label}: object without a non-empty string 'model'`);
            }
        }
        else {
            skipped.push(`${label}: expected a string or { model, description } object`);
        }
    });
    return { entries, skipped };
}
function parseAgentModels(raw) {
    if (raw === undefined)
        return { entries: {}, skipped: [] };
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        return {
            entries: {},
            skipped: ["agentModels is not an object of agent_type → model"],
        };
    }
    const entries = {};
    const skipped = [];
    for (const [agentType, value] of Object.entries(raw)) {
        if (typeof value === "string" && value.trim().length > 0) {
            entries[agentType] = value.trim();
        }
        else {
            skipped.push(`agentModels["${agentType}"]: expected a model string`);
        }
    }
    return { entries, skipped };
}
function subagentsRecord(raw) {
    if (!raw || typeof raw !== "object")
        return null;
    const sub = raw.subagents;
    return sub && typeof sub === "object" && !Array.isArray(sub)
        ? sub
        : null;
}
function pickSubagents(obj) {
    const sub = subagentsRecord(obj);
    if (!sub)
        return {};
    const result = {};
    const model = sub.defaultModel;
    if (typeof model === "string" && model.trim().length > 0) {
        result.defaultModel = model.trim();
    }
    const available = parseAvailableModels(sub.availableModels);
    if (available.entries.length > 0) {
        result.availableModels = available.entries;
    }
    const agentModels = parseAgentModels(sub.agentModels);
    if (Object.keys(agentModels.entries).length > 0) {
        result.agentModels = agentModels.entries;
    }
    return result;
}
export function loadSubagentSettings(cwd) {
    const globalPath = join(homedir(), ".pi", "agent", "settings.json");
    const projectPiDir = findPiDir(cwd);
    const projectPath = projectPiDir
        ? join(projectPiDir, "settings.json")
        : null;
    const globalRaw = readJsonSafe(globalPath);
    const projectRaw = projectPath && projectPath !== globalPath
        ? readJsonSafe(projectPath)
        : undefined;
    const merged = {
        ...pickSubagents(globalRaw),
        sources: {
            globalPath,
            projectPath,
            projectOverrides: false,
        },
    };
    if (projectPath && projectPath !== globalPath) {
        const projectSettings = pickSubagents(projectRaw);
        merged.sources.projectOverrides =
            Object.keys(projectSettings).length > 0;
        Object.assign(merged, projectSettings);
    }
    // Effective diagnostics: when the project file defines a key it shadows the
    // global one, so report only the effective source's notes.
    const gsub = subagentsRecord(globalRaw);
    const psub = projectRaw !== undefined ? subagentsRecord(projectRaw) : null;
    const effectiveAvailable = psub && psub.availableModels !== undefined ? psub : gsub;
    const effectiveAgentModels = psub && psub.agentModels !== undefined ? psub : gsub;
    const skipped = [
        ...parseAvailableModels(effectiveAvailable?.availableModels).skipped,
        ...parseAgentModels(effectiveAgentModels?.agentModels).skipped,
    ];
    if (skipped.length > 0) {
        merged.availableModelSkipped = skipped;
    }
    return merged;
}
