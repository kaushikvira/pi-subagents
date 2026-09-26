import { Type } from "typebox";
export declare function taskParametersSchema(): Type.TObject<{
    agent_type: Type.TOptional<Type.TString>;
    prompt: Type.TString;
    description: Type.TString;
    workspace_group: Type.TOptional<Type.TString>;
    herdr_layout: Type.TOptional<Type.TLiteral<"attached">>;
    isolation: Type.TOptional<Type.TLiteral<"worktree">>;
    cwd: Type.TOptional<Type.TString>;
    task_id: Type.TOptional<Type.TString>;
    conversation_id: Type.TOptional<Type.TString>;
    model: Type.TOptional<Type.TString>;
    __pi_subagents_invocation_id: Type.TOptional<Type.TString>;
    background: Type.TOptional<Type.TBoolean>;
}>;
export declare function listModelsParametersSchema(): Type.TObject<{}>;
