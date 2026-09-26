# AGENTS.md

This file provides guidance to coding agents working in this repository.

## Project Overview

中文题库刷题应用，基于间隔重复算法。Svelte 5 + Vite + TypeScript。

应用是单一形态：浏览器内导入 / 管理多份题库，题库与学习进度存在 localStorage，**没有**编译期打包题库的构建模式。

题库模式（bank mode）：

- `quiz` — **刷题模式**。题目带 `type` / `options` / `answer`，参与间隔重复算法。
- `memory` — **记忆模式**，已实现。题目是第五种题型 `type: "memory"`（只有题干和答案），用户自评「知道 / 模糊 / 忘记」。两个入口：
  - 「学习新的题目」：活动题目池里练题，连对 N 次算学会并补一道新题进来；一轮掌握 `roundTarget`（默认 5）题就结束，可中断续学
  - 「复习」：按 1/2/4/8… 天翻倍间隔复习，默认答对一次过；答「忘记」→ 阶梯归零、答「模糊」→ 阶梯退一级，两者本轮都要重新连对 N 次才算复习完；走完 M（`graduateLevel`）次变已掌握
  详见「记忆模式（memory）」章节。

题型：`judgment` / `single` / `multiple` / `blank`（刷题模式四型）+ `memory`（记忆模式）。
记忆题型与另外四种走同一套注册表和 UI 机制，只是不参与刷题模式的题型筛选与总览分组。

## Commands

```bash
pnpm dev                       # 开发服务器
pnpm build                     # → dist/index.html + assets
pnpm preview                   # 预览最近一次构建
pnpm check                     # svelte-check --tsconfig ./tsconfig.json
pnpm test                      # vitest run
pnpm test:watch                # vitest watch
pnpm verify                    # check + test + build
```

跑单个测试：`pnpm vitest run tests/answerMatcher.test.ts -t '<name>'`。

## 架构

### 数据流

用户在 UI 导入题库 → `BankStore.importBank` → `parseBankFileJson` 解析并校验 → 计算 `hash` → 写入 localStorage → UI 订阅刷新。

```
src/lib/bankFile.ts       统一解析 { mode?, state?, questions }
  └─ src/quiz/modes/      按 mode 分发校验（quiz / memory 均已实现）
src/source/bankStore.ts   BankStore：维护 general 配置里的 library + activeBank
src/generalConfig.ts      general 配置读写（含旧版拆分键的一次性迁移）
```

### 关键模块

- `src/types.ts` — 核心类型：`BankMode`、`Question`、`MemoryQuestion`、`BankSettings`、`MemoryBankSettings`、`GlobalSettings`、`StoredState`、`MemoryStoredState`、`MemoryProgress`、`RuntimeState`
- `src/config/` — **跨模块的全局调参只放这里**：时长（`ui.ts`）、断点与层级（`layout.ts`）、
  存储键（`storage.ts`）、同步间隔（`sync.ts`）、快捷键注册表（`shortcuts.ts`）、算法与匹配默认值。
  判据是「改动它会不会影响多处 / 别人要不要知道它的存在」；只服务一个模块的实现细节
  （Gist 文件名、虚拟列表的估算行高）留在原模块，不要搬进来。详见 `config/index.ts` 开头的说明
- `src/features/appShortcuts.ts` — **两个模式共用的窗口级键盘分发**（`createAppKeyboardHandler`）。
  应用级按键读 `@/config/shortcuts` 的注册表（`Record<ShortcutId, …>`，少写一个 id 编译不过），
  题目级按键走题型注册表；某个模式独有的能力（活动池 / 本轮会话 / 答案页降级）声明成可选成员，
  宿主没实现就自然跳过。**新增快捷键只改注册表 + 这一个分发表**，两个模式一起生效。
  例外是**跟会话无关**的应用级键（⌘⇧I 全局设置、⌘Y 同步）：它们的宿主在没有题库时也挂载，
  所以各有自己的窗口监听，在这张表里写 `null` 并**从 `MOD_KEY_TO_ID` 排除**
  （不排除会在题目级分发之前先占掉那个字母）
- `src/generalConfig.ts` — general 配置：`{ activeBank, defaultSettings, library, globalSettings }`
- `src/bankSettings.ts` / `src/globalSettings.ts` — 两层设置的默认值与净化（`sanitizeBankSettings` / `sanitizeGlobalSettings`）
- `src/lib/bankFile.ts` — 题库文件统一解析 / 序列化：`parseBankFileJson` / `parseBankFile` / `formatBankFile`
- `src/lib/validateQuestions.ts` — 刷题模式 `questions` 数组的校验（`validateQuizQuestions`）
- `src/quiz/modes/` — 题库模式注册表
  - `types.ts`：`BankModeDef`（`validateQuestions` + `buildOverview`）
  - `quiz.ts`：刷题模式实现（`buildOverview` 返回 `null`，沿用 `ReviewView` 的「按题型分组」）；`memory.ts`：记忆模式实现（校验走 `validateMemoryQuestions`，`buildOverview` 同样返回 `null`——总览由 `MemoryOverview.svelte` 自己渲染）；`index.ts`：`BANK_MODES`
- `src/quiz/types/` — 题型注册表（新增 `memory/` 题型）
  - `registry-logic.ts`：`QUIZ_QUESTION_TYPES_LOGIC`（刷题四型）、`QUESTION_TYPES_LOGIC`（含 memory）、`QUESTION_TYPE_ORDER`（只列刷题四型，供筛选 / 分组）
  - `memory/`：`logic.ts`（校验 + 判分（只有「知道」算答对）+ 三选自评编码 `MEMORY_ANSWER_CODE` + 答案页降级矩阵 `memoryAnswerDowngrades` + 快捷键：`Space`·`Enter` 知道 / `'` 模糊 / `;` 忘记）、`Input.svelte`（答案卡片）、`Review.svelte`（总览里的答案展示）、`index.ts`
  - `src/lib/validateQuestions.ts`：通用校验（`validateQuestionsWithType`）+ `validateQuizQuestions` / `validateMemoryQuestions`（记忆模式允许省略 `type`，统一补成 `"memory"`）
- `src/features/memory/` — 记忆模式的算法、会话与设置
  - `algorithm.ts`：纯算法与常量（`memoryIntervalDays` 的 2^(level-1) 天曲线、`advanceReview` / `resetReview` / `reviewProgress` / `isDue`、默认值与边界）
  - `MemorySession.svelte.ts`：会话层，骨架与 `QuizSession` 一致（`appState: RuntimeState` + `currentQuestion` / `showResult` / `isCorrect` / `selectedAnswers` / `submit()` / `advanceQuestionFlow()`），额外持有记忆模式自己的 `run` / `progress` / `memorySettings`；两条流见「记忆模式（memory）」章节
  - `settings.ts`：`MemoryBankSettings` 默认值与净化（`createDefaultMemorySettings` / `sanitizeMemorySettings` / `MEMORY_SETTINGS_BOUNDS`）
  - `normalize.ts`：`StoredState.memory` 的净化（`normalizeMemoryState` / `normalizeMemoryProgressMap` / `normalizeMemoryRetry`）
  - 窗口级快捷键**不再有记忆模式专属实现**：刷题与记忆共用 `src/features/appShortcuts.ts`
    （见「键盘 / 快捷键」一节）。记忆模式只提供能力（`isSessionActive` / `exitSession` / `markAsWrong` / `markAsFuzzy`）
  - `context.ts`：`provideMemorySession` / `useMemorySession`
- `src/source/` — 题库仓库
  - `bankStore.ts`：`BankStore`（唯一 `QuizSource` 实现），维护 general 配置里的 library / activeBank，负责 import / export / rename / remove / moveToTop
  - `types.ts`：`QuizBank` / `MemoryBank` / `Bank`（判别联合）、`BankSummary`（含 `mode`）、`QuizSource`
  - `context.ts`：`provideQuizSource` / `useQuizSource`
- `src/store.ts` — **每个题库**的状态读写（按 `hash` 分 key）：`StoredState` 加载 / 保存 / 重置；`saveState` 原样携带 `memory` 段。`buildRuntimeState` 会丢掉题库里已不存在的 `activePool` / `learningPool` / `memory.progress` 条目（以及这些题的 `memory.retry` 待办）——统计与导出都只认题库里真实存在的卡
- `src/features/importExport.ts` — 进度编码：`{hash}.{base64url-deflate}`，`exportProgress` / `importProgress`。只依赖题目 `id`（`ProgressQuestion`），刷题 / 记忆模式通用；`FORMAT_VERSION = 9` 起记忆模式走第 10 个元素，记忆设置数组的**第 3 项**是 `lockRoundPool`（后加的，老备份那里是预留位 → 读不到就按关处理，所以没升版本号）
- `src/algorithm.ts` — 纯算法：加权随机选题、`processAnswer`、`computeLearningSegments`
- `src/features/quiz/` — UI 与算法之间的胶水层（`runtime.ts`、`answer.ts`、`answerMatcher.ts`、`filters.ts`、`settings.ts` …）
- `src/features/bankFiles.ts` — 文件 / 剪贴板导入会话（`BankImportSession`）与导出（`exportBank`）
- `src/features/bankPrompts.ts` — 各模式「给 LLM 的生成题库 Prompt」（quiz + memory，`BANK_PROMPTS`）
- `src/features/globalSettings.svelte.ts` — **全局设置的响应式单例**（`globalSettingsStore`）。跨题库、无 activeBank 也可读写；变更经 `persist()` 写回 general 配置
- `src/features/globalSettingsDialog.svelte.ts` — **全局设置对话框的开关**（`globalSettingsDialog.open / show() / close()`）。
  三个入口分属不同的组件树分支（侧边栏左下角的按钮、页头那颗变红的同步指示点、⌘⇧I），
  所以开关不能留在某个组件里；对话框本身仍由 `Sidebar.svelte` 渲染（`bind:open={globalSettingsDialog.open}`）
- `src/features/globalSettingsShortcut.ts` — **⌘⇧I（Ctrl+Shift+I）打开全局设置**（`isGlobalSettingsShortcut` / `handleGlobalSettingsShortcut`）。
  应用级：跟具体题库无关，窗口监听挂在 `Sidebar.svelte` 的 `<svelte:window onkeydown>` 上（它始终挂载，且已经持有对话框开关）；
  焦点在对话框里时不吃这次按键，免得在题库设置上面再叠一个全局设置。与 `SHORTCUTS.toggleSettings`（⌘I = 当前题库设置）只差一个 ⇧，别写混。
  **共用的键盘分发必须先放行它**（`src/features/appShortcuts.ts` 里一行早退）：题目级分发不认修饰键，
  `i` 在第 9 个选项存在时正好是它的字母——拦不住就会顺手选中 I 选项，开着自动提交还会直接提交
- `src/features/sync/` — **云同步**（Gitee Gist，详见「云同步（Gitee Gist）」章节）
  - `types.ts`：常量与类型（存储键、表名、防抖 20 秒 / 轮询 3 分钟、`SyncStatus` / `SyncMeta` / `SyncConfig`）
  - `config.svelte.ts`：`syncConfigStore`（令牌 + Gist ID 的响应式单例，`subscribe()` 供引擎感知总开关）、`sanitizeSyncConfig`（丢弃旧版存储后端的凭据）
  - `target.ts`：`giteeApiBase`（可用 `VITE_GITEE_API_BASE` 指向 mock）、`resolveSyncTarget`、`maskToken`
  - `storage.ts`：`isSyncableKey` 白名单、mtime 记录、同步元数据（`loadSyncMeta` / `saveSyncMeta`）、localStorage 包装（`installStorageHook` / `writeLocal` / `removeLocal`）、**存储健康探针**（`probeStorageHealth`）
  - `payload.ts`：`encodePayload` / `decodePayload`（deflateRaw + base64url，带版本号）
  - `collect.ts`：`collectLocalState`（键 → **逐题库**）、`filesOfState` / `collectLocalFiles`（题库装进分片后的样子）、`bankContentHash`、`stableHash`
  - `merge.ts`：**逐题库**三方合并的纯函数（`buildSyncPlan` / `judgeBank` / `mergeGeneral` / `buildRemoteState` / `applyResolution` / `forcePushPlan` / `forcePullPlan`），重点测试对象
  - `gitee.ts`：Gitee Gists API 客户端（`GiteeClient` 的 `createGist` / `getGist` / `listGists` / `updateFiles` / `deleteFiles` / `deleteGist` / `ping`）+ `GistSummary` + `describeHttpError`
  - `engine.svelte.ts`：`syncEngine` 单例（打开页面即对账 / 防抖上传 20 秒 / 焦点与轮询检查 / 冲突状态机 / 拉取后刷新）
  - `src/features/toast.svelte.ts`：**全局提示**的单例（`toastStore`）。整个应用只在
    `App.svelte` 里渲染一份 `<AlertToast>`：以前每个视图各挂一份，同一个提示可能弹好几次，
    挂在设置弹窗里的那份还会被 Dialog 的层级 / `overflow-hidden` 夹住、关掉弹窗就跟着没了。
    谁都可以 `toastStore.show(标题, 说明?, 变体?)`；悬停暂停由 `<AlertToast>` 调 `hold/release`。
  - `src/lib/time.ts`：`formatRelativeTime`（「20 秒前」）/ `formatAbsoluteTime`（title 用）/
    `formatShortDate`。相对时间由调用方把 `now` 传进来，跟着页面的心跳刷新。
  - `src/lib/identicon.ts`：DiceBear 头像的**唯一入口**，动态加载（见「首屏体积」那节）
  - `summary.ts`：`describeSyncResult()`——把一轮同步说成人话（新增 / 删除 / 上传 / 下载 + 设置），状态行与 Toast 共用这一份文案
  - `shortcut.ts`：**⌘Y（Ctrl+Y）立即同步**（`isSyncNowShortcut` / `handleSyncNowShortcut`）——**等价于点页头那颗同步指示点**。
    窗口监听挂在 `AppShell.svelte` 上（指示点住在那儿，而且空题库状态也挂载——新设备打开正是为了拉云端题库），
    **不进** `features/appShortcuts.ts` 的分发表（那张表的宿主「答题视图」在没有题库时根本不挂载）。
    **云同步关掉时这个键一起消失**（那时指示点也没了）：⌘Y 完全不碰，留给浏览器；红点（冲突 / 报错）时它跟点击
    一样是**打开全局设置**——所以宿主传的 `run` 就是指示点那个 `onClick`，这套规则不写第二遍
- `src/components/settings/SyncSettings.svelte` — 全局设置面板底部的同步区块，常规态分两段：
  **信息展示**（「目标仓库」卡片：identicon + Gist id + 上次同步时间 / 出错原因 + 本地题库数 · 本地大小 · 云端题库数）
  与**操作**（打码令牌 + 测试连接 + 修改配置、立即同步、「更多设置」里的自动同步与双向覆盖、**逐题库的冲突选择**）
  - **编辑态是纯草稿，只有「保存」会落盘**：令牌填在 `draftToken` 里，测试连接走
    `syncEngine.testConnection(draftToken)`（引擎那侧也**不写配置、不写状态**），
    取消或直接刷新页面什么都不生效。这是踩过的坑：以前「测试连接」会先
    `update({ token })` 再试，于是没点保存令牌也被换掉了。
  - **保存配置后立刻 `syncNow()`**：选新建就马上把 Gist 建出来并回填 id，
    选已有的就马上把云端拉下来。否则面板会一直停在「第一次同步时新建」。
  - **「换一条云端」只有一条路：铅笔图标（修改配置）**。它进编辑态之后会
    **自动跑一次「测试连接」**（`startEditing()` 末尾的 `if (draftValid) testConnection()`），
    成功后列出候选片段；不再有单独的「切换目标 Gists」按钮，也不再有只读令牌那种模式。
  - **「测试连接」按钮自己就是回执**（两个模式都是）：失败 → `destructive`（红）+
    一条**全局**提示写清原因；成功 → 图标换成绿色的 `IconRosetteDiscountCheckFilled`，
    **不弹提示**。区别只在「绿勾留多久」：
    - 编辑态：一直留着（`data-state="ok"`），直到改令牌 / 保存 / 取消；
    - 展示页：只亮 `VERIFIED_FLASH_MS`（2 秒）就变回云朵勾——那个按钮平时只是个入口，
      不需要一直挂着一个「已完成」的状态（`data-state="verified"` → 变回 `"ok"`）。
    两个按钮都带 `data-state`（`idle` / `ok` / `error` / `verified`）：测试靠它判断状态
    ——展示页成功时**类名不变**，只看类名是看不出来的。
  - **文案规矩（踩过很多次）**：
    - **面板里不写解释**。卡片只放结构化事实（目标是谁、上次同步何时、两边多少题库）；
      出错交给**通知**（全局 toast）+ 页头那颗红点（tooltip 里带原因）。
      把「云端那条 Gist 不见了（被删了，或令牌换了账号）。在设置里点……」这种句子
      写进面板，就是贴狗皮膏药——用户不会读，还挡住真正有用的信息。
      目标被删的表现是：那条 id **加删除线** + 旁边一个「（已被删除）」（`targetMissing`）。
    - **一句能说清就别写两句**：`status.message` 一律控制在十几个字以内，
      `describeSyncResult` 只列非零项；确认按钮的 title 也只写「再次点击以删除（不可恢复）」这种。
    - **语体是官方书面语，不是口语**：写「连接 Gitee 失败」不写「连不上 Gitee」；
      写「停手 20 秒」→「停止编辑 20 秒后自动上传」。凡是带「一下 / 别 / 搞定 / 就没了」
      的，都改成陈述句。
    - **说明抽屉可以长，UI 不行**：`SyncGuideDrawer.svelte` 是**说明书**——成段文字、
      讲清为什么，都放那儿（面板里一个字都不多写）。它按「做什么 / 配置 / 同步了什么 /
      什么时候同步 / 冲突与覆盖 / 换一条云端 / 清空配置 / 常见疑问」分节，语句连贯，
      只有配置步骤按 1、2、3 列。
  - **两种「测试连接」不是一回事**（踩过：目标被删之后用户改不了配置，钥匙锁在门里）：
    - 展示模式（不传草稿）＝ 令牌 **+ 当前目标仓库**都在不在；
    - 编辑模式（传草稿令牌）＝ **只验令牌**（`ensureTarget({ token, gistId: "" })`，走列表接口）。
      编辑态绝不能带上旧 gistId：目标被删时用户正是要换一条，否则会卡在
      「测试不通过 → 选不了新的 → 存不了」。草稿自检也不许改 `targetMissing`
      （它压根没看目标）——那两行守卫在 `testConnection` 里，别顺手合并掉。
  - **`status.lastSyncAt` ≠ `status.at`**：`at` 是「最近一次操作完成」，自检 / 对账都会写它；
    `lastSyncAt` 只在**真的同步**（`finishStatus`）时更新，卡片上的「上次同步」只认它。
    线上疑问「点一下测试连接，上次同步就跳到刚刚，是不是偷偷同步了」就是这两者混用的结果——
    自检只**读**云端（外加回填 `gistUrl`），一个字节都不写。`init()` 会先把盘上
    `quiz_app_sync_meta.lastSyncedAt` 读进来，所以重开页面也能立刻显示真实的上次同步时间。
  - **「上次同步」是相对时间**（下面这条）（`$lib/time.ts` 的 `formatRelativeTime`）：卡片里那个
    `now` 每秒走一下（`setInterval`，面板只在弹窗打开时挂载，代价可以忽略），
    hover 的 `title` 给绝对时间（`formatAbsoluteTime`）。
  - **面板底下不再有状态小字**：`题库没有改动 · 09/15 10:41` 那行连同数据量一起取消了，
    需要知道的都在「目标仓库」卡片里（`localBankCount` / `localBytes` 由
    `collectLocalState()` 一次算出来）。卡片第二行平时是「上次同步 …」，
    **出错 / 离线时换成 `status.message`**——否则报错就只剩页头那颗红点，面板上看不到原因。
    编辑态的自检结果仍然只在编辑区那个 `[data-slot="sync-check-result"]` 里，
    两条信息两个 DOM，不会互相漏。
  - **保存按钮的可用性 = `verified`**（`checkResult.ok && gists !== null`）：
    首次配置（`firstEdit`）验过之前**按钮都不出现**（那时也没有列表可挑）；
    再次编辑时按钮一直在，但验过之前是灰的，**改一下令牌立刻又变灰**（列表一起收起来）。
    自检与列表都带 `attempted` 令牌做守卫：令牌在请求飞行途中变了，这份结果直接作废。
  - **「清空配置」（在编辑态里）**：`syncEngine.clearSyncState()` +
    `syncConfigStore.clear()`——**连 `localStorage` 的键一起删**（只写一遍空值
    不够：键还在盘上，下次打开仍会读出一份「配过但都是空的」记录），并关掉总开关。
    本地题库与进度不动，Gitee 上那条 Gist 也不会被删。
  - **列表每行右边的垃圾桶**（`ConfirmActionButton` + `tabler:trash-x`，点两下才真删）
    会 `deleteGist()` 整条删掉云端片段。删掉的正好是当前在用的那条时顺手 `forgetGist()`
    断开（留着 id 只会一直报「Gist 不见了」）。**垃圾桶必须待在那行的 `<label>` 外面**：
    在 label 里点任何东西都可能顺带选中这一行，而删片段不该改「同步到哪条」。
  - **面板里的浮层必须抬 z-index**：全局设置是 `Dialog`（`Content` 与遮罩都是 `z-(--z-dialog)`），
    而 `Select.Content` / `Popover.Content` 默认是 `z-50`——直接放进面板里会**渲染在弹窗背后**，
    表现成「下拉点不开」。所以说明抽屉写的是 `class="z-(--z-drawer)"`；
    同理：Tooltip `z-(--z-tooltip)`、Toast `z-(--z-toast)`。
    **层级阶梯只在 `src/app.css` 的 `--z-*` 变量里定义一次**（`@/config/layout` 的 `Z_LAYER`
    是同一份的名字表），组件里不要再写 `z-[60]` 这种裸数字。
  - **Gist 选择器不用浮层**（`SyncSettings.svelte` 里的 `gistOption` snippet）：
    它是一条常驻的单选列表，每项两行（一行标题、一行元信息），行里是原生 `<input type="radio">`
    （方向键能在组内切换，选中/hover 的底色走 `bg-accent`，键盘焦点靠 `focus-within`）。
    行的结构是 `div[data-slot=gist-option]` **里面**才是 `<label>`（radio + 图标 + 文字），
    右边依次是选中勾和垃圾桶——垃圾桶在 label 外，见上一条。
    每行主信息是**片段 id**（等宽），第二行是更新时间；**当前在用的那条**再带上
    「云端 N 个题库」（那个数只有它是现成的）。别的条目要数题库数就得逐条拉内容——
    打开一次列表就是十几个请求，不值当，所以不显示（文件数那种低信息量的也一并去掉了）。
    之所以不用 shadcn 的 `Select`：弹层得在 `overflow-hidden` 的 Dialog 里开，
    既抢 z-index 又被祖先的 `overflow` 裁；条目还是单行 `nowrap`，一条 32 位的 id
    就把弹层撑得比面板还宽，触发器里的字也被硬切掉。没有浮层，就没有层级 / 裁剪 / 宽度这三件事。
- `scripts/gitee-probe.mjs` / `gitee-cors-probe.mjs` / `gitee-limits-probe.mjs` / `gitee-live-check.mjs` — Gitee 接口、限制与「写入是否真落盘」的探针（改接口或撞到新限制时先跑它们）
- `src/components/settings/SyncGuideDrawer.svelte` — 云同步说明抽屉（配置步骤 / 数据范围 / FAQ）。
  从设置面板里的 info 图标打开；`z-(--z-drawer)`（要盖住 Dialog 的 `z-(--z-dialog)`，
  但低于 Toast 的 `z-(--z-toast)`）
- `src/lib/components/ui/drawer/` — shadcn-svelte 的 drawer（vaul-svelte）。**手动装的**：
  registry 里的占位符 `$UTILS$` 要替换成 `$lib/utils`，否则编译不过
- `src/lib/components/AnimatedNumber.svelte` — **会滚的数字的唯一入口**（`value` / `format` / `class`）：
  `{#await preloadNumberFlow()}` + `formatNumberFallback` 的兜底写在这一处，`$lib/numberFlow.ts`
  只管拉包。进度条那三个数字与「掌握阈值」那行文案（`MemorySettings.svelte`）都用它；
  要显示会滚的数字**不要再内联抄一遍 `{#await}`**，否则数字滚动只在抄过的地方有
- 「更多设置」是个自己写的折叠区：`detailsOpen` 决定内容在不在 DOM 里，
  再交给 `transition:slide` 做进出场（试过官方 Collapsible / 原生 `<details>`，
  都没有进出场动画）。展开后**就一行**：`自动同步 [switch] ｜ 覆盖按钮 ×2`，
  自动同步的说明 Tooltip 直接挂在它的 `<Label>` 上（不再单独放一个问号按钮）。
- `src/sound/` — 音效播放器（`createSoundPlayer`）与全局设置驱动的播放判断
- `src/App.svelte` — 根组件。按 `activeBank.mode` 收窄：`quiz` 渲染 `QuizView`，`memory` 渲染 `MemoryView`（用 `{#key bank.hash}` 重建会话）
- `src/components/layout/AppShell.svelte` — 外壳（页头 / 内容区）。页头右侧那颗**云同步指示点**，
  只在云同步开着时出现，三种状态（`tone`）各自一套底色 + 光晕（主题变量）：
  | tone | 条件 | 颜色 | 可点 | 点了干什么 |
  |---|---|---|---|---|
  | `ok` | `syncEngine.inSync` | 绿 `--success` | ✅ | 手动同步一次 |
  | `pending` | 还没同步 / **离线** | 黄 `--warning` | ✅ | 手动同步一次 |
  | `danger` | 有冲突 **或** `phase === "error"` **或** `storageBlocked` | 红 `--destructive` | ✅ | **打开全局设置** |
  - 红色 = 「需要你操心」，所以两类都算：**冲突**要在设置里选保留哪一边，**报错**
    （令牌失效、Gist 被删、限流……）也是在那儿修——这两件事再同步一次都解决不了。
    **离线不算红**：那不是数据问题，联网后下一次同步自己会好，标红只会让人白紧张。
  - 三种 tone 都可点（`clickable = enabled && !syncing`）：**绿也点得动**——已经一致时
    主动同步一次是常见需求（想把云端改动拉下来）。不可点（正在同步）时用
    `aria-disabled` 而不是 `disabled`——后者会让原生 `title` 提示失效；同时 hover
    class 也不会加到 DOM 上。
  - **几何尺寸照搬「Spinner 之前」那一版**（`git show 8f3e809^:src/components/layout/AppShell.svelte`）：
    圆点恒为 `size-1.5`（6px）、光晕是**圆点自己的 `box-shadow`**
    （`shadow-[0_0_6px_var(--tone-color)]`，能点时 hover 加到 12px）、按钮只是
    `size-8` 的命中区域、不吃任何缩放。**改动这一块之前先把那个版本翻出来对一遍**——
    踩过的坑：把光晕挪到按钮的 `::before` 上（`size-1.5` + `blur-[3px]` 的实心圆），
    视觉直径比 `box-shadow` 大一圈，看着就是「指示灯变大了」；给按钮挂 `scale-125`
    同理。**光晕要留在圆点身上**。
  - **跑的过程中不变色，但会呼吸**：`phase === "syncing"` 本身不进 `tone` 的计算，
    而是用 `toneWhileRunning`（`$state` + `$effect`，只在没同步时更新）记住跑之前
    那个颜色，**圆点自己**（不是按钮）套 `animate-breathe`（关键帧在 `app.css`：
    1.4s 明暗 `1 → .3` + 极轻的 `scale 1 → 1.15`）。缩放幅度**故意压得很小**：
    那颗点只有 6px，`scale` 一大就不是呼吸、是「变大了」。否则从绿点一下会先闪
    一下黄再变回绿（那一瞬间的黄来自 `phase === "syncing"`，可黄的意思是
    「有没传上去的改动」），报错后重试期间也会先闪成别的颜色再回到红。
  - **颜色只有一个来源**：按钮上写一个内联变量
    `--tone-color: var(--success|--warning|--destructive)`，圆点底色与光晕都读它
    （`bg-(--tone-color)`、`shadow-[0_0_6px_var(--tone-color)]`）。以前三种状态各写一套
    `bg-success` / `shadow-[0_0_6px_var(--success)]`，加一处颜色要改三处。
    **不要**再为「更亮的同色」加第二个变量（曾经有过 `--tone-flash-color` +
    按亮 / 暗主题各配一遍 `color-mix` 比例）：提亮用 `filter: brightness()` 就够了。
  - **两种「跑完」的收尾不一样**（这是需求里明确的一条）：
    - **自动同步**（打开页面对账 / 防抖上传 / 轮询）：呼吸灯自己亮自己灭，跑完直接是
      那一色，没有额外动作，也不出声
    - **手动点击**（点圆点或 ⌘Y）：呼吸灯跑完还要**亮一下 + 跳一下**——圆点挂
      `animate-wink`（700ms `forwards`，关键帧在 `app.css`）：底色不变，
      靠 `filter: brightness(2)` 提亮、同时 `scale 1 → 1.5 → 1` 弹一下、
      光晕跟着放到 20px。成功失败**都亮**：这是「点过了」的回执，
      落点是什么颜色由那一轮的结果决定（红了就亮红）
    - **成功时再加一声「答对」音效**（`maybePlaySyncSuccessSound` → `playAnswer(true)`，
      也就是答题时答对的那一个 `answer-correct.webm`，**不是**「一轮学完」的
      `success` 音）：音效开关关着就只亮不响；失败 / 冲突时同样只亮不响——
      那会儿响「答对」是说反话。音效开关读 `globalSettingsStore`（同步跟具体题库无关，
      指示点也不属于任何 session，所以在 AppShell 里自己 `createSoundPlayer()`）
    - **缩放只能写在关键帧里**：动画一跑 `transform` 整条归关键帧管，同一元素上的
      `scale-*` class 会被按住不动，所以别用「加个 `scale-110` class」来实现这一跳
      （`syncIndicator.test.ts` 直接读 `app.css` 把这条钉住了），
      静止尺寸也因此仍是 `size-1.5`——放大只发生在动画中间那一帧
    - **关键帧的首末帧不要写 `filter: brightness(1)`**：cssnano 会把它压成
      `brightness()`（空参数，非法），整条声明被丢掉，动画就完全不亮——而且源码
      看着正常，只有构建产物才看得出来（真踩过）。两端省掉 `filter`，基线交给圆点
      自己的 `brightness-100` class；`syncIndicator.test.ts` 有一条用例专门钉这个
    - 判定用 `syncing` 的下降沿 + 一个一次性的 `manualSync` 标记（`onClick` 里置位）；
      「算不算成功」看下降沿那一刻的 `settledTone === "ok"`；
      清 `flashTone` 的定时器比动画**晚 60ms**，否则动画会被从半路掐断
  - 点了**不弹任何提示**：成功了它自己变绿就是反馈；失败就还是黄的，
    悬浮看标题（标题里带着错误信息和「点击重试」）。所以这个组件里不碰 toast。
  - hover 不用背景色：圆点 `group-hover:brightness-125 group-hover:size-2`
    （`group` 挂在按钮上）+ 光晕从 6px 加到 12px；正在同步（不可点）时这些 class 不加上去。
  - 命中区域（`size-8`，正好填满页头那格 2rem）和圆点（`size-1.5`）是分开的两个尺寸：
    点起来够大，看着仍是小圆点。
  - 颜色取自 `syncEngine.inSync`（见「云同步」章节），不是「打开页面那一刻的快照」
  - **⌘Y（Ctrl+Y）就是「点一下这颗点」**（`sync/shortcut.ts`）：动作与点击共用同一个 `onClick`，
    所以红点同样是去设置；云同步关着时它跟着指示点一起消失（⌘Y 完全不碰，留给浏览器）。
    悬浮标题 / `aria-label` 里也带上这个键（只在真的按得动、即 `clickable` 时挂）
- `src/components/quiz/QuizView.svelte` — 容器，接收 `bank: QuizBank`。业务全在 `QuizSession`
- `src/components/layout/` — 两个模式共用的外壳（**记忆模式不要再抄一份**）
  - `ViewShell.svelte`：答题视图的公共版面——滚动容器 + 底部渐变遮罩 + 底部工具栏（外加
    刷题模式那颗「回到顶部」）。「内容可滚动时才有遮罩、footer 跟着让位、工具栏上滚轮也能滚」
    这三条行为只此一份；内容区与左右按钮走 snippet
  - `ToolbarIconButton.svelte`：工具栏上的圆图标按钮。传 `shortcut="toggleSettings"` 就会
    自动带上 `<Kbd>` 提示——**提示文案来自 `@/config` 的快捷键注册表**，不会两边写得不一样
  - `AppShell.svelte`：更外层（页头 / 内容区）。页头的滚轮转发认的是
    `[data-main-scroll-viewport="true"]`，这个属性由 `ViewShell` 打在滚动容器上
- `src/components/settings/` 里两个模式共用的三块
  - `ImportProgressDialog.svelte`：导入进度的二次确认（覆盖全部进度且不可撤销）。
    两个 session 各自持有一个 `importConfirmText`，弹窗与文案共用这一份
  - `ShortcutHelp.svelte`：设置面板底部的快捷键表。**应用级那部分直接由注册表渲染**
    （按键、说明、分发同源），题目级那部分由调用方以 `answerRows` 传入
  - `BankNameSetting.svelte` / `QuestionOrder.svelte` / `QuestionFilters.svelte`：按库设置里
    两边同构的行与控件
- `src/components/memory/` — 记忆模式 UI（全部复用刷题模式的组件与样式）
  - `MemoryView.svelte`：容器，版面对齐 `QuizView`（同一个 `ViewShell`、同一套工具栏按钮、同一个导入确认弹窗），内容区在首页 / `MemoryQuestionArea` 之间切换
  - `MemoryHome.svelte`：首页，两个入口 + 统计卡，全部用现有 `Button` / `Card`；每种状态各配水印图标
  - `MemoryOverview.svelte`：总览对话框，与 `ReviewView` 同构（顶部三张 `Card` + `ToggleGroup` 筛选 + `QuestionPreview` 列表）
  - `MemoryMasteryButton.svelte`：卡片右侧那句状态文字，**它同时是「标熟」按钮**（点两下确认，
    形态照刷题模式的 `StreakIndicator`）。只出现在总览里——答题区不给记忆模式掌握入口
  - `MemoryProgressBar.svelte`：**只是 `ProgressBar` 的适配器**（把「本轮已完成 / 总数」映射成
    stats），数字滚动动画、完成时的庆祝高亮、细条样式全部来自那一份实现
  - `src/components/settings/MemorySettings.svelte`：设置面板，与 `Settings.svelte` 同构（`Input` / `Switch` / `Separator` / `ConfirmActionButton` / 复用 `QuestionOrder`），掌握阈值用 `$lib/components/ui/slider`，最底部是共用那份快捷键说明
- `src/quiz/session/` — 答题流状态层（Pinia 等价物，纯 Svelte 5 runes）
  - `QuizSession.svelte.ts`：持有 reactive state；`globalSettings` 是**指向共享 store 的 getter**（不自己持有副本）
  - `types.ts`：两个 session 共享的类型（复制题目相关、`KeyboardUiActions`）。
    **不要**再从 `QuizSession.svelte.ts` 里 import 类型——记忆模式并不依赖刷题会话
- 设置面板分两处（入口与图标都不同，避免混淆）：
  - `src/components/settings/Settings.svelte` — **当前题库设置**（刷题模式），答题界面底部工具栏左侧的齿轮图标；只有按库设置 + 进度备份/重置
  - `src/components/settings/MemorySettings.svelte` — **记忆模式设置**，记忆界面底部的齿轮图标（与刷题模式工具栏同位置）；每轮学习数 / 顺序 / N / M + 让题库名 + 快捷键说明 + 重置记忆进度
  - `src/components/settings/GlobalSettings.svelte` — **全局设置**，侧边栏左下角滑块图标（`IconAdjustments`）；直接读写 `globalSettingsStore`，不依赖 QuizSession
- `src/components/layout/Sidebar.svelte` — 题库列表 + 导入（文件选择 / 剪贴板 / 拖入文件）/ 导出 / 重命名 / 删除 / 排序 / 复制 Prompt（子菜单：生成刷题题库 / 生成记忆题库） + 左下角全局设置入口（开关走 `globalSettingsDialog`，收成图标栏时 tooltip 里带 ⌘⇧I 提示；那个快捷键的窗口监听也挂在这个组件的 `<svelte:window>` 上）
  - 有未裁决的**冲突**或同步**报错**时，「全局设置」图标右上角点一个**红点**（`bg-destructive`，与页头指示点
    同一个颜色语义），悬浮提示写明是什么问题；点那个按钮本来就是打开全局设置，正好对上。
    总开关关掉时一律不显示（引擎也会把状态清空），与其他地方口径一致
  - **导出降级**：`BankStore.exportBank` 里进度编码失败（例如盘上留着题库已不存在的进度 id）时不再整体失败——题目照常导出、`state` 留空，并带一个 `warning` 交给 UI 说明（`BankExportFile.warning` → `BankExportResult.warning` → 侧栏用现有的提示对话框展示）
  - 拖入文件导入挂在 window 级 drag/drop 上（`ondragenter` / `ondragover` / `ondragleave` / `ondrop`），拖到应用任意位置即可；与文件选择共用 `importFiles()`，只处理 `dataTransfer.types` 含 `Files` 的拖拽，并且必须 `preventDefault` 避免浏览器直接打开文件
  - **不做按文件类型的拦截**：浏览器在 `dragenter` / `dragover` 阶段不暴露被拖文件的名称（`dataTransfer.files` 为空），无法可靠判断是不是 JSON，所以拖拽提示与导入流程对任何文件都一视同仁；文件类型校验发生在解析层（`parseBankFile`）

### 状态模型

- `GeneralConfig`（`quiz_app_general`）
  - `activeBank: string | null`
  - `defaultSettings: BankSettings` — 新题库的按库设置模板
  - `library: BankSummary[]` — 题库索引（含 `mode`）
  - `globalSettings: GlobalSettings` — `{ soundEnabled, autoSubmitOnSelection, autoNextOnCorrect }`
- `BankSettings`（按题库，刷题模式）— `{ activePoolSize, correctStreakToMaster, correctStreakAfterMistake, selectionMode, notifyNewQuestionInPool }`
- `StoredState`（按题库）— `masteredIds` / `masteredMistakes` / `activePool` / `currentRound` / `filterType` / `settings` / `ui` / `memory?` / `roundMastered?` / `roundGoal?` / `roundPoolIds?` / `learningPool?`（后四个只在记忆模式用：学习轮已掌握数 / 本轮目标 / **「每轮限定题数」记下的那一批 id** / 复习期间暂存的学习池）
- `RuntimeState = StoredState & { pendingIds }`，`pendingIds` 不入存

掌握门槛（刷题模式）：从未答错 → `correctStreakToMaster`（默认 3）；曾错过 → `correctStreakAfterMistake`（默认 4）。`src/config/algorithm.ts` 定默认，按库设置覆盖。

记忆模式的状态段：

- `StoredState.memory?: MemoryStoredState` — `{ progress: MemoryProgressMap, settings: MemoryBankSettings, retry?: MemoryRetryState, learnedDay?: number }`。只有记忆模式题库有这段；刷题模式题库保持 `undefined`（`normalizeMemoryState` 不会凭空造空段）
- `MemoryProgressMap = Record<string, MemoryProgress>`，按题目 `id` 索引；**没有条目 = 未学习**
- `MemoryProgress = { state: "learning" | "reviewing" | "mastered", level, streak, nextDue, lapses }`
  - `level`：掌握阶梯，从 1 开始；尚未进入阶梯（学习中 / 本轮还在连对）时为 0
  - `streak`：轮内连续答对次数（学习模式用来判定学会；复习模式用来判定本轮是否完成）
  - `nextDue`：下次复习到期**日期**的锚点（本地当天 0 点的毫秒时间戳）；非复习中为 0。「今天」按凌晨 5 点换日，判断到期要用 `studyDay()`，见「日期与『今天』」
  - `lapses`：累计答错次数（**只有「忘记 / 记错了」算**，`模糊` 不算答错），仅用于统计；毕业进入复习时不清零
- `masteredIds` 在记忆模式里只是 `progress[].state === "mastered"` 的投影（导出文件名会数它）：`MemorySession.withSyncedMasteredIds()` 在载入 / 导入时同步一次，不要把它当成第二份真相
- `StoredState.memory.learnedDay?: number` — 最近一次「学完一轮」发生在哪个学习日。首页据此把学习入口降一档颜色（今天学过一轮 → 白底按钮但仍可点）；跨过凌晨 5 点自然失效，不需要清理
- `MemoryRetryState = { day, targets }`（`StoredState.memory.retry`）— 本轮「答错后还要重新连对几次」的待办：`day` = 写下的学习日（`studyDay` 锚点），`targets` = 题目 id → 还要连对几次。跨过凌晨 5 点自动作废；**不进进度备份**（属于「本轮」这种短周期状态）
- `MemoryBankSettings`（按题库，记忆模式）— `{ graduateLevel: 7, roundTarget: 5, lockRoundPool: false }`（掌握阶梯阈值 M / 一轮要掌握几题 / **每轮限定题数**），由 `sanitizeMemorySettings` 净化（`lockRoundPool` 只认真正的 `true`）
  - 连对次数 / 顺序**不重复存**，直接复用刷题模式的 `BankSettings`（`correctStreakToMaster` / `selectionMode`）；UI 在同一个面板里，但落的是同一个 `settings` 对象
  - 记忆模式**不用** `BankSettings.activePoolSize`：池子容量与本轮目标共用 `roundTarget`（见「两条流」）

### 存储键布局

```
quiz_app_general              { activeBank, defaultSettings, library, globalSettings }
quiz_app_questions_<hash>     某份题库的题目数组 JSON（canonical，minified）
quiz_app_state_<hash>         某份题库的 StoredState
quiz_app_sync_config          { enabled, token, gistId, gistUrl, autoSync }（Gitee 令牌 + 同步用的 Gist，不上传）
quiz_app_sync_meta            { lastSyncedAt, bootstrapped, rows, generalBaseline }（同步元数据，不上传）
                               rows 的键：`bank:<hash>`（逐题库）+ 老格式的 `banks-N.json`（迁移兜底）
quiz_app_sync_mtime:<key>     某个可同步键最后一次本地改动的时间戳（不上传）
```

同一个 `quiz_app_state_<hash>` 键同时承载两种模式的数据：刷题字段在顶层，记忆模式的进度与设置在 `memory` 段（`state.memory`）。记忆进度**不做** run-length / 位图编码，每道有进度的题逐条存一个 `MemoryProgress`。

旧版把配置拆成 `quiz_app_library` / `quiz_app_active_bank` / `quiz_app_default_settings`；
`loadGeneralConfig()` 在首次加载时会一次性迁移到 `quiz_app_general` 并删除旧键（见 `src/config/storage.ts` 的 `LEGACY_STORAGE_KEY_*`）。

### 云同步（Gitee Gist）

详见 [`docs/cloud-sync-setup.md`](./docs/cloud-sync-setup.md)。

```
浏览器 ──► gitee.com/api/v5/gists
    └── Authorization: Bearer <私人令牌>
```

**不需要任何服务器**：实测 Gitee 返回 `access-control-allow-origin: *`、预检放行
`authorization`，且 `Authorization: Bearer` 对读写都有效，所以浏览器直连即可，
令牌不进 URL、不经过第三方。曾经为 Supabase 写过一层 Vercel 中转，现在已删除。

- **一条 Gist、固定 10 个文件**：`_general.json` + `banks-0.json` … `banks-8.json`。
  **新设备必须能选到已有那条**：没有本地记的 Gist ID 时，绝不能闷头新建 ——
  否则「同一个令牌在别处同步」永远拿不到数据（这是线上踩过的坑）。
  所以编辑态点「测试连接」会 `listGists()` 列出账号里的片段让用户挑。
  识别判据是 `looksLikeSyncGist`：描述 === `quiz-app sync` **且**含 `_general.json`
  （只看描述会被手改描述骗过，只看文件名会撞上别人的同名文件）。
  实测列表接口会返回 `description` 与 `files` 的文件名，够用。
  **Gitee 一条 Gist 最多 10 个文件**（实测：10 个成功、11 个报「文件不能超过 10 个」），
  所以按 hash 把题库归到 9 个分片里（`shardIndexOf`），文件数恒定不超限。
  分片让「上传时同片题库一起传」，但**冲突检测仍是逐题库的**（比内容哈希），
  同片题库不会互相误判。`tests/syncShards.test.ts` 把「文件数永不超 10」钉住了。
- **每个文件是压缩的**：`payload.ts` 的 `encodePayload` / `decodePayload`，
  `deflateRaw` + base64url 包一层 `{v, d}`。实测 200 张卡 44.2 KB → 5.6 KB。
  **不要**用字典树之类的方式再压缩：实测只省 13.6% raw，deflate 之后归零
  （deflate 本来就是靠引用前面出现过的字符串工作的）。
- **同步单元是「题库」，不是「文件」**（`merge.ts`，纯函数，重点测试对象）。
  分片只是容器：合并 / 冲突 / 删除都按题库逐条判定。两个独立信号：
  - 本地改过没有 → 比 `SyncRowMeta.syncedAt` 与该题库的 mtime（题目键 / 进度键里最晚的）
  - 云端改过没有 → 比 `SyncRowMeta.remoteHash` 与该题库重新算出来的**内容哈希**
  用哈希而不是 `updated_at`，是因为 Gitee 的时间戳只在 Gist 级别：改了题库 A，
  整个 Gist 时间就变，题库 B 不该被误判成冲突。内容哈希 = `bankContentHash`，
  覆盖 `{mode, questions, state}`，**不含题库名**（名字在 general 的题库列表里，
  算进去会让「改个名」变成「题库内容变了」）。
- **只在一侧存在的题库**（对称的两条，删除靠它们传播）：
  - 有题库行的基准 → 另一边删过它 → 跟着删（`deleteRemote` / `deleteLocal`）
  - 没有基准 → 那边新导入的 → 传过去（`push` / `pull`）
  **绝不能反过来**：把「云端有、本地没有、又没见过」当成删除，就会把别的设备
  刚导入的题库删掉。
- **没有任何基准时先看「哪边是空的」**：内容不同但本地没有进度、云端有 → 下载；
  只有本地有进度 → 上传；两边都有进度且不同 → 冲突。这样「同一份题库 + 一边刚导入」
  不会平白撞冲突，又不会丢掉任何一边的进度。
- **老格式的元数据当兜底基准**：升级上来的设备 `rows` 里只有 `banks-N.json`
  （文件级），第一次同步时用 `fileRow` + 该分片文件当前的哈希来判断方向；
  这一次同步结束后文件级的行会被题库行替换掉。
- **新设备的空壳绝不能推上云端**（`mergeGeneral`）：刚打开应用时本地 general 是个
  默认空壳（题库列表为空），而 `_general.json` 一启动就被重写过、mtime 永远是新鲜的。
  只看 mtime 会把它判成「本地改过」并推上去，于是**所有设备的题库列表被清空**——
  这是线上真实发生过的数据丢失。所以：
  - `general` 走**逐字段**三方合并（`defaultSettings` / `globalSettings` 比字段，
    `library` 按题库条目逐条比），没有基准时「本地是空壳就听云端的」；
  - `library` 的真相是**合并之后的题库集合**：两边各自导入的都在，删掉的消失，
    云端独有的接在后面。它由题库动作推导出来，不是从哪一边整体拷贝。
  - **顺序也要三方合并**：只比较「还活着的题库」的顺序，谁动过听谁的（都动过听本地）。
    早期版本无脑用本地顺序，于是「在 A 上把题库拖到最前面」永远传不到 B——
    两边条目内容一模一样，只有数组顺序变了，逐条比字段是看不出来的。
- **推上去的必须是「应用完拉取之后」重新收集的内容**（`engine.execute` 的第 ③ 步）：
  先落 general、再落题库，最后用 `collectLocalState()` 的结果重建分片才上传。
  拿同步开始时那份旧快照去推，就会把刚拉下来的东西又推回旧版本（同上，线上踩过）。
  重建之后**内容没变就不传**（同片的别的题库可能刚好把内容凑回原样）。
- **只要还有未裁决的冲突，这一轮同步什么都不做**（`runOnce` 里直接 return）：
  不拉、不推、不改本地、不写元数据——所以也不会 `location.reload()`。
  这一点是踩出来的：早期版本「冲突的题库不动、其余照常同步」，于是拉到别的题库之后
  立刻整页刷新，**内存里的冲突提示跟着没了**，用户看到的就是「还没选就自己刷过去了」。
  宁可停一轮，也不能让用户的选择落空。
- **裁决按题库记账**（`resolutions: Map<hash, ConflictResolution>`），不是一次性开关：
  用户只对他在面板上**看见过**的那些冲突负责；两次同步之间新冒出来的冲突继续问。
  `applyResolution(plan, resolutions)` 只改这些题库的判定，剩下的仍是 `conflict`。
  用户点按钮时如果正好有同步在跑，`resolveConflicts` 会先 `await` 它再重新跑一次，
  免得那一下白点。冲突提示只在**冲突集合变化时**才弹（轮询每 3 分钟一次，否则会刷屏）。
- **含未裁决冲突的分片整片冻结**：分片是整体上传的，为了传同一片里的另一个题库
  而把它一起推上去，就等于替用户选了「保留本地」。
- **关掉总开关 = 立刻把内存里的同步状态清干净**（`onConfigChanged` → `clearDisabledState`）：
  冲突提示、待裁决（`resolutions`）、错误信息、排队中的防抖上传一起清，状态行变成
  「云同步已关闭」。不清就会出现「云同步都关了，侧边栏还在提示有冲突待处理」这种自相矛盾的状态。
  重新打开时按「打开页面」的规格先对一次账——冲突如果还在会**重新报出来**（数据确实分叉了，
  不能假装没事）。
  **盘上的东西一个都不动**：`quiz_app_sync_meta`（基准线）与 `sync_app_sync_mtime:*` 都留着，
  它们是下次同步判断「谁改过」的依据，删掉只会让下次同步把一切都当成没同步过。
  要连记账一起忘掉，用「清空配置」（`clearSyncState` → `clearSyncMeta`，面板那条路
  还会把 `quiz_app_sync_config` 这个键本身删掉），或者 `forgetGist()`（丢掉 Gist id + 记账）。
- **一轮同步干了几件事，分开数**（`summary.ts` 的 `describeSyncResult`，`SyncOutcome` 里带着计数）：
  `新增`（某一侧新出现的题库，两个方向合计）/ `删除`（某一侧删掉、传播到另一侧的）/
  `上传` `下载`（**已有**题库的内容改动，两个方向各算各的）+ `设置已更新`。
  前四项互斥：新题库只算「新增」，`pushed` / `pulled` 里扣掉它才是「上传 / 下载」。
  只列非零项，四项全零就说「题库没有改动」。
  `设置已更新` 来自 `plan.settingsChanged`（`sameSettings()` 三方比：当前题库 / 全局设置 /
  默认设置 + **两边都在**的列表条目的字段与相对顺序）——题库的增删不算，否则「导入一个题库」
  也会顺带报「设置已更新」；而「拖了一下顺序 / 改了个名」正是四个数全是 0 却真的同步了东西的情况。
- **`runOnce` 第一件事就是查 `isOn()`**：关着就什么都别做。别指望调用方都记得判断——
  `online` 事件、组件里的按钮、以及「关开关那一瞬间已经排上队的防抖任务」都会走到这里。
- **`dispose()` 会摘掉配置订阅**（`watchConfig`），所以 `init()` 要能重新订上；
  测试里 init / dispose 要成对出现，否则后面的用例收不到「总开关被关掉」的通知。
- **「本地脏了」不能只靠 localStorage 钩子**（`probeStorageHealth` + 兜底轮询）：页头那颗点
  之所以会变黄，是因为 `installStorageHook()` 包了 `localStorage.setItem`，写入时通知引擎。
  **iOS 上见过两种失灵**：覆盖 `setItem` 没生效（写得进去但没人通知 → 指示点永远不变黄、
  也不会自动上传），或者 `setItem` 直接被拦（隐私模式 / 系统拦截 → 连进度都存不下来）。
  所以 `init()` 里先跑一次探针（写一个 `quiz_app_state___probe__` 再删掉，看有没有通知）：
  - `ok`     正常，什么都不用做；
  - `silent` 装 `SYNC_LOCAL_POLL_MS`（5 秒）的兜底轮询：按**内容哈希**比一遍本地有没有没同步的改动，
             脏了就标黄并排队上传（`localChangeFallback = true`，只在页面可见且同步开着时跑）；
  - `blocked` `storageBlocked = true` → `inSync` 永远 false，指示点标红、侧边栏点红、
             设置面板顶部直接写「写不了本地存储，进度不会保存」。
  探针必须在引擎注册自己的监听**之前**跑，否则它会顺带把 `pendingChanges` 标脏。
- **指示点的黄/绿 = `syncEngine.inSync`**：`phase === "idle"` **且** `pendingChanges === false`。
  `pendingChanges` 的语义是「本地和上次同步成功的基准对不上」——本地一写入就置 `true`（在
  `onLocalChange` 里，便宜），每次同步正常收尾后由 `computePendingChanges()` 按**内容哈希**
  重算（比 mtime 准：应用启动会把配置原样重写一遍，mtime 永远新鲜，只看 mtime 会一直黄着）。
  它默认 `true`：没验证过之前绝不上来就报「已同步」。冲突 / 报错 / 离线 / 正在跑时 `phase`
  就不是 `idle`，指示点自然也是黄的。
- **拉取不写 mtime**（`applyRemoteValue` 只写内容）：拉下来的内容不是这台设备改的，
  记成「本地改动」会让下一轮白推一遍甚至撞成冲突。拉取还会顺手清掉该题库的 mtime。
  注意 `installStorageHook` 只包 `localStorage.setItem` —— 测试里装快照要用
  `writeLocal`（原始写入），否则每装一次设备快照就等于把所有键都"改"了一遍。
- **强制覆盖是显式计划**：`forcePushPlan` / `forcePullPlan` 无条件按一边来，
  不算冲突、不做三方判定。用逐题库判定实现「用本地覆盖云端」是不对的——
  没有基准时它会认为「本地改过、该上传」，于是「用云端覆盖本地」变成空操作。
- **`tests/syncEngine.test.ts` / `tests/syncTwoDevice.test.ts` 是这一层的护栏**：
  用真模块 + 内存替身 Gitee 跑完整的推送 / 拉取 / 双设备来回。上面这些 bug
  几乎都是它们抓出来的，改同步逻辑前先看它们。
- **`config.svelte.ts` 丢弃旧版凭据**：Supabase 时代的 `supabaseUrl` / `supabaseKey` /
  `credentials` / `relayUrl` 在新的存储后端上毫无意义，留着只会让人以为还在生效。
- **Gist 的网页地址用 Gitee 给的 `html_url`**（`GiteeGist.htmlUrl` → `SyncConfig.gistUrl`）：
  它是 `https://gitee.com/<用户名>/codes/<id>`，自己拼用户名容易拼错。
  老配置里只有 id 没 url 时，会在下次自检 / 同步时顺手补上。
- **`scripts/gitee-probe.mjs` / `gitee-cors-probe.mjs`** 是接口探针：Gitee 改接口时
  先跑它们确认（创建 / 只更新单文件 / 删除 / CORS 是否仍放行）。
  `tests/giteeClient.test.ts` 把探针学到的约定固化成不碰网络的契约测试。
- 不做「同源或中转」这类分支：Gitee 直连在国内是稳的，没有 Supabase 那个问题。

### 题库哈希

`hashQuestionsJson` = SHA-1 hex 前 16 字符，**只覆盖 `questions` 数组**（不含 `mode` / `state`）：

- 调用方先 `JSON.parse` 再 `JSON.stringify(questions)` 得到 canonical 字符串再传入
- 与历史上导入过的题库 hash 兼容，进度可继承
- 同一份题目在本地和导入回灌时 hash 稳定

### 选题（`selectNextFromPool`）

- `selectionMode === "sequential"`：题库原顺序，跳过当前题
- 否则加权随机：权重 = 平滑斜坡 `1 - exp(-4x/(L/2))` 关于「距离上次选中轮次（封顶 2L）减 L/3」

### 构建约束

- 题库文件最外层必须是 `{ "questions": [...] }` 对象；裸数组会被 `parseBankFile` 拒绝
- 题目 `id` 必须唯一
- `Bank = QuizBank | MemoryBank` 是判别联合：新增消费 `bank.questions` 的代码时，先按 `bank.mode` 收窄
- 音效资源在 `assets/sounds/`，通过 `/assets/sounds/*.webm` 静态 import

### 首屏体积（别再往主包里塞东西）

主包（`dist/assets/index-*.js`）是**首屏关键路径**，目前 gzip 约 207 kB。加依赖前先问一句
「首页 / 刷题界面真的用得到吗」。已经拆出去的（都在 `dist/assets/` 里各占一个 chunk）：

| 什么 | 谁在用 | 什么时候加载 | gzip |
|---|---|---|---|
| `@dicebear/core` + `slice` 样式 | 只有头像（`$lib/identicon.ts`） | **用户打开云同步**（`SyncSettings` 里 `enabled` 一为真就 `preloadIdenticon()`；`<Identicon>` 自己也会兜底拉） | 28.8 kB |
| `GlobalSettings.svelte`（设置 + 云同步两整块 UI） | 侧边栏那个对话框 | 首屏之后 `requestIdleCallback` 预热；点齿轮 / ⌘⇧I 时确保加载，chunk 到了才挂载 | 10.3 kB |
| `SyncGuideDrawer.svelte`（+ `vaul-svelte`） | 说明抽屉 | 点「云同步说明」时 `import()` | 16.3 kB |

- **`@lucide/svelte` 已经全部换成 `@tabler/icons-svelte`**（两个图标库同时进包纯属浪费，
  差的 24 kB gzip 就在那儿）。改 shadcn 生成组件里的图标时记得继续用 tabler。
- 图标一律**深路径**引入（`@tabler/icons-svelte/icons/check`）；从包根 `import { … }` 虽然
  目前也能被 tree-shake，但没有必要赌构建器的行为。
- 想量体积别加可视化依赖：临时写个 vite 配置把 `node_modules` 按包名 `manualChunks` 拆开，
  跑一次 `vite build --config <那个配置>` 就能看出每个包占多少（测完把 `dist-analyze/` 删掉——
  Tailwind v4 会扫项目目录，留着它会把构建产物里的类名也当成源码再生成一遍 CSS）。
- **vitest 里动态 import 某些包会挂住**（`import("bits-ui")`、`import("vaul-svelte")` 直接超时，
  因为测试跑的是 Svelte 的浏览器构建、而这些包默认被 externalize）。已经在
  `vite.config.ts` 的 `test.server.deps.inline` 里 inline 了 `bits-ui` / `vaul-svelte` /
  `runed` / `svelte-toolbelt`；`bits-ui` 的**根入口**仍然挂，所以测试里要验一个懒加载的
  对话框时，先静态 `import` 一次把它塞进模块缓存（见 `tests/globalSettingsShortcut.test.ts`）。

## 题库格式

统一结构：

```json
{
  "mode": "quiz",              // 可选，默认 "quiz"
  "title": "计算机基础",        // 可选，题库标题；省略时用文件名 / 剪贴板名
  "state": "hash.payload",     // 可选，进度备份；LLM 生成的题库应省略
  "questions": [ /* 必需 */ ]
}
```

- `questions` — 必需。按 `mode` 校验（`src/quiz/modes/`）。
- `mode` — 可选，`"quiz"`（默认）或 `"memory"`。非法值报错。**省略时按 `"quiz"` 解析**，所以记忆题库必须显式写 `"mode": "memory"`，否则会因为题目没有 `type` 而校验失败；两份 LLM Prompt 都要求输出 `mode`。
- `title` — 可选字符串。导入时优先用作题库名称；缺失 / 空串 / `null` 时回退到文件名（文件导入）或「剪贴板题库」（剪贴板导入）。两份 LLM Prompt 都允许 AI 顺手生成它。
- `state` — 可选字符串。导入时若解出的 hash 已存在，UI 会询问是否用文件里的进度覆盖当前进度。

导出（`formatBankFile`）写出 `{ mode, title?, state?, questions }`；`exportBank` 会把题库名称写进 `title`、并把当前进度编码进 `state`，所以导出再导入能带回名称与进度。

## 记忆模式（memory）

记忆模式的题目是**第五种题型**：`type: "memory"`，没有 `options`、`answer` 恒为字符串。它和刷题四型共用同一套注册表、判分接口与 UI 组件，所以记忆模式几乎没有专属样式——答题卡片、总览列表、进度条、设置面板全部复用刷题模式的实现。

题库文件示例（`type` 可省略，导入时补成 `"memory"`）：

```json
{
  "mode": "memory",
  "questions": [
    { "id": "m1", "type": "memory", "question": "取得进步", "answer": "make progress" }
  ]
}
```

校验：`memoryModeDef.validateQuestions` → `validateMemoryQuestions`（`src/lib/validateQuestions.ts`）→ 通用层 `validateQuestionsWithType` + `src/quiz/types/memory/logic.ts` 的 `validate`。`questions` 非空、`id` 唯一、`question` / `answer` 非空字符串；写了 `type` 就只能是 `"memory"`。

### 两个必须分开的概念

- **复习完成（轮内）**：这一轮里这张卡还要连对几次。学习模式要求 N 次；复习模式默认 1 次，**答「忘记」或「模糊」后提到 N 次**。目标次数在 session 上是 `reviewTarget`，另有一份当天有效的落盘副本 `StoredState.memory.retry`（见「复习」小节）。
- **掌握（阶梯）**：`level` / `nextDue` 那条 1/2/4/8… 曲线。**忘记**把它归零（回第 1 级）、**模糊**让它退一级；答对本身不推进它——推进发生在「本轮复习完成」那一刻。走完 M（`graduateLevel`）次才变成「已掌握」，此时 `level` / `streak` 一起清零。

> 一句话：`progress.streak` = 轮内连对计数，`progress.level` = 掌握阶梯。两者互不干扰。

### 两条流（`MemorySession.svelte.ts`）

会话骨架与 `QuizSession` 一致：`appState: RuntimeState` + `currentQuestion` / `showResult` / `isCorrect` / `selectedAnswers` / `submit()` / `advanceQuestionFlow()` / `copyCurrentQuestion()`，所以 `QuestionArea` 式的 UI 可以直接套用（每个动作要在同一帧内写入 `selectedAnswers` 再 `submit()`，答案页才会出现）。额外多一个 `run: "idle" | "learning" | "reviewing"`（首页 / 学习 / 复习）。

- **学习新的题目**（`startLearning` → `run = "learning"`）
  - **活动题目池**（与刷题模式同一套概念）：池子容量 = 本轮目标 `roundTarget`（**不用** `activePoolSize`），`fillActivePool()` 从「没学过的 + 学到一半的」里补题——`selectionMode` 只决定补进来的顺序（顺序 = 按题库原序 / 随机 = 随机抽），**池内出题一律随机**
  - **每掌握一题就补一题**（默认）：`graduateInLearning()` 记入本轮后立刻 `fillActivePool()`，所以池子始终是满的
  - **「每轮限定题数」（`lockRoundPool`）**：打开后开轮时挑一批（数量 = `targetPerRound`，规则同上）就把这一轮定死，
    `fillActivePool()` **只从这一批里补位**、绝不引新卡，于是池子只会随着毕业变小，这一批学完本轮结束。
    要点：
    - 这一批的 id 记在 `StoredState.roundPoolIds`（**落盘**）里，而且**只收不放**（毕业 / 被标熟的卡仍留着），
      否则刚被 `masterQuestion` 摘掉的卡会被补位逻辑立刻捞回来
    - `startLearning()` 开新轮时清空它（跟 `roundMastered` 一起），`finishLearningRound` / `endRound` 也清；
      **开轮那一次 `fillActivePool()` 之后必须 `save()`**——不写下去，「开轮后立刻刷新」就会读回上一份状态，
      这一批是谁就丢了（这项功能的核心正是「存得住」）
    - `lockRoundPoolInPlace()` 返回的 `{ ids, fresh }` 里 `fresh` 不能省：刚挑出来的那一批**还没进池子**，
      当成「已在池中」的话补位名额就是 0，整批卡一道都进不来（这个 bug 真踩过，靠 `memorySession.test.ts` 抓住）
    - 关掉开关时中途改设置不影响已经开着的那一轮（那一批的 id 还在，只是不再限制补题）
  - **本轮判定**（接上面两条）：不是「一轮开始时选一批题」，而是数「本轮已经掌握了几题」——`roundMastered` 达到 `roundTarget`（默认 5，可设置）这一轮就结束。这一批里的卡凑不出这么多（题库新卡不够）时本轮提前收尾，`finishLearningRound("bank" | "pool")` 按原因换文案——`"bank"` =「题库里没有更多新卡片了」、`"pool"` =「本轮这一批就这些了」——两者都**不报成功音效**（`mastered < target` 时谎报「已掌握 5 / 5」是之前的 bug）
  - 本轮结束时把 `memory.learnedDay` 写成当天（`studyDay(now)`）并落盘：首页据此把学习入口降一档颜色。中途退出（`exitSession`）不算学完一轮，`learnedDay` 不动
  - **可中断续学**：`roundMastered` / `roundGoal` 与 `activePool` 都落盘，**只要池子里还有没学完的卡就续轮**——哪怕这一轮一张都还没掌握（`startLearning` 用 `hasOngoingRound` 判断，判据是池子，不是 `roundMastered`）。本轮目标 `roundGoal` 在开轮时从设置里取快照，中途改设置不影响本轮
  - **学到一半去复习，池子不会被顶掉**：复习轮要拿 `activePool` 当到期队列用，所以 `startReview()` 会先把学习池原样挪进 `StoredState.learningPool`（成员与顺序都不动，并立刻 `save()`），复习结束（`exitSession` / `finishSession`）或下次 `startLearning()` 时再放回 `activePool`。中途刷新页面也不会丢：`learningPool` 和到期队列都在盘上
  - 读「学习池」一律用 `session.learningPool` getter（`learningPool ?? activePool`，并滤掉 `reviewing` / `mastered` 的卡兜底），**不要**直接读 `activePool`——它在复习轮里是到期队列
  - 题干页只有大字号题干 + 「忘记 / 模糊 / 知道」三个按钮（`outline` / `secondary` / `default`）；点任意一个都只做两件事：题干回到常规字号、展示答案
  - **三档自评**（编码见 `src/quiz/types/memory/logic.ts` 的 `MEMORY_ANSWER_CODE`）：
    - `知道`（1）→ 轮内连对 +1
    - `模糊`（2）→ 轮内连对**不变**（不加也不减），复习阶梯 `level - 1`（最低停在第 1 级），按新阶梯安排下次复习；本轮目标和「忘记」一样提到 N，完成本轮时同样不推进阶梯（否则退掉的那一级立刻被加回来）
    - `忘记`（0）→ 轮内连对清零、复习阶梯归零（`level = 1` / 明天）、`lapses` +1
  - 「下一题」时连对达到 N（`correctStreakToMaster`）→ 结算为「复习中」（`level = 1`，第 1 次复习安排在明天）并离开 `activePool`；没连够则排到队尾，本轮继续
  - **答案页的反悔入口按刚选的那一档给**（`memoryAnswerDowngrades`，与刷题模式的「视作正确」方向相反：那边是错→对，这边是对→错）：
    - 选了「知道」→ 「记错了」（改判成忘记）/「模糊」（改判成模糊）/「下一题」
    - 选了「模糊」→ 「记错了」/「下一题」
    - 选了「忘记」→ 只有「下一题」
    - 改判基于 `preSubmitState` 重算，反复点不会叠加；`markAsWrong` / `markAsFuzzy` 各自带一档守卫（忘记不能再降级、非「知道」不能改判成模糊）
- **键盘**（`src/quiz/types/memory/logic.ts` 的 `getKeyboardAction`；`MemoryView` 只做窗口级动作，题目级动作统一从题型注册表分发）：
  - 题干页：`Space` / `Enter` = 知道，`'` = 模糊，`;` = 忘记
  - 答案页：`Space` / `Enter` = 下一题，`'` = 改判成模糊，`;` = 记错了
  - 四个动作的统一说明（设置面板最底部那份列表就是照这个写的，**只列这四条**）：知道 / 下一题 = `Space`·`Enter`、模糊 = `'`、忘记 / 记错了 = `;`、复制当前题目 = `⌘/Ctrl+C`。按键常量在 `src/quiz/types/memory/logic.ts`（`MEMORY_KEY_FUZZY` / `MEMORY_KEY_WRONG`），**不要**在组件里另抄一份
  - `Esc` = 退出本轮（回首页，下次接着这一轮）；`⌘/Ctrl+C/W/E/I/O` = 复制题目 / 导入 / 导出 / 设置 / 总览；`⌘/Ctrl+⇧+I` = 全局设置（应用级，必须赶在下面那个 `mod` 分支前放行，否则会连记忆设置一起切了）
  - 「该不该拦这次按键」的判定**只有一份**：`src/features/appShortcuts.ts` 的 `createAppKeyboardHandler`，两个视图各自装上（`createAppKeyboardHandler(session, uiActions)`）。输入框 / 对话框 / 输入法组词不介入，`Space` / `Enter` 落在按钮等交互目标上时让给原生点击。**不要**在组件里重写一套判定——漏掉 `isInteractiveTarget` 会让答案页的 `Space` 双触发（原生点击 + 全局处理器各跳一题），而两份实现分头演化正是 ⌘S / ⌘N 在记忆模式里失效的原因
- **复习**（`startReview` → `run = "reviewing"`）
  - 取所有到期的题（`state === "reviewing"` 且 `nextDue` ≤ 今天），外加**今天还没补完连对的卡**（见下面的「答错后的重新连对」），全部打散后放进 `activePool` 当队列
  - 答对：只把本轮连对次数 +1，**不动掌握阶梯**；连对达到本轮目标（默认 1）才算「复习完成」
    - **本轮没失败过** → 完成时才推进阶梯（`level + 1`，下次隔 `2^(level-1)` 天）；`level` 超过 M → 已掌握（`level` / `streak` 清零，不再出现）
    - **本轮失败过** → 阶梯保持 `resetReview` 写下的 `level = 1`、明天到期，**完成时不再推进**（并把轮内 streak 清零）。否则答错那张会被推成和一次答对那张同样的间隔
  - 忘记：掌握阶梯 `resetReview` 归零（`level = 1`、`nextDue = 明天`）、`lapses` +1，**并把本轮目标提到 N**——这张卡必须在本轮里重新连对 N 次才算复习完；中途再答错就再清零
    - 降级的卡（忘记 / 模糊）**立即计入「今日已复习」**（`markReviewed` + `failedThisRound`），进度条会立刻变绿；它在同一轮里再出现几次都算同一题
    - `failedThisRound` 是会话状态（不落盘），只用来决定「本轮完成时要不要推进阶梯」；重新进入复习时由落盘的待办重建（见下）
  - 模糊：`fuzzyReview` 把阶梯**退一级**（`level = max(1, level - 1)`，最低停在第 1 级）并按新阶梯安排下次复习（今天 + `2^(level-1)` 天）；**轮内连对次数不变**（模糊不加也不减），但和「忘记」一样把本轮目标提到 N、计入 `failedThisRound`——所以补完连对时同样不推进阶梯，退掉的那一级不会被立刻加回来。`lapses` 不动（模糊不算答错）
  - **答错后的「重新连对」跨会话**：要求写进 `StoredState.memory.retry = { day, targets }`（`day` = 写下的学习日，`targets` = 题目 id → 还要连对几次）。`startReview` 会把当天仍有效的待办一起排进队列并把 `reviewTarget` / `failedThisRound` 恢复回来，`retryTargetsToday()` 负责过滤（只认 `state === "reviewing"` 且 `day === studyDay(now)`）；本轮完成或重置时 `clearRetryTarget()` 清掉。跨过凌晨 5 点（学习日变了）自动作废——那时卡片本来就已经到期，答对一次即过
    - 轮内连对次数本身仍不跨会话（复习中的卡重新载入时 `streak` 归 0），所以重新进来是「从 0 开始连对 N 次」
    - 首页与统计卡的「今日待复习」用 `reviewableCount`（= `dueCount` + `pendingRetryCount`）算，只看到期数会让答错后退出的人点不开复习
  - 失败**不会**回到「学习中」
  - 复习进度条按「今天要复习的题」算：`reviewTotal` 是本轮队列总数（到期 + 待补连对），每过一题就 `markReviewed(id)`，进度条里那一格变绿

一轮的队列状态（`shownIds` / `reviewTarget` / `reviewedIds` / `reviewTotal` / `failedThisRound`）只存在 session 上，不写进 `RuntimeState`；`MemoryProgress`、`memory.retry` 与学习轮的 `roundMastered` / `roundGoal` 落盘。

> **落盘时机**：`submit()` / `startReview()` / `exitSession()` 会 `save()`，`advanceQuestionFlow()` 里的结算（复习晋升一级、学习轮 `roundMastered += 1`、补题、清待办）也**必须立刻 `save()`**——否则答完题点「下一题」后直接关页面会丢掉这次推进（表现为卡片又回到今天到期、本轮少算一张）。

### 出题顺序

- 「顺序刷题」**只影响挑哪一批新题入池**（按题库原顺序取前 N 张还没学过的卡）；随机就是随机抽 N 张
- **入池之后本轮内部一律随机出题**，复习模式同样打散（不再按逾期天数排序）

### 状态机

`未学习`（`progress[id]` 不存在）→ `学习中`（`state: "learning"`，看 `streak`）→ `复习中`（`state: "reviewing"`，看 `level` / `nextDue`）→ `已掌握`（`state: "mastered"`，之后不会再出现）。

- 复习降级只调整复习阶梯（忘记归零 / 模糊退一级），不回退到「学习中」
- 学习中失败只清零 `streak`
- 已掌握是终态，`mastered` 的题不再进入任何一条队列
- **「学习中」的卡不能掉队**：它有进度条目、进不了「未学习」，所以只要它不在活动池里，`fillActivePool()` 就要把它收回来（判据是 `state === "learning"`，不只是 `progress[id] === undefined`），并且把 `progress.streak` 接回池子条目的 `consecutiveCorrect`。首页「学习」入口的可点击性也按 `learnableCount`（未学习 + 学习中）算，不然孤儿卡会变成永远点不到的死卡

### 复习曲线

- 第 `level` 次复习的间隔 = `2^(level-1)` 天：1、2、4、8、16…（`memoryIntervalDays`），单级封顶 `MEMORY_MAX_INTERVAL_DAYS = 365` 天
- 默认掌握阈值 `MEMORY_DEFAULT_GRADUATE_LEVEL = 7` → 第 7 次复习隔 64 天，整条曲线累计 127 天（`cumulativeIntervalDays`）
- `reviewProgress` 给 UI 用：`(level - 1) / graduateLevel`，已掌握恒为 1

### 日期与「今天」（凌晨 5 点换日）

- **一天从凌晨 5 点开始算**（`MEMORY_DAY_START_HOUR = 5`）：凌晨 5 点前都算前一天，5 点后才算次日
- `studyDay(timestamp)` 返回「这个时刻属于哪一天」的日期锚点。返回值仍是当天 **0 点**的时间戳，只是按 5 点切换归属——这样 `nextDue` 存的还是「到期日期」，老数据（同样是 0 点）不需要迁移
- 判断到期 / 逾期 / 算「还有几天」一律走 `studyDay`：`isDue` = `startOfDay(nextDue) <= studyDay(now)`，`overdueDays` = `diffDays(nextDue, studyDay(now))`，排下次复习 = `addDays(studyDay(now), 间隔天数)`。UI 侧（`MemoryOverview`）算「今天 / 明天 / N 天后 / 逾期 N 天」也必须用 `studyDay(session.now)`，别用 `startOfDay`
- 推论（有意为之，和 Anki 的「次日开始时间」一致）：**凌晨 2 点学出来的卡，凌晨 5 点就到期**——因为 2 点还算「昨天」，它的「明天」指的就是从 5 点开始的这一天
- 这个 5 点只作用于**记忆模式**的复习到期判断；刷题模式的日期逻辑没有动

### 设置

记忆模式的设置分两处存放，但 UI 在同一个面板里：

| 设置 | 存放位置 | 默认 / 边界 |
|------|----------|-------------|
| 连续正确次数 N | `BankSettings.correctStreakToMaster` | 3 / 1–10 |
| 学习顺序 | `BankSettings.selectionMode` | `random` / `sequential` |
| 掌握阈值 M（复习几次算已掌握） | `MemoryBankSettings.graduateLevel` | 7 / 3–10 |
| 一轮掌握题目数（= 池子容量） | `MemoryBankSettings.roundTarget` | 5 / 1–50 |

> 记忆模式**不提供**「每次学习数量」：池子容量跟着 `roundTarget` 走。面板里也没有这一项。
> 复习答错**没有**可设置的次数：答错就把本轮目标提到 N（同时在原地继续出现，直到连对 N 次），掌握阶梯归零、明天从 1 天重来。

`MemorySession.updateBankSettings` / `updateMemorySettings` 改完立即 `saveState`；`reset()` 只清 `progress`、保留设置，并把调试用的时间偏移一起清零。

调试用的「时间修改」控件（`src/features/memory/devClock.ts` + `MemorySession.debugAddDay/debugDayOffset/debugResetDays`）只在 `isDebugModeEnabled()`（即 `import.meta.env.DEV`）时显示；删掉这三处即与原始代码一致。

### UI

- `src/App.svelte` 按 `activeBank.mode === "memory"` 渲染 `MemoryView`
- **对话框焦点**：总览（`ReviewView` / `MemoryOverview`）用 `onOpenAutoFocus` 阻止默认行为后聚焦搜索框，且 `isCoarsePointer` 时（触屏）不聚焦，免得弹键盘；**设置面板（`Settings` / `MemorySettings`）只 `preventDefault()`**——默认行为会把焦点丢给第一个可聚焦元素，也就是「修改名称」输入框，打开设置不该直接进输入态
- `src/components/memory/`：
  - `MemoryView`：版面与 `QuizView` 一致（滚动容器 / 居中列宽 / 底部工具栏：左设置、右总览）；窗口级快捷键（复制 / 导入 / 导出 / 设置 / 总览 / Esc 退出本轮）也在这里
  - **答题区那一行**（`data-slot="memory-round-actions"`）：左边「退出本轮」（`IconArrowLeft`，`exitSession`：回首页、这一轮留着），中间一条半透明分割线，右边「结束本轮」（`ConfirmActionButton` + `hand-stop`，点两下确认 → `endRound()`：本轮作废，**同样回首页**，下次点「学习新的题目」是新的一轮；第一下只把文案换成「确认结束」，字数一样所以宽度不跳）。两个词不能混：退出留着这一轮，结束把它作废
    - **「结束本轮」只有学习轮有**：复习队列就是「今天还欠什么」，没有可以结束的一轮，所以 `session.run !== "learning"` 时分割线与那颗按钮整块不渲染，整行只剩「退出本轮」
    - 两颗按钮各带一句 tooltip：退出 = 「暂时退出 + `Esc` 键帽 / 保留进度」，结束 = 「完全退出 / 下次开启新一轮」
    - **平时只有箭头露着**（100%，点了不生效），分割线与「结束本轮」藏在原位（`opacity: 0`）；指到箭头上（或焦点进来）三部分才依次向右就位、两颗按钮到 60%，鼠标再压到哪一颗上它才回到 100%
    - **触发区只有箭头那颗按钮本身**，不是整行：`onmouseenter` 挂在按钮上、`onmouseleave` 留在整行上——从箭头移到右边的「结束本轮」不会中途收起来，而指针从这一行的别处扫过也不会点亮
    - **版面模型：壳不动，动的是壳里的元素**。三部分各有自己的壳（`data-reveal-part="exit|divider|stop"`，flex 项，占的就是最终位置），壳本身不参与动画；未点亮时里面的元素往左挪 8px 待命、`opacity: 0`，点亮后 `translateX(0)` 并淡入。**全部动画只有 `transform` 与 `opacity`**——没有宽度 / margin 动画，也就没有 slider 那种「擦出来」的效果
    - **唯一的例外是「退出本轮」的文案**：它必须现量宽度（Svelte 过渡 `expandLabel`，宽度 0 → 自然宽度 ＋ 淡入），长出来的这点宽度会把后面两个壳一起推向右（`min-width: 0` 不能省——flex 项的 `min-width: auto` 会把宽度动画顶回去）
    - **三档透明度**：未点亮 → 只有箭头 100%（其余全 0）；点亮 → 箭头与「结束本轮」60%、分割线 100%；鼠标压在某颗按钮上 → 它自己 100%
    - **未点亮时两颗按钮都点不动**，但两条路的做法不同：分割线与「结束本轮」的壳是 `pointer-events: none`；箭头那颗的壳必须一直可命中（它就是触发区，拦了指针就 hover 不开），所以「未点亮不可点」判在它的 `onclick` 里。两处都用「不可点」而不是 `disabled`——后者会让键盘 Tab 不进来，而这条路的键盘入口正是 `focusin` 点亮
    - 节奏：`cubicOut` 进场 / `cubicIn` 退场（样式块里写成同值的 `cubic-bezier`），相邻 55ms 延迟。**进场从左往右**（文案 → 分割线 → 结束按钮），**退场反过来**（最后出现的先走、文案垫底）。所以每部分挂着两套延迟：`--reveal-delay-enter` / `--reveal-delay-leave`，别合并成一个。时长与间隔在脚本里定，再注入成 `--reveal-*` 变量给 CSS 用（数值只此一份）
    - `data-reveal-part` 必须打在本组件模板里的**壳元素**上：样式块是带作用域的，子组件（`Button` / `ConfirmActionButton`）渲染出来的 `<button>` 拿不到作用域类，选择器匹配不上（svelte-check 会报 Unused CSS selector）
    - tooltip 挂在**按钮自己**身上时，`{...props}` 必须排在 `onclick` 前面，而且 `ConfirmActionButton` 那侧要先用 `tooltipProps()` 把 trigger 属性里的 `onclick` 摘掉——它的 `{...restProps}` 排在自己的 `onclick` 之后，整包透进去会让按钮点不动
    - 别在 `<script>` 的注释里写「见文件末尾的 `<style>`」这种字面量：Svelte 解析器会把它当成真标签，报一句莫名其妙的「`<script>` was left open」（同一句话坑过一次，改说「样式块」）
    - `isCoarsePointer`（触屏）时直接常亮：没有 hover，压暗 / 藏起来就等于永远点不到「结束本轮」；键盘则靠 `focusin` / `focusout` 点亮（`data-revealed` 是这一行的抓手，测试也用它）
  - `MemoryHome`：首页（顶部是题库名大字），两个入口与统计卡都用现有 `Button` / `Card`。每种状态配一个水印图标（沿用 `QuestionArea` 空状态那种大图标 + `opacity-20 -z-1`）
    - **学习入口四态**（`learnableCount` 是否 > 0 × `session.learnedToday`）：
      | 状态 | 条件 | 外观 | 可点 |
      |---|---|---|---|
      | `due` | 还有得学，今天还没学过一轮 | `variant="default"`（黑底白字） | ✅ |
      | `extra` | 还有得学，今天已经学过一轮 | `variant="outline"`（白底） | ✅（点了就是再学一轮 / 加学） |
      | `done` | 没有新卡了，今天学过一轮 | `variant="ghost"` + `disabled` | ❌ |
      | `empty` | 没有新卡了，今天也没学 | `variant="ghost"` + `disabled` | ❌ |
    - **复习入口三态**（`reviewableCount` = 到期 + 待补连对）：有得复习 → 黑底可点；没有到期但还有复习中的卡 → 「今日已复习完」灰掉；连复习中的卡都没有 → 「没有到期的卡片」灰掉
    - 学习入口的提示：「接着上一轮 · 已掌握 X / Y」（续未完成的轮）／「还有 N 张没学完 · 这次 M 张」（新开一轮）／「今天已经学过一轮 · 还有 N 张没学完」（`extra`）
    - **可点击性**：学习入口的 `due` / `extra` 与复习入口的「待复习」可点，其余状态 `disabled`
    - **颜色**：可点击且今天还没学过 → `variant="default"`（`--primary` = 黑底白字）；学过一轮但还能加学 → `variant="outline"`（白底）；没得学 → `variant="ghost"` + `disabled`。**不要自己写黑底白字的 class**，颜色一律走 shadcn variant / 主题变量
  - `MemoryQuestionArea`：答题区，版式与单选题 `QuestionArea.svelte` 完全一致（题型图标 + 题号 + 复制 + `StreakIndicator` / 题干 / 底部按钮），只是**没有选项**、题干在「只展示题干」时放大（`text-2xl sm:text-3xl`，进入答案页回到 `text-lg`）。`StreakIndicator` 传 `readonly`：刷题模式那个「双击标记为已掌握」在记忆模式没有对应语义（掌握只能靠连对够次数毕业），接了 `onMaster` 只会把卡从本轮队列里静默丢掉
  - `MemoryStatsCards`：首页与总览共用的三张统计卡（第一张是四类数字 **未学习 / 学习中 / 复习中 / 已掌握**，加起来等于「共 N 张卡片」；另外两张是「今日待复习」=`reviewableCount`、「目前」= 学习中 + 复习中）
  - `MemoryProgressBar`：**只是 `ProgressBar` 的适配器**——把「本轮已完成 / 本轮总数」映射成
    `stats`（已完成 → `mastered`、剩下的算 `learning`），并传 `interactive={false}`（记忆模式不做聚焦放大）
    与 `rightValue`（记忆口径的右数字是总数，刷题是「进度范围末端」）。数字滚动动画、完成时的庆祝高亮、
    细条样式全部来自那一份 `ProgressBar`；学习轮用 `label` 传「3/5」，复习轮留空显示百分比
  - `MemoryHeatmapSection`：记忆模式热力图，**只是 `components/shared/HeatmapSection.svelte` 的包装**——
    它只负责「状态 → 颜色」（`未学习`+`学习中` = 灰、`复习中` = 橙→绿按 `(level-1)/graduateLevel` 插值、
    `已掌握` = 绿），折叠 / 网格 / tooltip / `aria-label` 都在共享外壳里（刷题模式那份包装同理）。
    `cells` 是函数而不是数组，为的是保留「收起时不计算」的懒加载
  - `MemoryFilterBar`：总览筛选栏，与 `ReviewFilterBar` 同构（图标 + 「展示卡片」+ 点线 + 搜索框 + 筛选按钮，展开后成组 ToggleGroup）；分组是「学习进度」与「复习进度」，筛选状态在 `src/features/memory/filters.ts`
  - `MemoryOverview`：总览，与 `ReviewView` 同构（标题左对齐 + 只有关闭按钮 / 三张统计卡 + 热力图 + `MemoryFilterBar` + **同一套虚拟列表**）；每行是「题干 + 复制按钮 + 一句话状态 + 题号」，**不放连对圆点指示器**（状态用文字表达），点热力图小方块会滚到对应卡片。那句状态文字本身是 `MemoryMasteryButton`（点两下「标熟」）
    - 列表直接复用 `components/review/QuestionListSection.svelte`：`withHeaders={false}`（记忆模式只有一种题型，不要那条 sticky 分组头）+ 一个 `row` snippet 画自己的行。**自定义行的根节点必须自己打 `data-review-question-id`**（虚拟滚动的跳转收敛靠它认「已挂载的行」）；用了 `row` 时列表不会去取 `QuizSession`（记忆模式没有 provide 它，硬取会抛错）
    - `QuestionGroup[].type` 在无头模式下没人读，但仍要给（`"memory"`）；结果为空时传 `[]`，列表据此显示 `emptyText`
    - 关闭总览要重置搜索词与筛选（与 `ReviewView` 同一段 `$effect`），否则下次打开会看到一份「少了半题库」的列表
- 总览列表每张卡只显示**一句话**状态：`未学习` / `学习中` / `已掌握`，复习中的直接写「今天复习」「明天复习」「N 天后复习」「逾期 N 天」，不再出现「复习中」这个词，也不显示轮次进度；最右侧显示题号（与刷题模式的 `QuestionCard` 一致）
- **总览里的状态文字是「标熟」按钮**（`MemoryMasteryButton`）：第一下只是确认态（绿底 `bg-success` + `text-success-foreground` 白字「标熟」，原状态文字 `invisible` 留在原地，「标熟」绝对定位盖上去——连点两下时按钮宽度不变），第二下才 `session.masterQuestion(id)`。已掌握的卡不给这个入口（终态，只留一句绿色的「已掌握」）。**这个功能只在总览里有**，答题区、热力图、设置面板都不放第二个入口
- **算「还有几天到期」必须用 `session.now`**（它带上调试的时间偏移），不要直接 `Date.now()`；同理 `this.now` 是 getter 而不是函数，生产路径每次现算 `Date.now() + debugOffset`，这样调试里「加一天」能对已挂载的会话立刻生效（不要把偏移捕获进闭包）
- `src/components/settings/MemorySettings.svelte`：与 `Settings.svelte` 同构，顺序设置直接复用 `QuestionOrder` 组件；掌握阈值用 `$lib/components/ui/slider`（**官方 shadcn-svelte 源码原样落地**，含 `slider-track` 那层横条，别自己重写）；最底部是快捷键说明
- 记忆题型的 `Input.svelte`：只负责答案卡片（按钮在 `MemoryQuestionArea` 的按钮区，与刷题模式的「提交答案 / 视作正确」同一位置）；**不显示「答案」标签**
- 答案多段的约定：`answer` 里一个换行符 `\n` = 一个段落（`splitAnswerParagraphs`，`src/quiz/types/memory/paragraphs.ts`），答题页与总览的 `Review.svelte` 都按段落渲染并留段间距（`my-3 first:mt-0 last:mb-0`）。Prompt 只要求 LLM 输出单个 `\n`，段间距由渲染层负责
- 答题区那一行（`MemoryView`）跟着内容流走，**不悬浮在顶部**：换行时不会盖住题干。两颗按钮平时压到 60%、悬停点亮并向右就位（见上）
- **答题区的动效**（`MemoryQuestionArea`）：
  - **题干字号用 `Tween`（`svelte/motion`）驱动，不用 CSS transition**：字号动画要与答案 slide 共用同一条缓动（`circOut`），而 CSS 的 `transition-timing-function` 只能写 cubic-bezier / steps / linear()，没法引用 JS 缓动函数。Tween 把 0–1 的进度写进 `--reveal`（`style:--reveal={textReveal.current}`），字号档位（`--question-font` / `--answer-font` + line-height + 字重）留在组件 `<style>` 里插值，`@media (width>=40rem)` 覆盖 sm 档——响应式断点不跑到 JS 里
  - **「换了一次展示」和「同一次展示内部」必须分开**：Tween 是组件状态，不像 CSS transition 那样按元素各算。组件用 `$effect.pre` 比对 `presentationSeq` / `showResult`：序号变了就 `textReveal.set(1, { duration: 0 })` 直接落位（在 DOM 更新前，免得新题先以小字号闪一帧），只有同一次展示里 `showResult` 翻转才 `.target = 0 | 1` 走 200ms。**不要**用题目 id 当分界：同一张卡被排回队尾时元素复用，「从小变大」的假动画就回来了
  - 答案卡片用 `in:slide`（只写 `in:`，没有 `out:`）滑入：高度一起动画，下方按钮是被平滑推下去而不是瞬移；`prefersReducedMotion` 时两条动画 duration 都是 0
  - 题干 + 答案区有 `min-h-64`（16rem）：一段答案之内的卡片展开时按钮完全不动，更长的答案才由 slide 推开
  - 注意：`<script>` 里不要出现字面量 `<style>` 之类的标签文本（哪怕写在 JS 注释里），Svelte 解析器会当成真标签并报「`<script>` was left open」
- 热力图的布局 class（`.heatmap-*` / `.dotted-leader` / `.filter-collapsible`）统一放在 `app.css`，刷题与记忆两个模式共用，不要再写第二份

### 进度导出 / 导入（v9）

`src/features/importExport.ts` 的 `FORMAT_VERSION = 9`；**有 `memory` 段就走记忆分支**（一张卡都没学过的记忆题库也算，否则第 10 项不会写出、导入时 `graduateLevel` / `roundTarget` 会被重置成默认值），没有才走原来的刷题分支（刷题在 v9 仍是 9 个元素）。`memory.retry` 与 `roundMastered` / `roundGoal` / `roundPoolIds` / `learningPool` 一样**不进备份**（都属于「本轮」这种短周期状态）；`memory.settings` 里那个 `lockRoundPool` 是设置，照常跟着备份走。

```
刷题：[version, questionCount, masteredBitmapHex, activePool[][], currentRound,
      filterTypeCode, settings[], ui[], masteredMistakesBitmapHex]

记忆：[version, questionCount, "", [], currentRound, 0, settings[], ui[], "", memoryPayload]
memoryPayload = [progress[][], memorySettings[], trailing]
```

- 前 9 项结构共用，记忆分支把刷题专属字段填空值；解码端按数组长度 9 / 10 区分两种模式
- **记忆分支不能碰刷题专属字段**：`masteredIds` / `filterType` 只在刷题分支里算。提前算 `getExportedMasteredIds()` 会让「题库里已不存在的旧 id」这类刷题侧的问题把记忆模式的导出一起带崩（旧数据 / 改过题库之后很常见）
- **压缩流必须读写并发**：`deflateRaw` / `inflateRaw` 用 `Promise.all([读, 写])`。写成「先 `await writer.write()` 再开始读」会在有背压的实现上**永久挂住**（Deno 的实现就是这样，浏览器同理），表现成「点了导出没反应」——`tests/importExport.test.ts` 里用带背压的替身流锁住了这个回归
- `progress` 每项：`[questionIndex, stateCode(0=learning / 1=reviewing / 2=mastered), level, streak, nextDue, lapses]`
- `memorySettings`：`[graduateLevel, roundTarget]`
- 解码端对 `nextDue` 用 `requireTimestamp` 校验（非负**安全整数**且不超过 `MAX_DUE_TIMESTAMP`）：只查 `Number.isInteger` 会放过 `1e30`，那会让卡片永不到期并渲染出「NaN 天后复习」
- `MIN_SUPPORTED_FORMAT_VERSION = 4`，解码端保留 v4–v9 的分支

### Prompt

- `src/features/bankPrompts.ts` 的 `BANK_PROMPTS`：`quiz` → `assets/prompts/quiz.md?raw`，`memory` → `assets/prompts/memory.md?raw`；`BANK_PROMPT_META` 提供菜单文案（「生成刷题题库」/「生成记忆题库」）
- 入口：只有题库列表导入菜单 →「复制 Prompt」子菜单（两个模式各一项）；记忆模式总览里没有复制入口
- 答案多段：Prompt 让 LLM 用**单个** `\n` 分段，段间距由渲染层负责（见上文 UI 小节的 `splitAnswerParagraphs`）
- Prompt 要求 LLM 输出 `mode` + `questions`；记忆模式可以省略 `type`。`mode` 必须显式写出，否则记忆题库会被当成刷题题库解析而失败

### 测试

**视图级冒烟（先看这一条）**

- `tests/viewSmoke.test.ts` — 真的把 `QuizView` / `MemoryView` 挂进 happy-dom 点一遍：
  两个模式的「点齿轮 / ⌘I 打开设置、弹窗里 ⌘I 不再切换、关闭按钮能关」、
  总览能打开且筛选面板能展开、活动池开关、**两个模式都有底部渐变遮罩**、
  按键答一题出「回答正确」、记忆模式开始一轮后进度条与自评出答案。
  它守的是**类型检查 / 单测 / 构建都看不见的那一类**：模板运行期抛异常。
  真实教训：`ShortcutHelp` 里两行快捷键同名撞了 `{#each}` 的 key，Svelte 抛
  `each_key_duplicate`，整个设置弹窗渲染失败，表现成「刷题模式设置打不开」，
  而当时 `check` / `test` / `build` 全绿。**改动共享外壳后请跑它。**
- `tests/ViewHarness.svelte` / `tests/ViewShellHarness.svelte` / `tests/SharedListHarness.svelte` /
  `tests/HeatmapHarness.svelte` / `tests/SettingsPrimitivesHarness.svelte` /
  `tests/MemoryOverviewHarness.svelte` / `tests/ToolbarIconButtonHarness.svelte` /
  `tests/ProgressBarHarness.svelte` — 组件测试外壳。写新的组件测试时照着抄：
  bits-ui 的 Tooltip / Dialog 需要 `Tooltip.Provider`，弹窗断言要在 `document.body` 上找。
- 注意两条环境事实：`<number-flow-svelte>` 是自定义元素，happy-dom 不会升级它，
  **数字文本读不到**（数值口径请断言 `aria-*`）；`color-mix()` 会被 happy-dom 的
  CSS 解析丢掉（要断言插值色得另想办法）。测试里**不要**依赖计时与随机
  （踩过：题库选项会打乱，写死「按 a 一定答对」会偶发失败）。

**共享层与配置**

- `tests/config.test.ts` — 快捷键注册表完整且不漏项、浮层层级变量存在且严格递增、
  **禁止再写裸 `z-[数字]`**（扫 `src/**`），以及层级只定义一次
- `tests/viewShell.test.ts` — 共享滚动外壳：遮罩只在可滚动时点亮、footer 跟着让位、
  工具栏滚轮转发、`data-main-scroll-viewport` 打在滚动容器上、回到顶部按钮只在需要时出现
- `tests/toolbarIconButton.test.ts` — 工具栏圆按钮：点击回调、`aria-expanded/pressed`，
  以及 **tooltip 的快捷键提示来自注册表**
- `tests/shortcutHelp.test.ts` — 快捷键说明表：**两行同名不许炸**（那条真事故的回归）、
  收起时不显示题目级分组、应用级那段的文案与按键都来自注册表
- `tests/settingsPrimitives.test.ts` — `SettingsDialog` / `SettingsSection` / `SettingNumberRow`：
  `label.for === input.id`、`bind:value` 双向、`onChange` 只由 `change` 触发、
  `class` 覆盖间距、`open` 双向（子 → 父的关闭也算）
- `tests/sharedList.test.ts` — 共享筛选栏（折叠态、勾选回传、`scopeApplied` 的图标与配色）
  与虚拟列表的**无分组头模式**（记忆模式不要那条 sticky 标题条）、自定义行、空态文案
- `tests/progressBar.test.ts` — 进度条：可交互形态的聚焦语义、非交互形态的
  `role="progressbar"` 数值、`label` / `rightValue` 覆盖、完成时的庆祝动效，以及记忆模式适配器的夹取
- `tests/globalSettingsActions.test.ts` — 音效 / 自动下一题的统一实现：落盘、提示文案、试听，
  且**两个 session 的可观察结果逐字一致**
- `tests/heatmapSection.test.ts` — 热力图：收起时不算格子（懒加载）、两个模式的状态 → 颜色映射、
  `aria-label` 里 id 只出现一次、点击跳转
- `tests/importProgressDialog.test.ts` / `tests/memoryOverview.test.ts` / `tests/memoryFilters.test.ts` —
  导入确认弹窗；记忆总览的「导出为新题库」（含只导出筛选结果）与「关闭后重置搜索 / 筛选」

**领域逻辑**

- `tests/memoryMode.test.ts` — 校验与总览模型
- `tests/memorySession.test.ts` — 两条流的状态流转、曲线、持久化
- `tests/memoryImportExport.test.ts` — 记忆进度的导出 / 导入 round-trip
- `tests/appShortcutsMemory.test.ts` — 记忆模式走**同一份**键盘分发：三档自评按键、答案页降级、`Esc` 退出本轮、⌘S / ⌘N 不再漏，以及输入框 / 对话框 / 交互目标的守卫
- `tests/globalSettingsShortcut.test.ts` — 全局设置快捷键：⌘⇧I 的键位识别（与 ⌘I / 裸 ⇧+I / ⌘⇧⌥I 区分）、打开对话框并 `preventDefault`、对话框里与输入法组词时不介入
- `tests/appShortcuts.test.ts` — 共用的窗口级快捷键派发；含「⌘⇧I 必须整套让给应用级处理」的回归（9 个选项时 `i` 正好是第 9 个选项的字母，拦不住会顺手选中并提交），以及「宿主没有的能力（活动池 / 会话）不该被误触发」
- `tests/syncNowShortcut.test.ts` — 同步快捷键 ⌘Y：键位识别、**关掉云同步时完全不碰按键**、
  接线到页头（按一下真的 `syncEngine.sync` / 红点是打开全局设置 / 跑着时是空操作）
- `tests/sync.test.ts` — 云同步纯逻辑：配置校验与掩码（令牌绝不能进云端）、压缩往返、
  **逐题库**三方合并（含删除 / 无基准 / 老格式兜底）、general 逐字段合并、冲突裁决、元数据净化
- `tests/syncSupport.ts` — 同步测试脚手架：内存 Gitee 替身 + **多设备 localStorage** + 可控时钟。
  装设备快照必须走 `writeLocal`（原始写入），否则每切一次设备就等于把所有键都"改"了一遍
- `tests/giteeClient.test.ts` — Gitee 客户端契约测试（用内存替身固化探针学到的请求形状与「只更新单文件」语义，不碰网络）
- `tests/syncShards.test.ts` — 分片收集：文件数永不超 10、题库一个不漏、片内命名正确
- `tests/syncEngine.test.ts` — **端到端**：真模块 + 内存替身 Gitee，跑「推送 → 拉取 → 双向覆盖 → 删除回收」，
  连状态行报的数字（`新增 N` / `题库没有改动`、云端题库数）一起钉住；
  「草稿令牌自检不写配置也不动状态」「按 id 删掉某条云端片段，不牵连配置里那条」
  「同步跑到一半时清空配置，在飞的请求不许把配置键写回来」（`patchConfig`）也在这一层；
  还有「关掉总开关后冲突状态清空且一个请求都不再发」「重新打开会把冲突重新报出来」
  「Gist 被删之后断开云端再同步会新建一条并把本地推上去」。
  替身 `FakeGitee.requests` 记录收到过的请求，专门用来断言「关掉之后没碰云端」
- `tests/syncTwoDevice.test.ts` — 双设备来回：A 推 → B 拉 → A 再导入 → B 能看到、
  删除双向传播、同片题库互不牵连、题库顺序、冲突裁决、打开页面自动对账。
  「同步看起来成功但本地纹丝未动」「新设备清空云端题库列表」这类 bug 就是它抓出来的
- `tests/syncIndicator.test.ts`（+ `tests/SidebarHarness.svelte`）— 页头那颗指示点与侧边栏那颗冲突点：
  关掉同步不显示（侧边栏那颗点也不显示，且引擎状态已清空）、没同步是黄的、
  同步成功变绿、本地一改立刻变黄、点一下就手动同步一次且**不弹提示**、
  **绿色也点得动**（点了同样同步一次：不弹提示、不打开设置、有 hover class）、
  **有冲突 / 报错时变红且点击是打开全局设置（不是再同步一遍）**、离线仍是黄的。
  引擎是模块级单例，`beforeEach` 里要把它重置成「刚打开页面」的样子（含 `pendingChanges`），
  并且要 `init()` / `dispose()` 成对——`dispose()` 会摘掉配置订阅
- `tests/syncStorageHealth.test.ts` — 本地存储探针与 iOS 兜底：正常 / 写不进去 / 写得进去但钩子
  不通知（含只通知一半）、引擎在 `silent` 时装兜底轮询且真能看出「本地脏了」、
  在 `blocked` 时 `inSync` 永远 false。
  模拟「钩子没生效」要用原型上的 `setItem.call(localStorage, …)`——直接 `proto.setItem(...)`
  会以原型为 `this` 而抛错，测出来是 `blocked` 而不是 `silent`
- `tests/time.test.ts` — 相对时间的分档（刚刚 / 秒 / 分钟 / 小时 / 天 / 超过一个月退回日期）、
  时钟回拨不显示负数、绝对时间给 title
- `tests/toast.test.ts` — 全局提示的状态机：自己消失（先淡出再从 DOM 拿掉）、悬停暂停、
  后一条顶掉前一条并重新计时、`dismiss()` 立刻收掉
- `tests/syncSummary.test.ts` — 「这一轮同步干了什么」这句话本身（纯函数）：
  只列非零项、新题库不算上传、四件都没发生就说「题库没有改动」、设置单独提一句
- `tests/syncSettings.test.ts`（+ `tests/SyncSettingsHarness.svelte`）— **组件级**：
  面板显示的东西必须跟引擎状态实时一致（Gist id 回填、云端数量、冲突列表、
  点「保存」后真的建出 Gist 并显示 id）；以及几条交互契约：
  「再次编辑：进来就自动测试连接，验过才出列表、保存才能点；改了令牌列表收起、
  保存重新变灰」「首次配置：没测通之前连保存按钮都不出现」「编辑态的自检信息
  不会漏进常规态的状态行」「目标仓库在标题旁且点它不会切开关」、
  「立即同步是主按钮、覆盖按钮收进更多设置」、
  「目标仓库卡片 = identicon + id + 时间 + 两边规模，点它不会切开关」
  「出错时卡片那行换成引擎的说明」、
  「片段行主信息是 id、不再显示文件数」、
  编辑态里试令牌**不落盘**（`reload()` 之后还是旧的）、清空配置把
  `quiz_app_sync_config` / `quiz_app_sync_meta` 两个键都删掉并关掉同步、
  列表每行的垃圾桶点两下才删且不顺手改选中项、同步完成的提示按四件事说。
  mount 组件需要两件事：
  `vite.config.ts` 在测试模式下加 `resolve.conditions: ["browser"]`（否则拿到 Svelte 的
  server 构建，`mount()` 直接报错），以及 `tests/_setup.ts` 里的 `element.animate` 替身
  （happy-dom 没有 Web Animations API，`transition:slide` 会炸）

## 约定

- 组件里通过 `useQuizSession()` 拿 session，链式访问 `session.appState.xxx` / `session.globalSettings.xxx`（**不要 destructure**，会切断 `$state` proxy reactivity）；记忆模式同理用 `useMemorySession()`
- 所有对 general 配置的增量修改走 `updateGeneralConfig(patch)`（读-改-写），不要自己拼整个对象覆盖
- 做题流里的持久化要容错（`saveState` / `saveDefaultSettings` / general 写入都只 warn）；导入题库这条路径需要能识别配额错误并回滚，所以 `saveGeneralConfig` 会抛异常
- 记忆模式的进度必须经 `MemorySession.save()`（内部走 `saveState`）落盘：`saveState` 会把 `memory` 段原样带出去，绕过它保存状态会丢掉记忆进度
- 一轮会话的队列状态（`shownIds` / `reviewTarget` / `reviewedIds` / `reviewTotal` / `failedThisRound`）只放 session 上，**不要**塞进 `RuntimeState`；确实需要跨会话的（只有 `reviewTarget` 的当天副本）走 `StoredState.memory.retry`：`saveState` 只序列化 `StoredState` 的字段，塞进 `RuntimeState` 的临时字段会在下一次保存时被丢掉
- 学习流里，卡片连对到门槛时会在 `submit()` 阶段就毕业并离开 `activePool`，所以 `advanceQuestionFlow()` 里 `activePool.find()` 查不到 = 已学会（`MemoryProgress` 已变成 `reviewing`），要按「毕业」处理并计入 `completed`；不要当成「没连够」
- `src/features/importExport.ts` 的 `FORMAT_VERSION` 每次 bump 都要保留旧版本的解码分支，并接受对应长度的紧凑数组
- 新增题库模式时按 `BankModeDef` 的五步注释执行（`src/quiz/modes/types.ts`）
