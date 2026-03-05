import {
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
  fillActivePool,
  getActivePoolItem,
  getRequiredStreak,
  getStats,
  processAnswer,
  saveState,
  selectNextFromPool,
  shuffle,
};

export function loadRuntimeState(questions: Question[]): RuntimeState {
  const storedState = loadStoredState();
  storedState.filterType = normalizeFilterType(storedState.filterType, questions);
  storedState.settings = sanitizeUserSettings(storedState.settings);
  return buildRuntimeState(questions, storedState);
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
