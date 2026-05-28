import IconCursorText from "@tabler/icons-svelte/icons/cursor-text";
import type { QuestionTypeDef } from "../types";
import { blankLogic } from "./logic";
import Input from "./Input.svelte";
import Review from "./Review.svelte";

export const blankType: QuestionTypeDef = {
  ...blankLogic,
  icon: IconCursorText,
  Input,
  Review,
};
