import IconCursorText from "@tabler/icons-svelte/icons/cursor-text";
import type { QuestionTypeDef } from "../types";
import { blankLogic } from "./logic";

export const blankType: QuestionTypeDef = {
  ...blankLogic,
  icon: IconCursorText,
};
