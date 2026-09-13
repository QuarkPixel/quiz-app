import quizPrompt from "/assets/prompts/quiz.md?raw";
import memoryPrompt from "/assets/prompts/memory.md?raw";
import type { IconComponent } from "@/quiz/types/types";
import type { BankMode } from "@/types";
import { BANK_MODE_META } from "./bankModeMeta";

/**
 * 各题库模式「给 LLM 的生成题库 Prompt」。
 *
 * 两个文件都放在 `assets/prompts/` 下，按模式一一对应：
 *
 * - `quiz.md`   → `mode: "quiz"`   带 type / options / answer 的刷题题库
 * - `memory.md` → `mode: "memory"` 只有 id / question / answer 的记忆卡片
 *
 * UI 入口：
 * - 侧边栏题库导入菜单 →「复制 Prompt」子菜单（两个模式各一项）
 * - 记忆模式总览右上角 →「复制 Prompt」（复制记忆模式那一份）
 */
const BANK_PROMPTS: Record<BankMode, string> = {
  quiz: quizPrompt,
  memory: memoryPrompt,
};

export function getBankPrompt(mode: BankMode): string {
  return BANK_PROMPTS[mode];
}

/** 「复制 Prompt」菜单/提示里用的元信息，按模式一一对应。 */
export interface BankPromptMeta {
  /** 菜单项文案，例如「生成刷题题库」 */
  label: string;
  /** 复制成功后的说明 */
  description: string;
  icon: IconComponent;
}

export const BANK_PROMPT_META: Record<BankMode, BankPromptMeta> = {
  quiz: {
    label: "生成刷题题库",
    description: "判断题 / 单选题 / 多选题 / 填空题",
    // 图标与侧边栏题库列表共用同一份选择（bankModeMeta.ts）
    icon: BANK_MODE_META.quiz.icon,
  },
  memory: {
    label: "生成记忆题库",
    description: "题目 + 答案的记忆卡片",
    icon: BANK_MODE_META.memory.icon,
  },
};

/** 按 `BankMode` 的声明顺序列出两个模式的 prompt 元信息。 */
export const BANK_PROMPT_MODES: BankMode[] = ["quiz", "memory"];
