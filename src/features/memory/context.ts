import { getContext, setContext } from "svelte";
import type { MemorySession } from "./MemorySession.svelte";

const KEY = Symbol("MemorySession");

/** 在记忆模式容器组件里把 session 注入到 svelte context。 */
export function provideMemorySession(session: MemorySession): void {
  setContext(KEY, session);
}

/**
 * 在子组件里拿到记忆模式 session。
 *
 * 与 `useQuizSession()` 一样：链式访问 `session.progress` / `session.appState.xxx`，
 * 不要 destructure（会切断 `$state` proxy 的响应性）。
 */
export function useMemorySession(): MemorySession {
  const session = getContext<MemorySession | undefined>(KEY);
  if (!session) {
    throw new Error(
      "useMemorySession() must be called inside a component nested under provideMemorySession()",
    );
  }
  return session;
}
