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
export interface AvailableModelEntry {
    /** Fully-qualified model (provider/model-id). */
    model: string;
    /** Optional human note (e.g. "fast local model for flash-class work"). */
    description?: string;
}
export interface SubagentSettings {
    defaultModel?: string;
    availableModels?: AvailableModelEntry[];
    /** Per-agent-type launch model defaults (agent_type → provider/model-id). */
    agentModels?: Record<string, string>;
    /**
     * Entries rejected while parsing availableModels/agentModels, each with a
     * short reason. Diagnostics only — never applied.
     */
    availableModelSkipped?: string[];
}
export interface SubagentSettingsSources {
    /** Global settings file that was read (always exists on disk or not). */
    globalPath: string;
    /** Project settings file that was read, when the project has a .pi dir. */
    projectPath: string | null;
    /** True when the project file overrode at least one subagents key. */
    projectOverrides: boolean;
}
export interface LoadedSubagentSettings extends SubagentSettings {
    sources: SubagentSettingsSources;
}
export declare function loadSubagentSettings(cwd: string): LoadedSubagentSettings;
