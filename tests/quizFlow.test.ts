import { describe, expect, it } from "vitest";
import {
  EMPTY_QUIZ_FLOW,
  advance,
  answerIsCorrect,
  ask,
  dropPreview,
  enqueue,
  judge,
  markCorrect,
  nextQueuedOf,
  questionOf,
  queuedOf,
  rewindOf,
  showsAnswer,
  type QuizFlow,
} from "../src/quiz/session/quizFlow";
import type { Question, RuntimeState } from "../src/types";

function q(id: string): Question {
  return { id, type: "judgment", question: `题-${id}`, answer: true };
}

/** 一个够用的 `RuntimeState` 替身（机器只把它当不透明快照）。 */
function state(tag: string): RuntimeState {
  return { currentRound: Number(tag) } as unknown as RuntimeState;
}

describe("quizFlow：状态与投影", () => {
  it("空状态没有题、没有队列、不亮答案", () => {
    expect(questionOf(EMPTY_QUIZ_FLOW)).toBeNull();
    expect(queuedOf(EMPTY_QUIZ_FLOW)).toEqual([]);
    expect(showsAnswer(EMPTY_QUIZ_FLOW)).toBe(false);
    expect(answerIsCorrect(EMPTY_QUIZ_FLOW)).toBe(false);
    expect(rewindOf(EMPTY_QUIZ_FLOW)).toBeNull();
  });

  it("出题中：有题、不亮答案、没有快照", () => {
    const flow = ask(q("a"));
    expect(questionOf(flow)?.id).toBe("a");
    expect(showsAnswer(flow)).toBe(false);
    expect(rewindOf(flow)).toBeNull();
  });

  it("判分后：亮答案、对错跟着判分走、快照可读", () => {
    const flow = judge(ask(q("a")), false, state("1"));
    expect(flow.kind).toBe("judged");
    expect(showsAnswer(flow)).toBe(true);
    expect(answerIsCorrect(flow)).toBe(false);
    expect(rewindOf(flow)).toEqual(state("1"));
  });

  it("预告态：屏上就是预告的那道，且恒为「答对」那一档", () => {
    const judged = enqueue(judge(ask(q("a")), false, state("1")), [q("b")]);
    const flow = advance(judged) as QuizFlow;
    expect(flow.kind).toBe("preview");
    expect(questionOf(flow)?.id).toBe("b");
    expect(nextQueuedOf(flow)?.id).toBe("b");
    expect(showsAnswer(flow)).toBe(true);
    expect(answerIsCorrect(flow)).toBe(true);
  });
});

describe("quizFlow：非法转移是空操作", () => {
  it("预告态 / 判分后再提交都转不动", () => {
    const judged = judge(ask(q("a")), true, state("1"));
    expect(judge(judged, false, state("2"))).toBe(judged);

    const preview = advance(enqueue(judged, [q("b")]))!;
    expect(judge(preview, false, state("2"))).toBe(preview);
    expect(judge(EMPTY_QUIZ_FLOW, true, state("1")).kind).toBe("empty");
  });

  it("「视作正确」只对判分后的画面有效，且只能用一次", () => {
    const judged = judge(ask(q("a")), false, state("1"));
    const corrected = markCorrect(judged);
    expect(corrected.kind).toBe("judged");
    expect(corrected.kind === "judged" && corrected.correct).toBe(true);
    expect(rewindOf(corrected)).toBeNull();

    // 再用一次什么都不变（快照已经用掉了）
    expect(markCorrect(corrected)).toEqual(corrected);
    expect(markCorrect(ask(q("a"))).kind).toBe("asking");
  });
});

describe("quizFlow：队列与推进", () => {
  it("入队接在队尾，预告态也接", () => {
    const asking = enqueue(ask(q("a")), [q("b"), q("c")]);
    expect(queuedOf(asking).map((x) => x.id)).toEqual(["b", "c"]);

    const preview = advance(asking)!;
    const extended = enqueue(preview, [q("d")]);
    expect(queuedOf(extended).map((x) => x.id)).toEqual(["b", "c", "d"]);
  });

  it("advance：有队列就进预告，队列走空才返回 null", () => {
    const asking = enqueue(ask(q("a")), [q("b")]);
    const first = advance(asking)!;
    expect(first.kind).toBe("preview");
    expect(nextQueuedOf(first)?.id).toBe("b");

    // 只剩一张预告 → 推不动了，交给会话出下一题
    expect(advance(first)).toBeNull();

    const two = enqueue(ask(q("a")), [q("b"), q("c")]);
    const preview2 = advance(two)!;
    const second = advance(preview2)!;
    expect(nextQueuedOf(second)?.id).toBe("c");
    expect(advance(second)).toBeNull();
  });

  it("没有队列时 advance 推不动（空状态也一样）", () => {
    expect(advance(ask(q("a")))).toBeNull();
    expect(advance(judge(ask(q("a")), true, state("1")))).toBeNull();
    expect(advance(EMPTY_QUIZ_FLOW)).toBeNull();
  });

  it("dropPreview：先出队再决定要不要继续预告", () => {
    const preview = advance(enqueue(ask(q("a")), [q("b"), q("c")]))!;
    const next = dropPreview(preview)!;
    expect(nextQueuedOf(next)?.id).toBe("c");

    // 只剩一张预告 → 出队之后就没了，交给会话出下一题
    expect(dropPreview(next)).toBeNull();
  });

  it("转移是纯函数：原状态不被改写", () => {
    const base = enqueue(ask(q("a")), [q("b")]);
    const snapshot = JSON.parse(JSON.stringify(base));
    advance(base);
    judge(base, true, state("1"));
    enqueue(base, [q("c")]);
    expect(JSON.parse(JSON.stringify(base))).toEqual(snapshot);
  });
});
