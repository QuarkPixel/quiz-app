# 技术债清理（2026-10）

一轮针对「死代码 / 重复 / 分散」的重构。原则是**只做行为等价的搬迁与收口**，
每一处都能用 `pnpm check` + 现有测试验收；不确定语义的地方一律不动（见文末）。

## 1. 两个 Session 的公共骨架收进一个基类

**问题**：`QuizSession` 与 `MemorySession` 里有一批方法逐字相同——进度备份的
导出 / 读剪贴板 / 二次确认、复制题目的剪贴板出口与失败文案、音效 / 自动下一题
开关、以及三个「按钮闪一下再复原」的计时器。抄两份的真实代价不是行数，而是
**改一处忘一处**：记忆模式就漏过 ⌘N / ⌘S 两个键（`globalSettingsActions.ts` 的
注释记着这件事）。

**做法**：新增 `src/quiz/session/ProgressSessionBase.svelte.ts`，把上面这些收进去。
子类只回答四个问题：

| 抽象成员 | 作用 |
| --- | --- |
| `sessionHash` | 备份里校验是不是同一个题库 |
| `sessionQuestions` | 备份要带上题号顺序 |
| `sessionState` | 要导出的运行时状态 |
| `applyImportedState` | 把解析出的 `StoredState` 变成自己的运行时状态 |

`QuizSessionDeps` / `MemorySessionDeps` 保留为 `SessionDeps` 的类型别名，
调用方不用改。

**收益**：两个 Session 文件合计少约 290 行（公共部分变成 270 行的基类，每个模式不再
各留一份）；`copyQuestion` 只剩「取 typeDef + 给上下文 + 是否记按钮状态」三个差异，
重复的 try/catch 与文案只有一份。

## 2. 落盘状态只剩一个出口

- `MemorySession.save()` 原来手抄 9 个 `StoredState` 字段，现在整份交给
  `saveState`（内部有 `persistedState` 白名单），只覆盖 `round` 一项。
  以后 `StoredState` 加字段，记忆模式不会「悄悄不落盘」。
- `MemorySession` 里的 `createEmptyState()` 改为调用 `store.ts` 新导出的
  `createEmptyStoredState(settings?)`。默认 `StoredState` 的形状只此一处。

## 3. 进度编解码去重

`importExport.ts` 的刷题分支与记忆分支各自拼了一遍 `settings[]` / `ui[]` 数组，
也各自写了一遍 `JSON → deflate → base64 → ${hash}.…` 的收尾。现在统一为：

- `encodeBankSettings(settings)` —— 对应 `decodeBankSettings`，加字段只改一处；
- `encodeUiPreferences(ui)`；
- `compressToCode(hash, compact)` —— 导出的唯一收尾。

## 4. 快捷键提示回到单一来源

`SHORTCUTS.x.toUpperCase()` 这种「自己拼展示文案」的写法出现在 6 个组件里，
而 `APP_SHORTCUTS[x].kbd` 本来就是为此存在的（`⇧I` 这种多字符键只有它能表达对）。
全部改为读 `APP_SHORTCUTS`；`AppShell` 里硬编码的 `⌘+Y` 也改成读注册表。

## 5. 死代码

| 位置 | 内容 | 依据 |
| --- | --- | --- |
| `MemorySession.shownIds` + `markAsShown()` | 只写不读的状态（6 处赋值、1 处调用） | 全仓库无读取方；连对进度实际读 `currentPoolItem.consecutiveCorrect` |
| `registry.ts` | `getQuestionType()` / `listQuestionTypes()` | 零引用，各处直接用 `QUESTION_TYPES` |
| `registry-logic.ts` | `listQuestionTypesLogic()` | 零引用 |
| `userActivity.svelte.ts` | `import { toastStore }` | 未使用（`pnpm check` 报的） |

## 6. 类型护栏

`QUESTION_TYPES_LOGIC` 从 `Record<string, QuestionTypeLogic>` 收紧为
`Record<QuestionType, QuestionTypeLogic>`：`src/types.ts` 的题型 union 新增一个
id 时，这里少登记直接编译不过，而不是等用户点到那道题才 `undefined`。

## 7. 文档

- `AGENTS.md`：同步层模块表按实际文件重写（`merge.ts` 那一条其实描述的是
  `planner.ts` / `plan.ts` / `remote.ts` / `general.ts` 四个文件的内容）；
  新增 `ProgressSessionBase` 的说明与「两个模式共用的行为放这里」的约定。

## 有意不动的部分

这些看起来「重复 / 奇怪」，但都有语义或兜底理由，改动风险大于收益：

- **`round` 的两份（`appState.round` 与 `this.round`）**：看似可以收成一个
  getter，但「记错了」的回退路径会用 `preSubmitState`（submit 前的整份快照）
  覆盖 `appState`，那样会把本轮进度一起回退。现在靠 `save()` 唯一出口覆盖，
  已经是能拿到的最小风险形态。
- **同步层的合并算子 / 冲突整轮停手 / 设备本地字段两层剥离**：两轮审计修过
  7 个数据丢失级 bug 的承重墙。
- **`model/merge.ts` 与 `progressMerge.ts` 分家**：前者是后者的算子实现，
  拆开是为了让「进度合并」这件事有一个可读的入口文件，合并成一个 360 行的
  文件并不会更清楚。
- **`quiz/modes/index.ts` 的 `BANK_MODES`**：生产代码没消费，但它是「模式能力表」
  的落点，`tests/memoryMode.test.ts` 钉着；等第三个模式出现时才会用上。

## 验收

```bash
pnpm check        # 0 errors
pnpm vitest run tests/memorySession.test.ts tests/memoryImportExport.test.ts \
  tests/importExport.test.ts tests/quizSession.test.ts tests/store.test.ts \
  tests/memoryRound.test.ts tests/memoryMode.test.ts tests/config.test.ts \
  tests/appShortcuts.test.ts tests/memoryOverview.test.ts tests/memoryRouting.test.ts \
  tests/viewSmoke.test.ts
```
