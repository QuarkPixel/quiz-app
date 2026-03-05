import type { Question, QuestionType } from "../../types";

export interface FilterOption {
  key: QuestionType | "all";
  label: string;
}

const QUESTION_TYPE_ORDER: QuestionType[] = [
  "judgment",
  "single",
  "multiple",
  "blank",
];

const QUESTION_TYPE_LABELS: Record<QuestionType, string> = {
  judgment: "判断题",
  single: "单选题",
  multiple: "多选题",
  blank: "填空题",
};

export function getTypeName(type: QuestionType): string {
  return QUESTION_TYPE_LABELS[type];
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
