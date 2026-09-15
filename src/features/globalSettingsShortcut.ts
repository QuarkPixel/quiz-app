/**
 * ⌘⇧I（Mac）/ Ctrl+Shift+I（其他）：打开全局设置。
 *
 * 全局设置跟具体题库无关（宿主是 `Sidebar.svelte` 里的 `<GlobalSettings>`），
 * 所以这个快捷键也是**应用级**的：刷题 / 记忆 / 还没导入题库的空状态都能按，
 * 窗口监听就挂在 `Sidebar.svelte` 上（它始终挂载，且已经持有对话框开关）。
 *
 * 与 `SHORTCUTS.toggleSettings`（⌘I = 当前题库设置）只差一个 ⇧，
 * 两边不要写混。
 *
 * **两个模态视图必须先把它让出去**（刷题与记忆共用 `features/appShortcuts.ts`
 * 的 `createAppKeyboardHandler`，那里有一行早退）：题目级分发不认修饰键，
 * `i` 在第 9 个选项存在时正好是它的字母——不让的话 ⌘⇧I 会顺手选中 I 选项、
 * 甚至直接提交。
 */

import { SHORTCUTS } from "@/config";
import { isInsideDialog } from "@/features/quiz";
import { globalSettingsDialog } from "@/features/globalSettingsDialog.svelte";

/** 键位本身是否匹配（不含输入框 / 对话框这类上下文判定）。 */
export function isGlobalSettingsShortcut(event: KeyboardEvent): boolean {
  const mod = event.metaKey || event.ctrlKey;
  return (
    mod &&
    event.shiftKey &&
    !event.altKey &&
    // ⇧ 会把 `key` 变成大写 "I"，所以先小写化再比
    event.key.toLowerCase() === SHORTCUTS.toggleGlobalSettings
  );
}

/**
 * 应用级处理：窗口收到 ⌘⇧I 就打开全局设置，返回这次按键是否被吃掉。
 *
 * 三种情况不介入：
 *   - 输入法组词中 / 已经被别人处理过
 *   - 焦点在某个对话框里——模态框里的按键归模态框（与 ⌘I / ⌘O 一致），
 *     否则会在题库设置上面再叠一个全局设置
 *   - 按的不是这个键位
 */
export function handleGlobalSettingsShortcut(event: KeyboardEvent): boolean {
  if (event.defaultPrevented || event.isComposing) return false;
  if (!isGlobalSettingsShortcut(event)) return false;
  if (isInsideDialog(event)) return false;

  event.preventDefault();
  globalSettingsDialog.show();
  return true;
}
