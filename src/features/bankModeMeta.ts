import type { IconComponent } from "@/quiz/types/types";
import type { BankMode } from "@/types";
import IconFileText from "@tabler/icons-svelte/icons/file-text";
import IconCards from "@tabler/icons-svelte/icons/cards";

/**
 * 题库模式的展示元信息：中文名 + 图标。
 *
 * 图标是「这一份题库属于哪种模式」的统一视觉标识，侧边栏题库列表与
 * 「复制 Prompt」菜单都用这里的同一份选择（改这里就两边一起变）。
 */
export interface BankModeMeta {
  /** 中文显示名，例如「刷题模式」 */
  label: string;
  icon: IconComponent;
}

export const BANK_MODE_META: Record<BankMode, BankModeMeta> = {
  quiz: {
    label: "刷题模式",
    icon: IconFileText,
  },
  memory: {
    label: "记忆模式",
    icon: IconCards,
  },
};
