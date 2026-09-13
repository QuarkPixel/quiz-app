import { getContext, setContext } from "svelte";
import type { QuizSource } from "./types";

const KEY = Symbol("QuizSource");

/** 在 App 根组件注入 source，供深层组件（如 ReviewView 导出新题库）使用。 */
export function provideQuizSource(source: QuizSource): void {
  setContext(KEY, source);
}

/**
 * 拿到注入的 source（应用唯一的题库仓库 BankStore）。
 * 供深层组件（如 ReviewView 另存为新题库）使用。
 */
export function useQuizSource(): QuizSource {
  const source = getContext<QuizSource | undefined>(KEY);
  if (!source) {
    throw new Error(
      "useQuizSource() must be called inside a component nested under provideQuizSource()",
    );
  }
  return source;
}
