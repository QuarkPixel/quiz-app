import { getContext, setContext } from "svelte";
import type { QuizSession } from "./QuizSession.svelte";

const KEY = Symbol("QuizSession");

/** 在容器组件（QuizView）里把 session 注入到 svelte context。 */
export function provideQuizSession(session: QuizSession): void {
  setContext(KEY, session);
}

/**
 * 在 session 注入后的子组件里拿到 session 实例。
 *
 * 子组件读取 session.appState.xxx 触发 reactivity；直接 destructure
 * 会切断 reactivity，调用方应保持链式访问。
 */
export function useQuizSession(): QuizSession {
  const session = getContext<QuizSession | undefined>(KEY);
  if (!session) {
    throw new Error(
      "useQuizSession() must be called inside a component nested under provideQuizSession()",
    );
  }
  return session;
}
