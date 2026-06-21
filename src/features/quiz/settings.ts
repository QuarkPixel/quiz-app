import { fillActivePool } from "@/algorithm";
import { buildRuntimeState, shouldRequeueActivePoolItem } from "@/store";
import type {
  ActivePoolItem,
  Question,
  RuntimeState,
  StoredState,
  UserSettings,
} from "@/types";
import {
  ACTIVE_POOL_SIZE,
  CORRECT_STREAK_AFTER_MISTAKE,
  CORRECT_STREAK_TO_MASTER,
} from "@/config";
import { sanitizeSoundSettings } from "$sound";

const SETTINGS_BOUNDS = {
  activePoolSize: { min: 5, max: 100 },
  correctStreakToMaster: { min: 1, max: 10 },
  correctStreakAfterMistake: { min: 1, max: 20 },
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
    masteredMistakes: runtimeState.masteredMistakes,
    activePool: runtimeState.activePool,
    currentRound: runtimeState.currentRound,
    filterType: runtimeState.filterType,
    settings: runtimeState.settings,
    ui: runtimeState.ui,
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
  masteredMistakes: Record<string, boolean>,
  settings: UserSettings,
): {
  activePool: ActivePoolItem[];
  masteredIds: string[];
  masteredMistakes: Record<string, boolean>;
} {
  const masteredSet = new Set(masteredIds);
  const nextMasteredMistakes = { ...(masteredMistakes ?? {}) };
  const remained: ActivePoolItem[] = [];

  for (const item of activePool) {
    const requiredStreak = item.hasEverMistaken
      ? settings.correctStreakAfterMistake
      : settings.correctStreakToMaster;

    if (item.consecutiveCorrect >= requiredStreak) {
      masteredSet.add(item.id);
      nextMasteredMistakes[item.id] = item.hasEverMistaken;
      continue;
    }

    remained.push(item);
  }

  return {
    activePool: remained,
    masteredIds: [...masteredSet],
    masteredMistakes: nextMasteredMistakes,
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
    selectionMode:
      settings.selectionMode === "sequential" ? "sequential" : "random",
    ...sanitizeSoundSettings(settings),
  };
}

export function reconcileAfterSettingsChange(
  questions: Question[],
  runtimeState: RuntimeState,
  currentQuestionId?: string,
): ReconcileSettingsResult {
  const sanitizedSettings = sanitizeUserSettings(runtimeState.settings);
  const shownActivePool = runtimeState.activePool.filter(
    (item) => !shouldRequeueActivePoolItem(item),
  );

  const trimmedActivePool = trimActivePool(
    shownActivePool,
    sanitizedSettings.activePoolSize,
    currentQuestionId,
  );

  const thresholdApplied = applyThresholds(
    trimmedActivePool,
    runtimeState.masteredIds,
    runtimeState.masteredMistakes ?? {},
    sanitizedSettings,
  );

  const rebuilt = buildRuntimeState(questions, {
    ...toStoredStateLike(runtimeState),
    settings: sanitizedSettings,
    activePool: thresholdApplied.activePool,
    masteredIds: thresholdApplied.masteredIds,
    masteredMistakes: thresholdApplied.masteredMistakes,
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
