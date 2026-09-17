/**
 * ⌘Y（Mac）/ Ctrl+Y（其他）：手动同步一次——**等价于点击页头那颗同步指示点**。
 *
 * 三条规矩都照抄指示点，不是另立一套：
 *   - **只有开着云同步才有这个快捷键**：那颗点就是这时才出现的，指示点不在，
 *     ⌘Y 就完全不碰（留给浏览器的历史记录）；
 *   - 红点（有冲突 / 报错）时它跟点击一样是**打开全局设置**，不是盲目再同步一遍
 *     ——这两件事再同步一次都解决不了；
 *   - 正在同步中跟点击一样是空操作（`AppShell` 的 `clickable` 那一关）。
 *   所以宿主传进来的 `run` 就是指示点那个点击处理，两条路共用一个函数。
 *
 * 窗口监听挂在 `AppShell.svelte` 上，**不进** `features/appShortcuts.ts` 的分发表：
 * 那张表是**答题会话**的（宿主是 `QuizView` / `MemoryView`，没有题库时根本不挂载），
 * 而同步跟具体题库无关——空题库状态照样要能按（新设备打开就是为了把云端题库拉下来）。
 *
 * 与 ⌘⇧I（`globalSettingsShortcut.ts`）的分工：那个在侧边栏，这个在页头，
 * 都是「始终挂载 + 本来就持有那个入口」的组件。
 */

import { SHORTCUTS } from "@/config";
import { isInsideDialog } from "@/features/quiz";

/** 键位本身是否匹配（不含云同步开关 / 对话框这类上下文判定）。 */
export function isSyncNowShortcut(event: KeyboardEvent): boolean {
  const mod = event.metaKey || event.ctrlKey;
  return (
    mod &&
    !event.shiftKey &&
    !event.altKey &&
    // ⇧ 会把 `key` 变成大写，所以先小写化再比
    event.key.toLowerCase() === SHORTCUTS.syncNow
  );
}

export interface SyncShortcutHost {
  /** 云同步总开关：关掉时连快捷键一起没有。 */
  enabled: boolean;
  /** 按下去做的事——传指示点的点击处理，两条路才是同一件。 */
  run(): void;
}

/**
 * 应用级处理：窗口收到 ⌘Y 就「点一下指示点」，返回这次按键是否被吃掉。
 *
 * 四种情况不介入：
 *   - 云同步关着（指示点与这个快捷键都不存在）
 *   - 输入法组词中 / 已经被别人处理过
 *   - 按的不是这个键位
 *   - 焦点在某个对话框里——模态框里的按键归模态框（与 ⌘I / ⌘O / ⌘⇧I 一致）
 */
export function handleSyncNowShortcut(
  event: KeyboardEvent,
  host: SyncShortcutHost,
): boolean {
  if (!host.enabled) return false;
  if (event.defaultPrevented || event.isComposing) return false;
  if (!isSyncNowShortcut(event)) return false;
  if (isInsideDialog(event)) return false;

  // 云同步开着时 ⌘Y 就是这个应用的键：**跑不跑得动都吃掉**——正在同步中按了
  // 没反应可以，但顺手弹出浏览器的历史记录不行
  event.preventDefault();
  host.run();
  return true;
}
