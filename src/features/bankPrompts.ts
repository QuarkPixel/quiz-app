import quizPrompt from "/assets/prompt.md?raw";
import type { BankMode } from "@/types";

/**
 * 各题库模式「给 LLM 的生成题库 Prompt」。
 *
 * 目前只有刷题模式。给背诵模式加 prompt 时：
 *   1. 新增 `assets/prompts/recite.md`
 *   2. 在这里 `import recitePrompt from "/assets/prompts/recite.md?raw";`
 *   3. 注册到 BANK_PROMPTS.recite
 *   4. UI（Sidebar 的导入菜单）按题库模式 / 用户选择提供对应 prompt
 */
const BANK_PROMPTS: Partial<Record<BankMode, string>> = {
  quiz: quizPrompt,
};

export function getBankPrompt(mode: BankMode): string | null {
  return BANK_PROMPTS[mode] ?? null;
}
