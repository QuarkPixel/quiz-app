import {
  computeLearningSegments,
  fillActivePool,
  getRequiredStreak,
  getStats,
  processAnswer,
  selectNextFromPool,
  shuffle,
} from "../../algorithm";
import {
  buildRuntimeState,
  getActivePoolItem,
  loadStoredState,
  resetStoredState,
  saveState,
} from "../../store";
import type { LoadStoredStateResult } from "../../store";
import type { Question, QuestionType, RuntimeState } from "../../types";
import { normalizeFilterType } from "./filters";
import { sanitizeUserSettings } from "./settings";

export type { LoadStoredStateResult } from "../../store";

export {
  computeLearningSegments,
  fillActivePool,
  getActivePoolItem,
  getRequiredStreak,
  getStats,
  processAnswer,
  saveState,
  selectNextFromPool,
  shuffle,
};
export type { LearningSegment } from "../../algorithm";

export type LoadRuntimeStateResult =
  | { kind: "ok"; state: RuntimeState }
  | { kind: "hash_mismatch"; state: RuntimeState; savedHash: string; currentHash: string };

export function loadRuntimeState(questions: Question[]): LoadRuntimeStateResult {
  const result: LoadStoredStateResult = loadStoredState();
  const storedState = result.state;
  storedState.filterType = normalizeFilterType(storedState.filterType, questions);
  storedState.settings = sanitizeUserSettings(storedState.settings);
  const state = buildRuntimeState(questions, storedState);

  if (result.kind === "hash_mismatch") {
    return { kind: "hash_mismatch", state, savedHash: result.savedHash, currentHash: result.currentHash };
  }
  return { kind: "ok", state };
}

export function rebuildRuntimeState(
  questions: Question[],
  state: RuntimeState,
  filterType: QuestionType | "all",
): RuntimeState {
  return buildRuntimeState(questions, {
    masteredIds: state.masteredIds,
    activePool: state.activePool,
    currentRound: state.currentRound,
    settings: state.settings,
    filterType,
  });
}

export function createResetRuntimeState(questions: Question[]): RuntimeState {
  const resetState = resetStoredState();
  resetState.filterType = normalizeFilterType(resetState.filterType, questions);
  resetState.settings = sanitizeUserSettings(resetState.settings);
  return buildRuntimeState(questions, resetState);
}
