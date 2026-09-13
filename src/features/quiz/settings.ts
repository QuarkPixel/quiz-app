import { fillActivePool } from "@/algorithm";
import { buildRuntimeState, shouldRequeueActivePoolItem } from "@/store";
import { sanitizeBankSettings } from "@/bankSettings";
import type {
  ActivePoolItem,
  Question,
  RuntimeState,
  StoredState,
  BankSettings,
} from "@/types";

interface ReconcileSettingsResult {
  state: RuntimeState;
  shouldSelectNext: boolean;
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
  settings: BankSettings,
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

export { sanitizeBankSettings };

export function reconcileAfterSettingsChange(
  questions: Question[],
  runtimeState: RuntimeState,
  currentQuestionId?: string,
): ReconcileSettingsResult {
  const sanitizedSettings = sanitizeBankSettings(runtimeState.settings);
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
