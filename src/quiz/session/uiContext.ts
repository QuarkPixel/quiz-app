import { getContext, setContext } from "svelte";

export interface QuizUiActions {
  openReview: () => void;
  toggleReview: () => void;
  toggleSettings: () => void;
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
