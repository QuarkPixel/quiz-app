# 记忆模式（memory）功能说明书 — 供外部审查

> 用途：把当前实现完整交代给其他 AI / 工程师做逻辑审查与找 bug。
> 仓库：中文题库刷题应用（Svelte 5 + Vite + TypeScript，进度存 localStorage）。
> 代码为唯一事实来源；本文尽量与 `src/features/memory/MemorySession.svelte.ts` 一致。
> markdown 文档：`AGENTS.md` 的「记忆模式（memory）」章节是同一份内容的开发版。

---

## 0. 一句话概括

应用有两种题库模式：**刷题模式（quiz）** 与 **记忆模式（memory）**。
记忆模式的每张卡只有题干和答案，用户看完题干后自评「知道 / 忘记」，系统按「轮内连对次数」判定是否学会 / 复习完成，并按 1/2/4/8… 天翻倍曲线安排长期复习。

---

## 1. 两种模式的关系

| | 刷题模式 `mode: "quiz"` | 记忆模式 `mode: "memory"` |
|---|---|---|
| 题目结构 | `id` / `type` / `question` / `options?` / `answer` | `id` / `question` / `answer`（`type` 可省略，导入时补 `"memory"`） |
| 判分 | 客观判分（4 种题型） | 自评（`知道` = 对 / `忘记` = 错） |
| 题型注册 | `judgment` / `single` / `multiple` / `blank` | 第 5 种题型 `memory`，与另 4 种同一套注册表与 UI 机制 |
| 复习调度 | 活动池 + 加权随机抽题 | 活动池（学习）+ 日期阶梯（复习） |

**记忆题型也是标准 `Question`**（`type: "memory"`、`answer` 恒为字符串），因此 `QuestionArea` / `QuestionPreview` / 判分 / 剪贴板复制等机制全部复用，没有独立的样式体系。

---

## 2. 数据结构

### 2.1 题库文件

```json
{
  "mode": "memory",
  "title": "计算机基础",
  "state": "<hash>.<base64url>",
  "questions": [
    { "id": "m1", "question": "取得进步", "answer": "make progress" }
  ]
}
```

- `mode` 省略时按 `"quiz"` 解析 —— 所以**记忆题库必须显式写 `"mode": "memory"`**
- `title` 用于导入后的题库命名；`state` 是进度备份（LLM 生成时应省略）
- 校验规则：`questions` 非空数组；每题 `id` 非空字符串且唯一；`question` / `answer` 非空字符串；若写了 `type`，只能是 `"memory"`

### 2.2 每张卡的进度（核心，落盘）

```ts
MemoryProgress = {
  state: "learning" | "reviewing" | "mastered",
  level: number,    // 掌握阶梯：第几次复习，从 1 开始；未进入阶梯时为 0
  streak: number,   // 轮内连续正确次数
  nextDue: number,  // 下次复习到期「日期」的锚点（本地当天 0 点的时间戳）；非复习中为 0
  lapses: number,   // 累计答错次数（仅统计）
}
```

**没有条目 = 未学习（new）**，不存 `"new"` 状态。

```ts
MemoryProgressMap = Record<string, MemoryProgress>   // key = 题目 id
MemoryRetryState = { day: number, targets: Record<string, number> }  // 本轮待补的「重新连对」
MemoryStoredState = { progress: MemoryProgressMap, settings: MemoryBankSettings, retry?: MemoryRetryState }
StoredState.memory?: MemoryStoredState               // 只有记忆模式题库有这段
StoredState.roundMastered?: number                   // 本轮已掌握几题（学习模式）
StoredState.roundGoal?: number                       // 本轮目标题数（开始时定下）
StoredState.learningPool?: ActivePoolItem[]          // 复习期间暂存的学习轮活动池（成员+顺序）
```

### 2.3 按题库设置

| 设置 | 存放位置 | 默认 | 边界 | 含义 |
|---|---|---|---|---|
| 连续正确次数 | `BankSettings.correctStreakToMaster` | 3 | 1–10 | 学习学会门槛 / 复习答错后的本轮目标 |
| 学习顺序 | `BankSettings.selectionMode` | `random` | `random` / `sequential` | 补题顺序 |
| 掌握阈值 M | `MemoryBankSettings.graduateLevel` | 7 | 3–10 | 走完几次复习算已掌握 |
| 目标每轮学习数 | `MemoryBankSettings.roundTarget` | 5 | 1–50 | 一轮学到几题算完成，同时作为活动题目池大小 |

> 前 2 项直接复用刷题模式的 `BankSettings`（同一份设置对象），只有后 2 项是记忆模式专属（存在 `StoredState.memory.settings`）。记忆模式**不用** `BankSettings.activePoolSize`（面板里没有这一项），池子容量跟着 `roundTarget` 走。

### 2.4 存储键

```
quiz_app_general              { activeBank, defaultSettings, library, globalSettings }
quiz_app_questions_<hash>     题目数组
quiz_app_state_<hash>         StoredState（两种模式共用这个键，记忆数据在 memory 段）
quiz_app_debug_day_offset     （仅 dev 调试用，时间快进天数）
```

题目 hash = `questions` 数组的 SHA-1 前 16 位，不含 `mode` / `state`。

---

## 3. 两个必须分开的概念

这是整套逻辑的核心，也是最容易实现错的地方：

| 概念 | 含义 | 存放 | 谁改变它 |
|---|---|---|---|
| **轮内连对**（本轮是否完成） | 这一轮这张卡还要连续答对几次 | `MemoryProgress.streak`；复习的目标次数在会话内存 `reviewTarget`，落盘副本在 `memory.retry`（当天有效） | 答对 +1；答错清零；目标达标后归 0 |
| **掌握阶梯**（长期曲线） | 1/2/4/8… 那条复习间隔曲线 | `MemoryProgress.level` / `nextDue` | **只有答错会归零**；答对本身不推进——推进发生在「本轮完成」那一刻 |

一句话：`streak` 管「这一轮过没过」，`level` 管「多久后再复习」。

---

## 4. 学习模式（`run = "learning"`）

### 4.1 出题：活动题目池

- 池子维持 `roundTarget` 张卡（`fillActivePool()`）；它与目标每轮学习数共用同一个设置
- 补题来源：「未学习」的卡（`progress[id] === undefined`）
- **`selectionMode` 只决定补进来的顺序**：
  - `sequential`：按题库原顺序取前几张未学习的
  - `random`：随机抽几张
- **入池之后，池内出题一律随机**（队列建好后洗牌）

### 4.2 轮次判定

- 不再「一轮开始时选一批题」，而是数**本轮已经掌握了几题**：`roundMastered`
- `roundMastered >= roundTarget`（默认 5）→ 本轮结束
- 每掌握一题：`roundMastered += 1` → 立刻 `fillActivePool()` 补一道新题 → 若未达标则继续出题
- `roundGoal` 在轮次开始时从设置里取快照，**中途改设置不影响本轮**

### 4.3 单卡流转

```
未学习 ──进入活动池──▶ 学习中
学习中 ──「知道」──▶ streak + 1；streak ≥ N 时：进入复习中（level=1，nextDue=明天）
学习中 ──「忘记」──▶ streak = 0，排到队尾本轮继续
```

- 连对够 N 的卡在**提交时**就离开 `activePool` 并写入 `state: "reviewing"`；`advanceQuestionFlow()` 里 `activePool.find()` 找不到即视为「已学会」，走毕业处理（只走一次）
- 答案页若选了「知道」，可以点「记错了」把这张**改判为答错**（一步到位，无二次确认）

### 4.4 可中断续学

- `roundMastered` / `roundGoal` 与 `activePool` 都落盘
- 学到一半退出（切题库 / 关页面 / 点「结束本轮」）：下次点「学习新的题目」时，只要**活动池里还有没学完的卡**（`hasOngoingRound`）就**接着这一轮继续**——哪怕这一轮一张都还没掌握（`roundMastered === 0` 也续轮，判据是池子而不是计数）
- 只有池子真的空了才清零 `roundMastered`、重新开一轮
- **「学习中」的卡不会掉队**：`fillActivePool()` 的候选包含「有 `learning` 进度但不在池子里」的卡（收回来时把 `progress.streak` 接回池子条目的 `consecutiveCorrect`），首页「学习」入口的可点击性按 `learnableCount`（未学习 + 学习中）算
- **去复习不会顶掉学习池**：复习轮要拿 `activePool` 当到期队列用，所以 `startReview()` 先把学习池**原样**挪进落盘的 `StoredState.learningPool`（成员与顺序都不动，并立刻保存），复习结束（`exitSession` / `finishSession`）或下次 `startLearning()` 时放回 `activePool`。复习到一半刷新页面也不会丢。读学习池走 `session.learningPool` getter（`learningPool ?? activePool`，另滤掉 `reviewing` / `mastered` 兜底老数据）

---

## 5. 复习模式（`run = "reviewing"`）

### 5.1 选题

- 取所有到期卡：`state === "reviewing"` 且 `startOfDay(nextDue) <= studyDay(now)`（「今天」按**凌晨 5 点**换日，见 §6.2）
- 再加上**今天还没补完连对的卡**（`memory.retry.targets` 里、且 `retry.day === studyDay(now)`、且仍在 `reviewing` 的那些——它们答错时已经被推到明天，不在到期列表里）
- 全部进入本轮队列，出题洗牌随机

### 5.2 单卡流转

```
复习中 ──「知道」──▶ streak + 1；streak ≥ 本轮目标（默认 1）→ 本轮完成
        └─ 本轮没失败过 → level + 1，nextDue = 今天 + 2^(level-1) 天，streak = 0
复习中 ──「忘记」──▶ 掌握阶梯归零：level = 1，nextDue = 明天，lapses + 1
        └─ 同时：本轮目标提到 N，streak = 0 —— 这张必须在本轮内重新连对 N 次才算复习完成
        └─ 并且立即计入「今日已复习」（进度条变绿）
        └─ 待办落盘（memory.retry = { day: 今天, targets: { id: N } }）：同一天内退出 / 刷新后
           重新进复习，这张卡仍会被排进本轮（连对次数从 0 重新数）；跨过凌晨 5 点自动作废
        └─ 本轮完成时**不再推进阶梯**：保持 level = 1 / 明天，streak 清零，并清掉待办
```

> **答错 vs 答对的间隔必须不同**：一次答对 → `level + 1`（下次两天）；答错后哪怕本轮连对 N 次补回来，
> 阶梯也停在 `level = 1`（下次一天）。「本轮完成」只是这一轮过了，不代表掌握。

- **默认答对一次就过**（本轮目标 = 1）
- **答错后目标变成 N**（默认 3）：这张卡留在本轮里反复出现，直到连续答对 N 次；中途再答错则连对清零重新数
- 本轮完成后才推进阶梯：`level + 1`，间隔 `2^(level-1)` 天（1、2、4、8、16…，单级封顶 365 天）
- `level > M`（掌握阈值）→ `state = "mastered"`，`level` / `streak` 清零，**之后任何队列都不会再出现**

### 5.3 复习进度条

- `reviewTotal` = 本轮队列总数（今天到期的 + 待补连对的）；每过一题 `markReviewed(id)` 记入 `reviewedIds`
- 进度条按「已过 / 总数」显示，过的格子变绿
- 已过的卡 `nextDue` 已推到将来，所以**明天（或今天稍后重进）不会再出现在到期列表里** —— 复习进度因此是隐式持久化的

---

## 6. 状态机总览

```
                 学习模式                          复习模式
未学习 ──────────────────────▶ 学习中 ──────▶ 复习中 ──────▶ 已掌握
                  连对 N 次              走完 M 次复习
                                ▲                │
                                └── 答错只把 level 归零，不回退到「学习中」
```

- 复习失败**不会**退回「学习中」，而是留在「复习中」、`level = 1`、明天重来
- 学习失败只清零 `streak`（不回退「未学习」）
- 「已掌握」是终态

### 6.1 复习间隔曲线

| level | 1 | 2 | 3 | 4 | 5 | 6 | 7 |
|---|---|---|---|---|---|---|---|
| 间隔（天） | 1 | 2 | 4 | 8 | 16 | 32 | 64 |

- 默认 `graduateLevel = 7` → 第 7 次复习隔 64 天，整条曲线累计 127 天
- 间隔 = `min(365, 2^(level-1))`

### 6.2 「今天」的边界：凌晨 5 点换日

- `MEMORY_DAY_START_HOUR = 5`：**凌晨 5 点前都算前一天，5 点后才算次日**
- `studyDay(timestamp)` 返回该时刻属于哪一天的日期锚点。返回值仍是当天 **0 点**的时间戳，只是按 5 点切换归属——于是 `nextDue` 继续表示「到期日期」，老数据（同样是 0 点）无需迁移
- 所有到期计算都走它：`isDue` = `startOfDay(nextDue) <= studyDay(now)`；`overdueDays` = `diffDays(nextDue, studyDay(now))`；排下次复习 = `addDays(studyDay(now), 间隔)`。UI 的「今天 / 明天 / N 天后 / 逾期 N 天」也用 `studyDay(session.now)`
- 推论（有意为之，等同 Anki 的「次日开始时间」）：**凌晨 2 点学出来的卡，凌晨 5 点就到期**——2 点仍算「昨天」，它的「明天」就是从 5 点开始的那一天
- 只影响记忆模式的到期判断，刷题模式的日期逻辑未改动

---

## 7. 交互与 UI

### 7.1 首页（`MemoryHome`）

- 顶部：题库名大字
- 两个入口，各有 **3 种状态**（共 6 种），靠 `newCount` / `dueCount` / `reviewingCount` + `lastFinishedRun` 区分：

| 入口 | 状态 | 可点击 | 文案 |
|---|---|---|---|
| 学习新的题目 | 待学习（`newCount > 0`） | ✅ | 还有 N 张没学过 |
| | 今天已学完（`newCount === 0` 且刚学完） | ❌ | 今天已经学习完 |
| | 本来没有要学的 | ❌ | 没有需要学习的卡片 |
| 复习 | 待复习（`reviewableCount > 0`，= 到期 + 待补连对） | ✅ | 今天有 N 张待复习 |
| | 今日已复习完（没有要复习的，但还有复习中的卡） | ❌ | 今日已复习完 |
| | 本来没有到期的 | ❌ | 没有到期的卡片 |

- 颜色走 shadcn `Button` variant：可点击 `variant="default"`（黑底白字），不可点击 `variant="ghost"` + `disabled`
- 下方三张统计卡（首页与总览共用）：**未学习 / 学习中 / 复习中 / 已掌握**（四类相加 = 总数）、今日待复习（到期的 + 待补连对）、目前（学习中 + 复习中）

### 7.2 答题区（`MemoryQuestionArea`）

版式与单选题 `QuestionArea` 完全一致，只是**没有选项**：

- 题干页：题型图标 + 题号 + 复制按钮 + 连对指示器（`StreakIndicator`，传 `readonly`：只展示连对进度，**没有**刷题模式那个「双击标记为已掌握」）+ **大字号题干**（`text-2xl sm:text-3xl`）+ 底部「不知道 / 知道」
- 点「知道」或「忘记」后只做两件事：题干回到常规字号（`text-lg`，**无 transition**，避免换卡时看起来像「从小放大」）+ 展示答案
- 答案页：常规字号题干 + 答案卡片（多段按段落渲染、带段间距、不显示「答案」标签）+ 底部「下一题」，若选了「知道」再多一个「记错了」

### 7.3 进度条

- 学习模式：本轮进度，左 = 已掌握数，**中 = `3-5`**，右 = 目标数（题库里的新卡不够时会提前收尾，文案是「这一轮学完了」，不是成功提示）
- 复习模式：左 = 已复习数，中 = 百分比，右 = 今日总数；固定小尺寸，只有绿/灰两色

### 7.4 总览（`MemoryOverview`）

- 三张统计卡 + 卡片热力图 + 筛选栏 + 卡片列表
- **卡片热力图**：未学习 / 学习中 = 灰；复习中 = 橙→绿按 `(level-1)/M` 插值；已掌握 = 绿。点小方块滚到对应卡片
- **筛选栏**：学习进度（已掌握 / 学习中 / 未学习）+ 复习进度（今天复习 / 明天复习 / 近期复习 / 以后复习）+ 搜索（编号 / 题干 / 答案）；复习中的卡片不受「学习进度」这一组影响
- **列表每行**：题干 + 复制按钮 + 一句话状态 + 题号
  - 状态只有一句话：`未学习` / `学习中` / `已掌握`；复习中直接写 `今天复习` / `明天复习` / `N 天后复习` / `逾期 N 天`
  - 不放连对圆点指示器

### 7.5 设置（`MemorySettings`）

学习模式：目标每轮学习数（`roundTarget`）/ 连续正确次数 N
学习顺序：复用刷题模式的 `QuestionOrder` 组件
掌握阈值 M：官方 shadcn `Slider`
进度备份：导出 / 导入（复用刷题模式的编解码）
快捷键说明 + 重置记忆模式进度
（仅 dev）「时间修改」调试控件：`+` 按钮把「今天」往后推一天

### 7.6 键盘快捷键

| 场景 | 按键 | 动作 |
|---|---|---|
| 题干页 | `Space` / `Enter` | 知道 |
| 题干页 | `M` / `;` | 忘记 |
| 答案页 | `Space` / `Enter` | 下一题 |
| 答案页 | `M` / `;` | 记错了 |
| 全局 | `Esc` | 结束本轮 |
| 全局 | `⌘/Ctrl + C` | 复制当前题目 |
| 全局 | `⌘/Ctrl + W` / `E` | 导入 / 导出进度 |
| 全局 | `⌘/Ctrl + I` / `O` | 设置 / 总览 |

题目级快捷键统一从题型注册表 `getKeyboardAction` 分发（与刷题模式同一机制）。

### 7.7 答案排版约定

- `answer` 里**一个换行符 `\n` = 一个段落**
- 渲染层负责段间距（答题页 `my-3 first:mt-0 last:mb-0`，总览 `my-2 ...`）
- LLM Prompt 要求用单个 `\n` 分段；不支持 Markdown 列表 / 标题 / 加粗

---

## 8. 进度备份（导出 / 导入）

`FORMAT_VERSION = 9`，紧凑数组 → JSON → deflate-raw → base64url，格式 `{hash}.{payload}`。

```
刷题：[version, questionCount, masteredBitmapHex, activePool[][], currentRound,
      filterTypeCode, settings[], ui[], masteredMistakesBitmapHex]        // 9 项

记忆：[version, questionCount, "", [], currentRound, 0, settings[], ui[], "",
      memoryPayload]                                                      // 10 项
      memoryPayload = [
        progress[][],          // 每项 [questionIndex, stateCode(0/1/2), level, streak, nextDue, lapses]
        memorySettings[],      // [graduateLevel, roundTarget]
        trailing[]             // 预留
      ]
```

- 解码端按数组长度 9 / 10 区分模式；`MIN_SUPPORTED_FORMAT_VERSION = 4`，保留 v4–v9 解码分支
- 记忆模式的刷题字段填空值（`masteredBitmap = ""`、`activePool = []`、`filterTypeCode = 0`）
- **只要 `state.memory` 存在就走记忆分支**（一张卡都没学过的记忆题库也算，否则 `graduateLevel` / `roundTarget` 会在导入时被重置成默认值）
- `roundMastered` / `roundGoal` / `learningPool` / `memory.retry` **不进备份**（属于「本轮」这种短周期状态）；导入后本轮从 0 重新开始

---

## 9. 关键文件

```
src/types.ts                                MemoryQuestion / MemoryProgress / MemoryBankSettings / StoredState.memory
src/quiz/types/memory/                      logic.ts（校验 / 判分 / 快捷键）、Input.svelte（答案卡片）、Review.svelte、paragraphs.ts
src/quiz/types/registry-logic.ts            QUIZ_QUESTION_TYPES_LOGIC（刷题四型）/ QUESTION_TYPES_LOGIC（含 memory）
src/quiz/modes/memory.ts                    validateQuestions + buildMemoryOverview
src/lib/validateQuestions.ts                validateQuizQuestions / validateMemoryQuestions
src/features/memory/MemorySession.svelte.ts 会话层（学习流 / 复习流 / 活动池 / 进度条数据）
src/features/memory/algorithm.ts            间隔曲线、状态流转纯函数
src/features/memory/settings.ts             设置默认值与净化
src/features/memory/normalize.ts            进度净化
src/features/memory/filters.ts              总览筛选口径
src/features/memory/keyboard.ts             窗口级快捷键的守卫判定（可单测）
src/features/memory/devClock.ts             仅调试：时间快进
src/components/memory/MemoryView.svelte     容器（版面与 QuizView 一致 + 窗口级快捷键）
src/components/memory/MemoryHome.svelte     首页 6 种状态
src/components/memory/MemoryQuestionArea.svelte  答题区
src/components/memory/MemoryProgressBar.svelte   进度条
src/components/memory/MemoryStatsCards.svelte    三张统计卡（首页/总览共用）
src/components/memory/MemoryOverview.svelte      总览
src/components/memory/MemoryHeatmapSection.svelte 热力图
src/components/memory/MemoryFilterBar.svelte      筛选栏
src/components/settings/MemorySettings.svelte     设置面板
assets/prompts/memory.md                    给 LLM 的生成 Prompt
```

---

## 10. 已知取舍 / 请重点审查的点

> 2026-02 复审后的状态：第 1、2、4、5、6、7、8 条已逐条核对并修掉了发现的缺口（详见各条后的「已核对」）。
> 本轮修复：答错后的「重新连对」落盘（`memory.retry`，仅当天有效）、`reset()` / `startImport()` 清零本轮计数、
> 记忆题库零进度也走记忆导出分支、`MemoryView` 键盘补回刷题模式那套守卫、`advanceQuestionFlow()` 里的进度变更立即落盘、
> 连对指示器改 `readonly`（去掉没有实现的「标记为已掌握」）。

1. **轮内连对 vs 掌握阶梯** 是否被正确分离？特别是：
   - 复习答错后「本轮目标 = N」但「阶梯归零」两件事互不干扰
   - 本轮连对达标才推进阶梯（而不是每次答对都推进）
   - **已核对**：分离正确。答错后的「本轮还要连对 N 次」现在会落盘（`memory.retry`），当天内退出再进来仍然生效；跨过凌晨 5 点作废，卡片按常规的「明天到期、答对一次即过」走。
2. **学习模式毕业判定**依赖「卡片在 `submit()` 阶段就离开 `activePool`」，所以 `advanceQuestionFlow()` 里 `find()` 不到就视为已学会；有没有重复计数 / 漏计数的路径？
   - **已核对**：未发现重复计数或漏计。前提是「队列 ⊆ 池子」这个不变量成立——它唯一的破坏者是连对指示器上的「标记为已掌握」（接的是 `skipCurrent()`，只把卡从队列里丢掉、不写进度），现已改成 `readonly` 去掉该入口。
3. **活动池补题时机**：毕业时才补题，所以池子容量 = `roundTarget` 张；如果题库剩余不足会不会卡住？本轮结束（`roundTarget` 达标）时池子保留没学完的卡、下一轮接着用。
   - 剩余不足不会卡住：本轮会提前收尾，但收尾提示是绿色的「本轮学习完成 / 已掌握 X / Y」（X < Y），措辞仍待打磨。
4. **续轮语义**（已定）：判据是「活动池里还有没有没学完的卡」——`roundMastered === 0` 也续轮，不再重置本轮计数。
   - **已核对**：`reset()`（重置记忆进度）与 `startImport()`（导入进度备份）现在都会把 `roundMastered` / `roundGoal` 清零，不会再出现「重置后带着旧计数开新轮」。
5. **复习进度是隐式的**（靠 `nextDue` 推后 + `reviewTarget` 在内存），同一天内反复进出复习，进度条会不会失真？`reviewTotal` 只在本会话有效。
   - **已核对**：`reviewTotal` 仍是「本会话的队列总数」，但队列本身现在包含当天未补完连对的卡，所以退出再进来分母与待办一致；答错卡立即变绿仍是刻意行为。
6. **时间处理**：「今天」按**凌晨 5 点**换日（§6.2）：`studyDay(now)` 决定当前学习日，`nextDue` 仍是当天 0 点的日期锚点，`isDue` 比较 `startOfDay(nextDue) <= studyDay(now)`。跨时区 / 夏令时 / 用户改系统时间有没有问题？
   - **已核对**：`studyDay` / `isDue` / `overdueDays` / `addDays` / `diffDays` 自洽，`diffDays` 的 `Math.round` 正好抵消夏令时的 23/25 小时日。两点遗留：`nextDue` 没有上限校验（手工构造的 `1e30` 会渲染成「NaN 天后复习」）；`now` 不是响应式的，跨过凌晨 5 点时已打开的首页数字要等下一次状态变化才刷新。
7. **复习间隔语义**：本轮没失败过时，完成本轮才推进一级（`level + 1`）；本轮失败过的卡完成时**不推进**，停在 `level = 1`（明天）。这样「答错 → 明天（1 天）」与「答对 → 两天」才真正区分开。
   - **已核对**：行为正确，且有测试锁定；重新进入复习时带待办的卡会被重新标记为「本轮失败过」，所以补完连对同样不会推进阶梯。
8. **导入导出**：记忆模式 v9 payload 与刷题共用前 9 项；`roundMastered` / `roundGoal` / `learningPool` 都不进备份，恢复到另一台设备时本轮会重开（池子按 `learning` 进度的卡重新收回来）——是否可接受？
   - **已核对并修正**：判据从「`progress` 非空」改成「有 `memory` 段」，否则一张卡都没学过的记忆题库会掉进刷题分支、`graduateLevel` / `roundTarget` 静默丢失；导入后本轮计数确实从 0 重开。
9. **边界**：`graduateLevel` 上限 10 时间隔封顶 365 天；`roundTarget` 大于剩余未学习题数时本轮无法完成。
   - **已核对**：题库的新卡不够时本轮会提前收尾，文案不再谎报成功（「这一轮学完了 · 已掌握 X / Y」且无成功音效）；是否要在设置里提示「本轮目标大于剩余卡片数」仍未做。
10. **调试代码**：`devClock.ts` + `MemorySession.debug*` + 设置里的「时间修改」是临时功能，删除方式已在注释里标注（只影响这三处）。
    - 注意：`devClock.ts` 头部注释里的删除步骤已过时（要还原的那行 `this.now = options.now ?? (() => Date.now())` 现在不存在了）。
