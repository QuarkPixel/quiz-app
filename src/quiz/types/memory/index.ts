import IconCards from "@tabler/icons-svelte/icons/cards";
import type { QuestionTypeDef } from "../types";
import { memoryLogic } from "./logic";
import Input from "./Input.svelte";
import Review from "./Review.svelte";

/** 记忆题型：与另外四种题型同级，注册进 `src/quiz/types/registry.ts`。 */
export const memoryType: QuestionTypeDef = {
  ...memoryLogic,
  icon: IconCards,
  Input,
  Review,
};
