import type { Question } from "@/types";
import type {
  CopyQuestionSession,
  CopyQuestionStatus,
} from "@/quiz/session/types";
import { QuestionCopyPattern } from "@/quiz/types/types";
import { COPY_STATUS_RESET_MS } from "@/config";

/**
 * 每道题的复制按钮状态机：成功 / 失败后短暂展示，再回 idle。
 *
 * 依赖按**结构**声明（`CopyQuestionSession`）：刷题模式的 `QuizSession` 与
 * 记忆模式的 `MemorySession` 都满足它，调用方不用写 `as never` 之类把类型
 * 检查关掉的断言（那会掩盖签名不一致）。
 */
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
      }, COPY_STATUS_RESET_MS);
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
