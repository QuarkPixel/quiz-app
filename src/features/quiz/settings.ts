import { fillActivePool } from "../../algorithm";
import { buildRuntimeState } from "../../store";
import type {
  ActivePoolItem,
  Question,
  RuntimeState,
  StoredState,
  UserSettings,
} from "../../types";
import {
  ACTIVE_POOL_SIZE,
  CORRECT_STREAK_AFTER_MISTAKE,
  CORRECT_STREAK_TO_MASTER,
} from "../../config";

const SETTINGS_BOUNDS = {
  activePoolSize: { min: 1, max: 200 },
  correctStreakToMaster: { min: 1, max: 50 },
  correctStreakAfterMistake: { min: 1, max: 50 },
} as const;

interface ReconcileSettingsResult {
  state: RuntimeState;
  shouldSelectNext: boolean;
}

function toBoundedInt(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  const numberValue = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numberValue)) return fallback;

  const rounded = Math.round(numberValue);
  if (rounded < min) return min;
  if (rounded > max) return max;
  return rounded;
}

function toStoredStateLike(runtimeState: RuntimeState): StoredState {
  return {
    masteredIds: runtimeState.masteredIds,
    activePool: runtimeState.activePool,
    currentRound: runtimeState.currentRound,
    filterType: runtimeState.filterType,
    settings: runtimeState.settings,
  };
}

function trimActivePool(
  activePool: ActivePoolItem[],
  targetSize: number,
  currentQuestionId?: string,
): ActivePoolItem[] {
  if (activePool.length <= targetSize) return [...activePool];

  const trimmed = activePool.slice(0, targetSize);
  if (!currentQuestionId || targetSize === 0) return trimmed;

  const hasCurrent = trimmed.some((item) => item.id === currentQuestionId);
  if (hasCurrent) return trimmed;

  const currentItem = activePool.find((item) => item.id === currentQuestionId);
  if (!currentItem) return trimmed;

  trimmed[targetSize - 1] = currentItem;
  return trimmed;
}

function applyThresholds(
  activePool: ActivePoolItem[],
  masteredIds: string[],
  settings: UserSettings,
): { activePool: ActivePoolItem[]; masteredIds: string[] } {
  const masteredSet = new Set(masteredIds);
  const remained: ActivePoolItem[] = [];

  for (const item of activePool) {
    const requiredStreak = item.hasEverMistaken
      ? settings.correctStreakAfterMistake
      : settings.correctStreakToMaster;

    if (item.consecutiveCorrect >= requiredStreak) {
      masteredSet.add(item.id);
      continue;
    }

    remained.push(item);
  }

  return {
    activePool: remained,
    masteredIds: [...masteredSet],
  };
}

export function sanitizeUserSettings(settings: UserSettings): UserSettings {
  return {
    autoNextOnCorrect: !!settings.autoNextOnCorrect,
    activePoolSize: toBoundedInt(
      settings.activePoolSize,
      ACTIVE_POOL_SIZE,
      SETTINGS_BOUNDS.activePoolSize.min,
      SETTINGS_BOUNDS.activePoolSize.max,
    ),
    correctStreakToMaster: toBoundedInt(
      settings.correctStreakToMaster,
      CORRECT_STREAK_TO_MASTER,
      SETTINGS_BOUNDS.correctStreakToMaster.min,
      SETTINGS_BOUNDS.correctStreakToMaster.max,
    ),
    correctStreakAfterMistake: toBoundedInt(
      settings.correctStreakAfterMistake,
      CORRECT_STREAK_AFTER_MISTAKE,
      SETTINGS_BOUNDS.correctStreakAfterMistake.min,
      SETTINGS_BOUNDS.correctStreakAfterMistake.max,
    ),
  };
}

export function reconcileAfterSettingsChange(
  questions: Question[],
  runtimeState: RuntimeState,
  currentQuestionId?: string,
): ReconcileSettingsResult {
  const sanitizedSettings = sanitizeUserSettings(runtimeState.settings);

  const trimmedActivePool = trimActivePool(
    runtimeState.activePool,
    sanitizedSettings.activePoolSize,
    currentQuestionId,
  );

  const thresholdApplied = applyThresholds(
    trimmedActivePool,
    runtimeState.masteredIds,
    sanitizedSettings,
  );

  const rebuilt = buildRuntimeState(questions, {
    ...toStoredStateLike(runtimeState),
    settings: sanitizedSettings,
    activePool: thresholdApplied.activePool,
    masteredIds: thresholdApplied.masteredIds,
  });

  const filled = fillActivePool(rebuilt);
  const shouldSelectNext =
    !!currentQuestionId &&
    !filled.activePool.some((item) => item.id === currentQuestionId);

  return {
    state: filled,
    shouldSelectNext,
  };
}
