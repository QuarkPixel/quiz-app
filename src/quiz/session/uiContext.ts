import { getContext, setContext } from "svelte";
import type { KeyboardUiActions } from "./types";

/**
 * 容器（`QuizView`）注入的 UI 动作。
 *
 * 键盘层要用的那两个（总览 / 设置）在 `KeyboardUiActions` 里声明，两个模式
 * 共用；`openReview` 是刷题模式自己的（「所有题目已掌握」空态里那颗按钮）。
 */
export interface QuizUiActions extends KeyboardUiActions {
  openReview: () => void;
}

const KEY = Symbol("QuizUiActions");

/** 在容器组件（QuizView）里把纯 UI 动作注入到 svelte context。 */
export function provideQuizUiActions(actions: QuizUiActions): void {
  setContext(KEY, actions);
}

/** 在子组件里拿到 review / settings 等容器级 UI 动作。 */
export function useQuizUiActions(): QuizUiActions {
  const actions = getContext<QuizUiActions | undefined>(KEY);
  if (!actions) {
    throw new Error(
      "useQuizUiActions() must be called inside a component nested under provideQuizUiActions()",
    );
  }
  return actions;
}
