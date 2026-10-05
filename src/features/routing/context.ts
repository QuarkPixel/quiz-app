/**
 * 路由器的取用入口。
 *
 * 和 `source/context.ts` / `features/memory/context.ts` 同一套写法：应用级单例，
 * 但组件通过 `useRouter()` 拿——这样组件测试可以塞一个假的进来（`provideRouter`），
 * 不必去动 `window.history`。
 */

import { getContext, setContext } from "svelte";
import { Router } from "./router.svelte";

const ROUTER_KEY = Symbol("quiz-app-router");

/** 应用级那一个（`App.svelte` 提供，路由状态挂在它身上）。 */
export const router = new Router();

export function provideRouter(value: Router = router): Router {
  setContext(ROUTER_KEY, value);
  return value;
}

export function useRouter(): Router {
  const value = getContext<Router | undefined>(ROUTER_KEY);
  if (!value) {
    throw new Error("useRouter() 必须在 provideRouter() 之后调用");
  }
  return value;
}
