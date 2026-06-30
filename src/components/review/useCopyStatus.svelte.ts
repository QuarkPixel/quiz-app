import type { Question } from "@/types";
import type { QuizSession } from "@/quiz/session/QuizSession.svelte";
import type { CopyQuestionStatus } from "@/quiz/session/QuizSession.svelte";
import { QuestionCopyPattern } from "@/quiz/types/types";

/** 每道题的复制按钮状态机：成功 / 失败后短暂展示，再回 idle。 */
export class CopyStatus {
  private statuses = $state<Record<string, CopyQuestionStatus>>({});
  private timers: Record<string, ReturnType<typeof setTimeout>> = {};

  constructor(private readonly session: QuizSession) {}

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

  async copy(event: MouseEvent, question: Question): Promise<void> {
    event.stopPropagation();
    const result = await this.session.copyQuestion(
      question,
      {},
      QuestionCopyPattern.QuestionWithAnswer,
    );
    this.set(question.id, result === "copied" ? "copied" : "error");
  }
}
