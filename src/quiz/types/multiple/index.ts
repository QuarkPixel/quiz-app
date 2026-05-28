import IconChecks from "@tabler/icons-svelte/icons/checks";
import type { QuestionTypeDef } from "../types";
import { multipleLogic } from "./logic";
import Input from "./Input.svelte";
import Review from "./Review.svelte";

export const multipleType: QuestionTypeDef = {
  ...multipleLogic,
  icon: IconChecks,
  Input,
  Review,
};
