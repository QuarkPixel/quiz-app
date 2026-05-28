import IconCircleDot from "@tabler/icons-svelte/icons/circle-dot";
import type { QuestionTypeDef } from "../types";
import { singleLogic } from "./logic";
import Input from "./Input.svelte";
import Review from "./Review.svelte";

export const singleType: QuestionTypeDef = {
  ...singleLogic,
  icon: IconCircleDot,
  Input,
  Review,
};
