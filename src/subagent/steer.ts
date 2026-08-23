import type { TerminalHandle } from "../types.js";
import { createSyncHerdrControl } from "./herdr.js";
import { paneExists, tmuxSteerPane } from "./tmux.js";

export type SteerResult =
	| { ok: true }
	| { ok: false; reason: "no_pane" | "pane_dead" | "inject_failed" | "empty_prompt" };

/** Send follow-up prompt to a running tmux subagent (background steer). */
export function steerRunningBackgroundTask(
	paneId: string | null | undefined,
	prompt: string | undefined,
	handle?: TerminalHandle,
): SteerResult {
	// The resume paths call this with a schema parameter that is not runtime-
	// validated; an undefined/empty prompt must be a clean tool error, not an
	// uncaught TypeError.
	if (typeof prompt !== "string") {
		return { ok: false, reason: "empty_prompt" };
	}
	const text = prompt.trim();
	if (!text) return { ok: false, reason: "empty_prompt" };
	if (handle?.backend === "herdr") {
		try {
			createSyncHerdrControl().send(handle, text);
			return { ok: true };
		} catch {
			return { ok: false, reason: "inject_failed" };
		}
	}
	if (!paneId) return { ok: false, reason: "no_pane" };
	// Fresh check: steering into a pane that died up to a TTL ago would fail
	// the inject and misreport the reason.
	if (!paneExists(paneId, { fresh: true })) return { ok: false, reason: "pane_dead" };
	try {
		tmuxSteerPane(paneId, text);
		return { ok: true };
	} catch {
		return { ok: false, reason: "inject_failed" };
	}
}