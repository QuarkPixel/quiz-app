/**
 * 产品语义事件 → uisfx cue 的唯一映射表。
 *
 * 这一层是**唯一**知道「哪件事该响哪个声音」的地方：业务代码只说发生了什么
 * （`answer-correct` / `bank-switch` / `dialog-open` …），不直接写 cue 名。
 * 于是换音效包、调某个事件的音色、审计「是不是加太多了」都只改这一张表。
 *
 * 选包：`minimal`。这个应用是文字密集、节奏克制的刷题工具，界面与动效都是
 * 去装饰的（系统 UI 风格）；`minimal` 的「干、准、几乎不可见」正好与之同构。
 * `arcade` / `rubber` 会把答题变成游戏，`glass` / `cinematic` 又太隆重，
 * `zen` 留白过多、反馈不够明确。
 *
 * 克制原则：
 *   - 只给**有意义的状态变化**配音（判分、标熟、切换、开合、提交成功）；
 *   - 不给 hover / 普通点击 / 选项选中 / 滚动 / 列表重复项配音；
 *   - 一次交互通常只响一声：例如删除只在**删掉之后**响 `delete`，
 *     确认弹窗的开合不再叠一层。
 */

import type { CueName } from "uisfx";

/** 全应用只用一个包；多处需要读它（设置面板文案 / 测试）。 */
export const SOUND_PACK = "minimal";

/**
 * 事件 → cue。
 *
 * cue 的语义来自 uisfx catalog 的原始定义（不是按控件长相挑的）：
 *   check      「任务进入完成态」→ 答对 / 同步确认
 *   error      「动作失败，需要留意」→ 答错 / 操作失败
 *   checkpoint 「长流程里的一个有意义阶段被保存」→ 标熟
 *   complete   「多步流程到达终态」→ 一轮学完 / 复习完
 *   start/stop 「流程开始 / 结束」→ 进出学习、复习会话
 *   select     「一项进入活动集」→ 切换当前题库
 *   open/close 「面板 / 弹层出现 / 退场」→ 对话框开合
 *   copy       「选中内容进入剪贴板」→ 复制题目 / 导出进度
 *   success    「动作以预期结果完成」→ 导入进度
 *   delete     「破坏性移除已提交」→ 删除题库
 *   toggle-on  「二值设置变为开启」→ 打开音效时的试听
 *   volume-change 「响度移动到新档位」→ 拖动音量（每一档都试听）
 *   reaction   「一个轻量的回应被加进来」→ 手动同步成功的日常确认
 *   hover      「细指针发现，但还没承诺」→ 热力图格子（唯一允许的悬停音）
 *   swipe      「手势把内容移到别处」→ 点热力图跳到对应题目
 *   forward    「导航前进到下一个地方」→ 手动下一题 / 我知道了
 *   toggle-on/off 「二值设置变为开 / 关」→ 设置面板里的 switch
 *   select     「一项进入活动集」→ 设置里的单选 / 分段选择
 *   deselect   「一项离开活动集」→ 多选筛选里取消勾选
 *   snap       「对象锁进一个精确位置」→ 数值滑杆 / 数字输入落定一档
 *   delete     「破坏性移除已提交」→ 删除题库 / 重置进度
 *   open/close 「面板 / 弹层出现 / 退场」→ 侧边栏展开 / 收起
 *   drag-start / drop 「把东西拖起来 / 放回去」→ 活动池展开 / 收起
 */
export const SOUND_CUES = {
  "answer-correct": "check",
  "answer-wrong": "error",
  "question-mastered": "checkpoint",
  "round-complete": "complete",
  "session-start": "start",
  "session-end": "stop",
  "bank-switch": "select",
  // 侧边栏收起 / 展开是「面板退场 / 出现」，与对话框开合同一套 open / close。
  // 三个入口（rail、页头按钮、⌘B）都只改 sidebar.open，盯状态就够。
  "sidebar-expand": "open",
  "sidebar-collapse": "close",
  // 活动池不是「窗口」，而是被拖出来 / 放回去的一块：展开用 drag-start，
  // 收起用 drop。两个方向都走 session 的同一对方法，键盘 P 与抽屉下滑自动一致。
  "pool-expand": "drag-start",
  "pool-collapse": "drop",
  // 题库的轻量编辑：重命名 / 移到顶部。前者只是「收到」，后者是「内容被移走」。
  "bank-renamed": "reaction",
  "banks-moved": "swipe",
  // 导出成功且没有后续对话框时才响；失败 / 告警有汇总对话框，开合音已经够了。
  "bank-exported": "success",
  "dialog-open": "open",
  "dialog-close": "close",
  "clipboard-copy": "copy",
  "data-imported": "success",
  "bank-deleted": "delete",
  // 手动同步成功是一次日常操作的轻量回应：不再复用「答对」的 check，
  // 换一个更短、更「收到」的 reaction（与答对的语义分开）。
  "sync-succeeded": "reaction",
  // 热力图是唯一允许悬停音的地方：格子密集，所以服务层会按 55ms 冷却限流，
  // 并且只认细指针（触摸滑动不响）。点击跳转用 swipe：它确实是「内容被移走」
  // 的那一下，而不是普通的前进。
  "heatmap-hover": "hover",
  "heatmap-jump": "swipe",
  // 手动「下一题 / 我知道了」才响。答对自动下一题、标熟后自动推进都不响：
  // 那一下已经有 answer-correct / question-mastered，不该再叠一声。
  "next-question": "forward",
  "progress-reset": "delete",
  // 设置面板里的交互：开关 / 单选 / 数值档位。
  // 这三类只在**设置**里用，不要扩散到普通按钮（按钮有自己的结果音）。
  "setting-toggle-on": "toggle-on",
  "setting-toggle-off": "toggle-off",
  "setting-choice": "select",
  // 多选筛选里取消勾选是「一项离开活动集」：和选中分开，用户能听出方向。
  "setting-deselect": "deselect",
  "setting-step": "snap",
  "sound-enabled": "toggle-on",
  "volume-changed": "volume-change",
  "action-failed": "error",
} as const satisfies Record<string, CueName>;

/** 业务代码只认这些语义事件（少写一个键就编译不过）。 */
export type AppSoundEvent = keyof typeof SOUND_CUES;
