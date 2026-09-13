import {
  applyAnswer,
  fillActivePool,
  getRequiredStreak,
  getStats,
  selectNextFromPool,
  shuffle,
} from "@/algorithm";
import {
  computeLearningSegments,
  type LearningSegment,
} from "./learningProgress";
import {
  buildRuntimeState,
  filterQuestions,
  getActivePoolItem,
  loadStoredState,
  resetStoredState,
  saveState,
  shouldRequeueActivePoolItem,
} from "@/store";
import type { Question, QuestionType, RuntimeState } from "@/types";
import { normalizeFilterType } from "./filters";
import { sanitizeBankSettings } from "@/bankSettings";

export type FilterChangeActivePoolPolicy = "keep-shown" | "clear-active-pool";

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
export type { LearningSegment };

export function hasShownActivePoolOutsideFilter(
  questions: Question[],
  state: RuntimeState,
  filterType: QuestionType | "all",
): boolean {
  if (filterType === "all") return false;

  const filteredIds = new Set(
    filterQuestions(questions, filterType).map((question) => question.id),
  );

  return state.activePool.some(
    (item) =>
      !shouldRequeueActivePoolItem(item) && !filteredIds.has(item.id),
  );
}

export function loadRuntimeState(
  questions: Question[],
  hash: string,
): RuntimeState {
  const storedState = loadStoredState(hash);
  storedState.filterType = normalizeFilterType(storedState.filterType, questions);
  storedState.settings = sanitizeBankSettings(storedState.settings);
  return buildRuntimeState(questions, storedState);
}

export function rebuildRuntimeState(
  questions: Question[],
  state: RuntimeState,
  filterType: QuestionType | "all",
): RuntimeState {
  return buildRuntimeState(questions, {
    masteredIds: state.masteredIds,
    masteredMistakes: state.masteredMistakes,
    activePool: state.activePool,
    currentRound: state.currentRound,
    settings: state.settings,
    filterType,
    ui: state.ui,
  });
}

export function rebuildRuntimeStateForFilterChange(
  questions: Question[],
  state: RuntimeState,
  filterType: QuestionType | "all",
  activePoolPolicy: FilterChangeActivePoolPolicy,
): RuntimeState {
  const activePool =
    activePoolPolicy === "clear-active-pool"
      ? []
      : state.activePool.filter((item) => !shouldRequeueActivePoolItem(item));

  return buildRuntimeState(questions, {
    masteredIds: state.masteredIds,
    masteredMistakes: state.masteredMistakes,
    activePool,
    currentRound: state.currentRound,
    settings: state.settings,
    filterType,
    ui: state.ui,
  });
}

export function createResetRuntimeState(
  questions: Question[],
  hash: string,
): RuntimeState {
  const resetState = resetStoredState(hash);
  resetState.filterType = normalizeFilterType(resetState.filterType, questions);
  resetState.settings = sanitizeBankSettings(resetState.settings);
  return buildRuntimeState(questions, resetState);
}
