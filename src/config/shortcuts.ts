/**
 * 快捷键配置。
 * 修饰键固定为 ⌘ (Mac) / Ctrl (其他)，下面是配合修饰键使用的具体字母（单字符，小写）。
 *
 * 注意：sidebar 的快捷键由 src/lib/components/ui/sidebar/constants.ts 导入此值后生效，
 * 改这里就会同步生效。
 */
export const SHORTCUTS = {
  /** 切换侧边栏 */
  sidebar: "b",
  /** 切换活动池 */
  togglePool: "p",
  /** 切换答案预览 */
  toggleReview: "d",
  /** 切换设置 */
  toggleSettings: "i",
  /** 切换"答对自动下一题" */
  toggleAutoNext: "n",
  /** 切换音效 */
  toggleSound: "s",
  /** 从剪贴板导入进度 */
  importProgress: "w",
  /** 导出进度到剪贴板 */
  exportProgress: "e",
} as const;
