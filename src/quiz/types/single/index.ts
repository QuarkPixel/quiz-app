import IconCircleDot from "@tabler/icons-svelte/icons/circle-dot";
import type { QuestionTypeDef } from "../types";
import { singleLogic } from "./logic";

export const singleType: QuestionTypeDef = {
  ...singleLogic,
  icon: IconCircleDot,
};
