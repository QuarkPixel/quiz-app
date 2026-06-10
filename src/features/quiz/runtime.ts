import {
  applyAnswer,
  computeLearningSegments,
  fillActivePool,
  getRequiredStreak,
  getStats,
  selectNextFromPool,
  shuffle,
} from "../../algorithm";
import {
  buildRuntimeState,
  getActivePoolItem,
  isUnansweredNewActivePoolItem,
  loadStoredState,
  resetStoredState,
  saveState,
} from "../../store";
import type { Question, QuestionType, RuntimeState } from "../../types";
import { normalizeFilterType } from "./filters";
import { sanitizeUserSettings } from "./settings";

export interface RuntimePersistenceOptions {
  usePersistedDefaultSettings?: boolean;
}

export {
  applyAnswer,
  computeLearningSegments,
  fillActivePool,
  getActivePoolItem,
  getRequiredStreak,
  getStats,
  saveState,
  selectNextFromPool,
  shuffle,
};
export type { LearningSegment } from "../../algorithm";

export function loadRuntimeState(
  questions: Question[],
  hash: string,
  options: RuntimePersistenceOptions = {},
): RuntimeState {
  const storedState = loadStoredState(hash, options);
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
  const cleanedActivePool = state.activePool.filter(
    (item) => !isUnansweredNewActivePoolItem(item),
  );
  return buildRuntimeState(questions, {
    masteredIds: state.masteredIds,
    activePool: cleanedActivePool,
    currentRound: state.currentRound,
    settings: state.settings,
    filterType,
    ui: state.ui,
  });
}

export function createResetRuntimeState(
  questions: Question[],
  hash: string,
  options: RuntimePersistenceOptions = {},
): RuntimeState {
  const resetState = resetStoredState(hash, options);
  resetState.filterType = normalizeFilterType(resetState.filterType, questions);
  resetState.settings = sanitizeUserSettings(resetState.settings);
  return buildRuntimeState(questions, resetState);
}
