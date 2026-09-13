import type { Question } from "@/types";
import type {
  CopyQuestionOptions,
  CopyQuestionResult,
  CopyQuestionStatus,
} from "@/quiz/session/QuizSession.svelte";
import { QuestionCopyPattern } from "@/quiz/types/types";

/**
 * 这个 store 只用到 session 的 `copyQuestion`，所以按**结构**声明依赖：
 * 刷题模式的 `QuizSession` 与记忆模式的 `MemorySession` 都满足它，调用方不用
 * 再写 `as never` 之类把类型检查关掉的断言（那会掩盖签名不一致）。
 */
export interface CopyQuestionSession {
  copyQuestion(
    question: Question,
    options?: CopyQuestionOptions,
    pattern?: QuestionCopyPattern,
  ): Promise<CopyQuestionResult>;
}

/** 每道题的复制按钮状态机：成功 / 失败后短暂展示，再回 idle。 */
export class QuestionCopyStatusStore {
  private statuses = $state<Record<string, CopyQuestionStatus>>({});
  private timers: Record<string, ReturnType<typeof setTimeout>> = {};

  constructor(private readonly session: CopyQuestionSession) {}

  get(id: string): CopyQuestionStatus {
    return this.statuses[id] ?? "idle";
  }

  private set(id: string, status: CopyQuestionStatus): void {
    if (this.timers[id]) {
      clearTimeout(this.timers[id]);
      delete this.timers[id];
    }
    this.statuses[id] = status;
    if (status !== "idle") {
      this.timers[id] = setTimeout(() => {
        this.statuses[id] = "idle";
        delete this.timers[id];
      }, 1800);
    }
  }

  async copy(
    event: MouseEvent,
    question: Question,
    pattern: QuestionCopyPattern = QuestionCopyPattern.QuestionWithAnswer,
  ): Promise<void> {
    event.stopPropagation();
    const result = await this.session.copyQuestion(question, {}, pattern);
    this.set(question.id, result === "copied" ? "copied" : "error");
  }
}
