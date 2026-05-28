import IconCircleHalf2 from "@tabler/icons-svelte/icons/circle-half-2";
import type { QuestionTypeDef } from "../types";
import { judgmentLogic } from "./logic";
import Input from "./Input.svelte";
import Review from "./Review.svelte";

export const judgmentType: QuestionTypeDef = {
  ...judgmentLogic,
  icon: IconCircleHalf2,
  Input,
  Review,
};
