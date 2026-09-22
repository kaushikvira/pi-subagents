import { Type } from "typebox";

export interface TaskSchemaOptions {
  /** subagents.defaultModel from settings; injected into the model param description. */
  defaultModel?: string;
}

export function taskParametersSchema(options: TaskSchemaOptions = {}) {
  const defaultModel =
    options.defaultModel ?? "subagents.defaultModel from settings";
  return Type.Object({
    agent_type: Type.Optional(Type.String({
      description:
        'The type of specialist agent to use for this task. Defaults to "coder" when omitted.',
    })),
    prompt: Type.String({
      description:
        "The complete task for the agent to perform. Self-contained about context, not pre-solved about solution. State the governed outcome (observable behavior, not an implementation), the frontier the agent owns deciding, locked decisions (each with rationale and an unlock condition), acceptance (what evidence would convince a skeptic), non-goals, and write/read policy.",
    }),
        description: Type.String({
          description: "A short (3-5 word) summary of the task",
        }),
        workspace_group: Type.Optional(Type.String({
          description: "Shared terminal workspace group. HerdR creates a dedicated workspace by default.",
        })),
        herdr_layout: Type.Optional(Type.Literal("attached", {
          description: "With workspace_group on HerdR, keep the parent in the left half and grid children in the right half; ignored by tmux and SDK backends.",
        })),
        isolation: Type.Optional(Type.Literal("worktree", {
          description: "Run writes in an isolated Git worktree. Changed worktrees are retained and returned; unchanged worktrees are removed.",
        })),
        cwd: Type.Optional(Type.String({
          description: "Absolute existing directory used as the child execution root. Defaults to the parent cwd; resumed tasks reuse their persisted cwd. With isolation: worktree, the worktree is created from the Git repository containing this directory.",
        })),

    task_id: Type.Optional(
      Type.String({
        description:
          "Resume an existing background task by id instead of starting a new task.",
      }),
    ),
    conversation_id: Type.Optional(
      Type.String({
        description:
          "Durable specialist conversation id. Reuses .pi/artifacts/task-<id>/sessions when called again.",
      }),
    ),
    model: Type.String({
      description:
        `Launch model, as 'provider/model-id'. Required for fresh launches — pass '${defaultModel}' when you have no preference. Call list_models for the full available set. When omitted at runtime it falls back to the agent profile's pinned model, then the session model. Ignored when resuming via task_id.`,
    }),
    __pi_subagents_invocation_id: Type.Optional(Type.String()),
    background: Type.Optional(
      Type.Boolean({
        description:
          "Run in background (async). You will be notified when it completes. DO NOT sleep, poll, ask the task for status, or duplicate its work while it runs in background.",
        default: true,
      }),
    ),
  });
}

export function listModelsParametersSchema() {
  return Type.Object({}, { additionalProperties: false });
}
