import { getContext, setContext } from "svelte";
import type { QuizSource } from "./types";

const KEY = Symbol("QuizSource");

/** 在 App 根组件注入 source，供深层组件（如 ReviewView 导出新题库）使用。 */
export function provideQuizSource(source: QuizSource): void {
  setContext(KEY, source);
}

/**
 * 拿到注入的 source。bundled 模式下同样可用（mode === "bundled"，
 * 无 importBank 等库方法），调用方据此判断能力。
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
