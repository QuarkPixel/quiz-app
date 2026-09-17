/**
 * 快捷键配置：**按键、说明文案、分发三者同源**。
 *
 * 修饰键固定为 ⌘ (Mac) / Ctrl (其他)，下面是配合修饰键使用的具体字母（单字符，小写）。
 * 只有 `toggleGlobalSettings` 例外——它还要额外按住 ⇧（见 `@/features/globalSettingsShortcut`）。
 *
 * 注意：sidebar 的快捷键由 src/lib/components/ui/sidebar/constants.ts 导入此值后生效，
 * 改这里就会同步生效。
 */
export const SHORTCUTS = {
  /** 切换侧边栏 */
  sidebar: "b",
  /** 切换活动池（刷题模式专属） */
  togglePool: "p",
  /** 切换总览 */
  toggleReview: "o",
  /** 复制当前题目 */
  copyQuestion: "c",
  /** 切换设置 */
  toggleSettings: "i",
  /** 打开全局设置（⌘⇧I） */
  toggleGlobalSettings: "i",
  /** 切换"答对自动下一题" */
  toggleAutoNext: "n",
  /** 切换音效 */
  toggleSound: "s",
  /** 从剪贴板导入进度 */
  importProgress: "w",
  /** 导出进度到剪贴板 */
  exportProgress: "e",
  /** 立即同步（等价于点页头的同步指示点；云同步关掉时连这个键一起没有） */
  syncNow: "y",
} as const;

export type ShortcutId = keyof typeof SHORTCUTS;

export const SHORTCUT_IDS = Object.keys(SHORTCUTS) as ShortcutId[];

/** 一个应用级快捷键对用户可见的那一面。 */
export interface AppShortcutMeta {
  /** 展示用按键（配合 `modKeyLabel` 使用）；带 ⇧ 的写成 `⇧I` */
  kbd: string;
  /** 中文说明，设置面板底部的「快捷键」表直接用这句 */
  label: string;
}

/**
 * 应用级快捷键的元信息。
 *
 * 这一份同时喂给三处，避免「按键改了、提示 / 说明没跟着改」：
 *   1. `src/features/appShortcuts.ts` 的分发表（`Record<ShortcutId, …>`，
 *      少写一个 id 直接编译不过）
 *   2. 工具栏按钮 tooltip 里的 Kbd 提示
 *   3. `components/settings/ShortcutHelp.svelte` 那份说明
 */
export const APP_SHORTCUTS: Record<ShortcutId, AppShortcutMeta> = {
  sidebar: { kbd: "B", label: "显示 / 隐藏侧边栏" },
  togglePool: { kbd: "P", label: "展开 / 收起活动池" },
  toggleReview: { kbd: "O", label: "总览" },
  copyQuestion: { kbd: "C", label: "复制当前题目" },
  toggleSettings: { kbd: "I", label: "当前题库设置" },
  toggleGlobalSettings: { kbd: "⇧I", label: "全局设置" },
  toggleAutoNext: { kbd: "N", label: "答对自动下一题" },
  toggleSound: { kbd: "S", label: "开关音效" },
  importProgress: { kbd: "W", label: "从剪贴板导入进度" },
  exportProgress: { kbd: "E", label: "导出进度到剪贴板" },
  // 只有开着云同步时才有这个键（那时页头才有那颗指示点），所以说明不用带条件
  syncNow: { kbd: "Y", label: "立即同步" },
};

/**
 * 「快捷键」说明里的展示顺序。
 *
 * 单独列一份而不是靠对象键顺序：顺序是给用户读的，键顺序是实现细节。
 * `tests/appShortcuts.test.ts` 会检查每个 id 要么在这里、要么在
 * `UNLISTED_SHORTCUTS` 里，新增快捷键不会静默漏掉。
 */
export const LISTED_SHORTCUTS: readonly ShortcutId[] = [
  "toggleReview",
  "toggleSettings",
  "copyQuestion",
  "importProgress",
  "exportProgress",
  "toggleAutoNext",
  "toggleSound",
  "toggleGlobalSettings",
  "syncNow",
];

/** 不进说明面板的快捷键：要么由别的 UI 自己表达（侧边栏 / 活动池按钮），要么太冷门。 */
export const UNLISTED_SHORTCUTS: readonly ShortcutId[] = [
  "sidebar",
  "togglePool",
];
