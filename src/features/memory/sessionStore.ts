/**
 * 记忆模式的**存储层**：把会话流收成可以落盘的会话、把盘上那份还原成运行时状态。
 *
 * 从 `MemorySession.svelte.ts` 拆出来的原因很直接：那个类同时管「屏上怎么跑」和
 * 「盘上长什么样」，两千多行里一半是在搬运字段。这一层是**纯函数**（除了读传入的
 * 参数），不碰 Svelte、不碰 localStorage、不发请求——所以它也是这一块里最该被
 * 单测盯住的地方。
 *
 * 两条不变式：
 *
 * 1. `memory` 段每次都是整体重建的，patch 没写到的字段原样保留。漏一个字段就会在
 *    下一次 `save()` 时把它抹掉（设置、本轮待办、今天学过一轮的标记都踩过）。
 * 2. 会话是**一条带 `rev` 的记录**，不是「当前这一屏」的快照。`buildLearningSession`
 *    的 `rev` 每次落盘都递增，这样同步层能判断「谁相对基准改过」。
 */

import type {
  DayKey,
  MemoryLearningSession,
  MemoryProgress,
  MemoryReviewSession,
  MemoryRoundState,
  MemorySessionsState,
  MemoryStoredState,
  Question,
  RuntimeState,
  StoredState,
} from "@/types";
import { nextRev } from "@/lib/rev";
import { buildRuntimeState } from "@/store";
import { dayKeyOf } from "./day";
import { memoryRoundRemaining } from "./round";
import {
  cardIdOf,
  isAnswered,
  queueOf,
  reviewOf,
  type MemoryFlow,
} from "./flow";
import {
  createLearningSession,
  createSessionId,
  normalizeSessions,
} from "./session";
import {
  createDefaultMemorySettings,
  sanitizeMemorySettings,
} from "./settings";
import { normalizeMemoryProgressMap } from "./normalize";

/** 会话流正在跑哪一档（`MemoryRun["kind"]`，不 import 类，避免类型环）。 */
type RunKind = MemoryFlow["run"]["kind"];

/**
 * 生成一份新的 `memory` 段：patch 里没写到的字段原样保留。
 *
 * `sessions` 只是「已经落盘的那一份」的占位，真正的会话由 `save()` 前一步算好、
 * 作为 patch 传进来——写进度时不能顺手把会话抹掉。
 */
export function memorySectionOf(
  current: MemoryStoredState | undefined,
  patch: Partial<MemoryStoredState>,
  savedSessions: MemorySessionsState | undefined,
): MemoryStoredState {
  return {
    progress: patch.progress ?? current?.progress ?? {},
    settings: patch.settings ?? current?.settings ?? createDefaultMemorySettings(),
    sessions: "sessions" in patch ? patch.sessions : savedSessions,
    learnedDay: "learnedDay" in patch ? patch.learnedDay : current?.learnedDay,
  };
}

/**
 * 写一条进度，并原样保住 `memory` 段里的其它字段。
 *
 * **这里是进度写入的唯一收口，也是唯一盖修订戳的地方**（见 `src/lib/rev.ts`）。
 * 盖戳的基准取「本机见过的同一条卡的最大戳」（本地那份与本次要写的那份取大），
 * 计数逐个递增——**不读墙上时钟**，所以两台设备的钟谁快谁慢都不影响次序。
 *
 * 注意：**从云端拉回来 / 合并出来的那份不走这里**（同步层直接落盘），
 * 否则两台设备各盖各的戳，同样的内容会算出不同状态，永远收敛不了。
 */
export function withProgress(
  base: RuntimeState,
  id: string,
  progress: MemoryProgress,
  savedSessions: MemorySessionsState | undefined,
): MemoryStoredState {
  const stamped: MemoryProgress = {
    ...progress,
    rev: nextRev(
      Math.max(base.memory?.progress?.[id]?.rev ?? 0, progress.rev ?? 0),
    ),
  };
  return memorySectionOf(
    base.memory,
    { progress: { ...(base.memory?.progress ?? {}), [id]: stamped } },
    savedSessions,
  );
}

/**
 * 让 `masteredIds` 与 `memory.progress` 保持一致。
 *
 * 记忆模式以 `progress[].state === "mastered"` 为准，`masteredIds` 只是它的投影
 * （导出文件名会数这个数量）。载入 / 导入进度时同步一次，免得出现「进度里明明有
 * 已掌握的卡，文件名却写 (0 of N)」这种自相矛盾。
 */
export function withSyncedMasteredIds(state: RuntimeState): RuntimeState {
  if (!state.memory) return state;
  const masteredIds = Object.entries(state.memory.progress)
    .filter(([, item]) => item.state === "mastered")
    .map(([id]) => id);
  return { ...state, masteredIds };
}

/**
 * 把「本轮 + 当前 flow」收成学习会话。
 *
 * 返回 `undefined` = 没有进行中的一轮（`round === null`）。返回的
 * `id` / `day` / `rev` 要由调用方写回会话字段：下一轮落盘时 `rev` 要在它们之上
 * 继续递增。
 */
export function buildLearningSessionOf(params: {
  round: MemoryRoundState | null;
  run: RunKind;
  flow: MemoryFlow;
  previous: MemoryLearningSession | undefined;
  sessionId: string;
  sessionDay: DayKey | 0;
  sessionRev: number;
  now: number;
}): {
  session: MemoryLearningSession | undefined;
  id: string;
  day: DayKey | 0;
  rev: number;
} {
  const { round, previous, now } = params;
  if (!round) {
    return {
      session: undefined,
      id: params.sessionId,
      day: params.sessionDay,
      rev: params.sessionRev,
    };
  }

  const running = params.run === "learning";
  const sameRound =
    previous !== undefined &&
    previous.round.cardIds.join("\u0000") === round.cardIds.join("\u0000");

  const queue = running
    ? queueOf(params.flow).filter(
        (id) => round.cardIds.includes(id) && !round.masteredIds.includes(id),
      )
    : sameRound
      ? [...previous.queue]
      : memoryRoundRemaining(round);
  // 补齐这一轮还没学、但会话里没有的卡（老数据 / 被剪枝过）
  for (const id of memoryRoundRemaining(round)) {
    if (!queue.includes(id)) queue.push(id);
  }

  const currentId = running
    ? cardIdOf(params.flow)
    : previous?.currentId && queue.includes(previous.currentId)
      ? previous.currentId
      : null;
  const answered = running ? isAnswered(params.flow) : false;

  const id = sameRound && previous ? previous.id : params.sessionId || createSessionId();
  const day =
    sameRound && previous ? previous.day : params.sessionDay || dayKeyOf(now);
  const rev = nextRev(Math.max(previous?.rev ?? 0, params.sessionRev));

  return {
    session: createLearningSession({ id, day, round, queue, currentId, answered, rev }),
    id,
    day,
    rev,
  };
}

/**
 * 把当前复习 flow 收成今天的复习会话。
 *
 * 不在复习时**保留盘上那份**（返回 `previous`）——「今天过了哪几道」是事实，
 * 不会因为退回首页就变回没过。
 */
export function buildReviewSessionOf(params: {
  run: RunKind;
  flow: MemoryFlow;
  previous: MemoryReviewSession | undefined;
  sessionDay: DayKey | null;
  sessionRev: number;
  now: number;
}): {
  session: MemoryReviewSession | undefined;
  day: DayKey | null;
  rev: number;
} {
  if (params.run !== "reviewing") {
    return {
      session: params.previous,
      day: params.sessionDay,
      rev: params.sessionRev,
    };
  }
  const review = reviewOf(params.flow);
  if (!review) {
    return {
      session: params.previous,
      day: params.sessionDay,
      rev: params.sessionRev,
    };
  }

  const day = params.sessionDay ?? dayKeyOf(params.now);
  const rev = nextRev(Math.max(params.previous?.rev ?? 0, params.sessionRev));

  return {
    session: {
      day,
      queue: [...queueOf(params.flow)],
      currentId: cardIdOf(params.flow),
      answered: isAnswered(params.flow),
      doneIds: [...review.reviewed],
      touchedIds: [...review.touched],
      targets: { ...review.target },
      failed: [...review.failed],
      streaks: { ...review.streaks },
      rev,
    },
    day,
    rev,
  };
}

/** 把两份会话拼成 `memory.sessions`；都没有时返回 `undefined`（不留空壳）。 */
export function buildSessions(
  learning: MemoryLearningSession | undefined,
  review: MemoryReviewSession | undefined,
): MemorySessionsState | undefined {
  if (!learning && !review) return undefined;
  return {
    ...(learning ? { learning } : {}),
    ...(review ? { review } : {}),
  };
}

/**
 * 盘上那份 `StoredState` → 记忆模式的 `RuntimeState`。
 *
 * - 会话做结构净化，并丢掉题库里已不存在的卡；昨天的复习会话**不在这里丢**，
 *   `startReview` 会把它并进今天；
 * - 时钟偏快的设备可能写出未来日期，`learnedDay` 读到就收敛到今天，否则其他设备
 *   在到达那天之前都不会显示「今天学过」；
 * - 活动池不落盘：它是学习轮 / 复习队列的运行时投影。
 */
export function loadMemoryState(params: {
  stored: StoredState;
  questions: Question[];
  now: number;
}): RuntimeState {
  const { stored, questions, now } = params;
  const today = dayKeyOf(now);
  const validIds = new Set(questions.map((q) => q.id));
  const sessions = normalizeSessions(stored.memory?.sessions, validIds);
  const learned = stored.memory?.learnedDay;
  const memory = stored.memory
    ? {
        ...stored.memory,
        progress: normalizeMemoryProgressMap(stored.memory.progress),
        settings: sanitizeMemorySettings(stored.memory.settings),
        sessions,
        learnedDay: learned !== undefined && learned > today ? today : learned,
      }
    : { progress: {}, settings: createDefaultMemorySettings() };

  return withSyncedMasteredIds(
    buildRuntimeState(questions, {
      ...stored,
      activePool: [],
      memory,
    }),
  );
}
