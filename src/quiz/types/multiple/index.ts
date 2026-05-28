import IconChecks from "@tabler/icons-svelte/icons/checks";
import type { QuestionTypeDef } from "../types";
import { multipleLogic } from "./logic";

export const multipleType: QuestionTypeDef = {
  ...multipleLogic,
  icon: IconChecks,
};
