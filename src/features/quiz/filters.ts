import type { Question, QuestionType } from "@/types";
import {
  QUESTION_TYPE_ORDER,
  QUESTION_TYPES_LOGIC,
} from "@/quiz/types/registry-logic";

export interface FilterOption {
  key: QuestionType | "all";
  label: string;
}

export function getTypeName(type: QuestionType): string {
  return QUESTION_TYPES_LOGIC[type].name;
}

export function getAvailableQuestionTypes(questions: Question[]): QuestionType[] {
  const typeSet = new Set(questions.map((question) => question.type));

  return QUESTION_TYPE_ORDER.filter((type) => typeSet.has(type));
}

export function buildFilterOptions(questions: Question[]): FilterOption[] {
  const availableTypes = getAvailableQuestionTypes(questions);

  if (availableTypes.length <= 1) {
    return availableTypes.map((type) => ({
      key: type,
      label: getTypeName(type),
    }));
  }

  return [
    { key: "all", label: "全部" },
    ...availableTypes.map((type) => ({
      key: type,
      label: getTypeName(type),
    })),
  ];
}

export function normalizeFilterType(
  filterType: QuestionType | "all",
  questions: Question[],
): QuestionType | "all" {
  const availableTypes = getAvailableQuestionTypes(questions);

  if (availableTypes.length === 0) return "all";
  if (availableTypes.length === 1) return availableTypes[0];
  if (filterType === "all") return "all";
  if (!availableTypes.includes(filterType)) return "all";

  return filterType;
}
