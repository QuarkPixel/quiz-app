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
import type { Question, QuestionType, RuntimeState } from "../../types";
import { normalizeFilterType } from "./filters";
import { sanitizeUserSettings } from "./settings";

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

export function loadRuntimeState(
  questions: Question[],
  hash: string,
): RuntimeState {
  const storedState = loadStoredState(hash);
  storedState.filterType = normalizeFilterType(storedState.filterType, questions);
  storedState.settings = sanitizeUserSettings(storedState.settings);
  return buildRuntimeState(questions, storedState);
}

export function rebuildRuntimeState(
  questions: Question[],
  state: RuntimeState,
  filterType: QuestionType | "all",
): RuntimeState {
  // filter 切换时，剔除"加进 pool 但还没真正展示过"的旧 filter 题，
  // 避免它们继续占据 pool 导致连续出同类
  const initialRound = -(state.settings.activePoolSize ?? 25) * 2;
  const cleanedActivePool = state.activePool.filter(
    (item) => item.lastSelectedRound !== initialRound,
  );
  return buildRuntimeState(questions, {
    masteredIds: state.masteredIds,
    activePool: cleanedActivePool,
    currentRound: state.currentRound,
    settings: state.settings,
    filterType,
  });
}

export function createResetRuntimeState(
  questions: Question[],
  hash: string,
): RuntimeState {
  const resetState = resetStoredState(hash);
  resetState.filterType = normalizeFilterType(resetState.filterType, questions);
  resetState.settings = sanitizeUserSettings(resetState.settings);
  return buildRuntimeState(questions, resetState);
}
