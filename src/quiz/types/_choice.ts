/**
 * 选择题（single / multiple）共享的校验逻辑。
 * 错误消息文本严格匹配原 validateQuestions.ts 的写法，避免回归。
 */
export function validateChoiceQuestion(
  item: Record<string, unknown>,
  ctx: string,
  isSingle: boolean,
): string[] {
  const errors: string[] = [];
  const options = item.options;
  const answer = item.answer;

  if (!Array.isArray(options) || options.length === 0) {
    errors.push(`${ctx}：选择题 options 必须是非空数组。`);
    return errors;
  }
  for (let j = 0; j < options.length; j++) {
    const opt = options[j] as Record<string, unknown>;
    if (!opt || typeof opt.text !== "string") {
      errors.push(`${ctx}：选项 ${j} 缺少 text 字段。`);
    }
  }
  if (!Array.isArray(answer) || !answer.every((n) => Number.isInteger(n))) {
    errors.push(`${ctx}：选择题 answer 必须是整数数组。`);
    return errors;
  }
  if (isSingle && answer.length !== 1) {
    errors.push(`${ctx}：单选题 answer 必须只有一个索引。`);
  }
  for (const n of answer as number[]) {
    if (n < 0 || n >= options.length) {
      errors.push(`${ctx}：answer 索引 ${n} 超出 options 范围。`);
    }
  }
  return errors;
}

/**
 * 选择题（single / multiple）共享的答案文字摘要：按索引升序取 option.text，斜杠拼接。
 */
export function formatChoiceAnswerText(
  question: { options?: { text: string }[]; answer: unknown },
): string {
  const indices = question.answer as number[];
  if (!question.options) return "";
  return indices
    .slice()
    .sort((a, b) => a - b)
    .map((idx) => question.options![idx]?.text ?? "")
    .filter(Boolean)
    .join(" / ");
}

/**
 * 选择题（single / multiple）共享的答错反馈字母拼接。
 * 按正确索引在 shuffled 后的位置取字母，A 起始；排序后拼接。
 */
export function choiceLetters(
  question: { answer: unknown },
  shuffledOptions: { originalIndex: number }[],
): string {
  const correctAnswers = question.answer as number[];
  return correctAnswers
    .map((originalIndex) => {
      const optionPosition = shuffledOptions.findIndex(
        (o) => o.originalIndex === originalIndex,
      );
      return String.fromCharCode(65 + optionPosition);
    })
    .sort()
    .join("");
}
