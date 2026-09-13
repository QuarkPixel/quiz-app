# 记忆模式（原「背诵模式」）实现交接文档

> **✅ 已完成（历史文档，归档保留）**：这份交接文档描述的工作已经落地。
> 全局改名完成（原「背诵 / recite」→ 现「记忆 / memory」），记忆模式已实现：
> 记忆作为第五种题型注册（`src/quiz/types/memory/`），答题流、总览、设置、进度导入导出、
> Prompt 全部复用刷题模式的组件与样式。
> **当前实现以代码和 `AGENTS.md` 的「记忆模式（memory）」章节为准**；下面的设计推演与
> §2.3 的「现状 → 新名字」对照表保留为历史记录。

> 收件人：下一位负责实现「记忆模式」的 AI。
> 本仓库当前只实现了**刷题模式**；「记忆模式」的解析、类型、总览、UI 分支已经**预留接口但未实现**。
> 本轮改动**故意没有**把代码里的命名改成新名字（见 §2），改名是你接手后的第一件事。

---

## 1. 背景与产品设想

应用：中文题库刷题应用，Svelte 5 + Vite + TypeScript。题库在浏览器导入 / 管理，学习进度存 localStorage。核心架构见 `AGENTS.md`。

目前唯一实现的题库模式是**刷题模式**（代码 `mode: "quiz"`）：题目带 `type` / `options` / `answer`，参与间隔重复算法。

产品想要新增第二个模式——**记忆模式**。原始设想（来自项目 owner，直接引用其描述）：

> 它可能只有一个 `id`，没有 `type`，只有 `question` 和 `answer`。因为主要就是背诵，不需要给你题目，看你是否记得，记得就选「记得」，不记得就选「不记得」。然后总览功能里显示的内容也和原来的不太一样，需要留好接口。

要点归纳：

1. 记忆模式的题目只有 `id` / `question` / `answer`（没有 `type` / `options`）。
2. 交互是**自评**，不是判分：看题目 → 看答案 → 选「记得」/「不记得」。
3. 总览（复习界面）的展示维度和刷题模式不同，需要单独的分组/统计接口。
4. **默认题型**：记忆模式下，所有题目的题型默认都是一个**特殊的题型**，这个题型专门用来实现记忆功能。
5. 记忆模式不参与刷题模式的间隔重复算法语义（是否复用部分算法由你决定，见 §6）。

---

## 2. 命名规范（重要，你先做这个）

### 2.1 产品名

- 新名字：**记忆模式**（memory）。
- 原名字：**背诵模式**。
- **刷题模式名称不变**，代码 `quiz` 不变。

### 2.2 为什么代码里还写着「背诵 / recite」

本轮重构只预留了接口，**没有改代码命名**。所以你会看到 `recite` / `ReciteQuestion` / `"背诵模式"` 这类遗留叫法。这是有意为之——请你在实现时统一改成「记忆 / memory」的命名，保证见名知意。

### 2.3 建议改名清单

| 现状（代码里写的） | 建议改为 |
|--------------------|----------|
| `BankMode` 的 `"recite"` | `"memory"` |
| `ReciteQuestion` | `MemoryQuestion` |
| `ReciteBank` | `MemoryBank` |
| `reciteModeDef` | `memoryModeDef` |
| `BANK_MODES.recite` | `BANK_MODES.memory` |
| 文案「背诵模式」 | 「记忆模式」 |
| 题库文件 `mode: "recite"` | `mode: "memory"` |
| 测试里的 `recite` 用例 | `memory` 用例 |

改名要连同：类型、变量、注释、错误文案、`assets/prompt.md`、`AGENTS.md`、`README.md`、测试一起改。

> 关于题库文件的 `mode` 取值：建议用 `"memory"`。理由是 `"recite"` 从未被真正接受过（导入时直接返回「尚未实现」），不存在需要兼容的存量数据。如果你决定改，请同时更新 `src/lib/bankFile.ts` 的 `readMode()`、`reciteModeDef.mode`、`AGENTS.md` 与本文件。

---

## 3. 现有 4 种题型与题型注册机制

刷题模式目前有 **4 种题型**：

- `judgment` 判断题
- `single` 单选题
- `multiple` 多选题
- `blank` 填空题

每种题型在 `src/quiz/types/<type>/` 下由 4 个文件组成：

- `logic.ts` — 纯逻辑，实现 `QuestionTypeLogic`（`validate` / `evaluateAnswer` / `formatAnswerText` / `formatCopyText` / `getCorrectChoiceLetters` / `getKeyboardAction`）
- `Input.svelte` — 答题 UI
- `Review.svelte` — 只读预览 UI
- `index.ts` — 合并 logic + icon + Input + Review，组成 `QuestionTypeDef`

注册位置：

- `src/quiz/types/registry-logic.ts` — 纯逻辑注册表（Node 侧可加载）
- `src/quiz/types/registry.ts` — 含 icon / Svelte 组件的完整注册表

**记忆模式要新增的那个特殊题型，应该沿用这套机制注册**（建议 id `memory`，中文名「记忆」）。它和现有 4 种题型的区别是：没有选项、没有「正确答案」判分，而是「记得 / 不记得」两种自评结果。具体要做：

1. `src/types.ts` 的 `QuestionType` union 增加该 id（例如 `"memory"`）。
2. 新增 `src/quiz/types/memory/`（logic + Input + Review + index）。
3. 在两个 registry 里注册。
4. 记忆模式的题目允许省略 `type`，解析时默认填成这个特殊题型（见 §4.3）。
5. 评估 `QuestionTypeLogic` 的各方法在记忆模式下的语义；可能需要扩展 `QuestionTypeLogic` / `QuestionInputProps` / `QuestionKeyboardContext`（例如自评按钮、看答案动作）。

> 注意：`validateQuizQuestions`（刷题模式的校验）要求每题有合法 `type`。记忆模式的校验 **不要复用它**，而是走模式自己的 `validateQuestions`（见 §4.2）。

---

## 4. 已经预留的接口清单（当前代码现状 + 你要做什么）

### 4.1 类型（`src/types.ts`）

已存在：

```ts
export type BankMode = "quiz" | "recite";          // → 改成 "quiz" | "memory"
export interface ReciteQuestion {                   // → MemoryQuestion
  id: string;
  question: string;
  answer: string;
}
export interface BankQuestionMap { quiz: Question; recite: ReciteQuestion; }
export type BankQuestionOf<M extends BankMode> = BankQuestionMap[M];
export type BankQuestion = BankQuestionMap[BankMode];
```

你要做：改名；如果最终确定题目字段不同（例如加 `hint`），直接改 `ReciteQuestion`/`MemoryQuestion`。

### 4.2 模式注册表（`src/quiz/modes/`）

- `types.ts` — `BankModeDef`：

  ```ts
  interface BankModeDef {
    readonly mode: BankMode;
    readonly label: string;                       // 显示名，目前 recite 是 "背诵模式" → "记忆模式"
    validateQuestions(raw: unknown): BankQuestionsValidation<BankQuestion>;
    buildOverview(questions, state): BankOverviewModel | null;   // 预留的总览接口
  }
  ```

- `quiz.ts` — `quizModeDef`，`validateQuestions` 委托给 `validateQuizQuestions`，`buildOverview` 返回 `null`（表示沿用 ReviewView 内置的题型分组）。
- `recite.ts` — `reciteModeDef` 占位：`validateQuestions` 直接返回 `{ ok:false, errors:["背诵模式尚未实现（解析接口已预留）。"] }`。
- `index.ts` — `BANK_MODES` 注册表。

你要做：

1. 改名 `recite.ts` → `memory.ts`、`reciteModeDef` → `memoryModeDef`、`label` 改成「记忆模式」。
2. 实现 `validateQuestions`：`questions` 非空数组；每题对象、`id` 非空字符串且唯一、`question`/`answer` 为字符串；返回 `{ ok: true, questions: MemoryQuestion[] }`。
3. `buildOverview` 返回记忆模式的总览模型（见 §4.7）。
4. `src/lib/bankFile.ts` 已按 `mode` 分发，**不需要改分发逻辑**，但要把 `"recite"` 字面量改成 `"memory"`。

### 4.3 统一解析（`src/lib/bankFile.ts`）

- `parseBankFile(raw)` / `parseBankFileJson(json)`：解析 `{ mode?, state?, questions }`，`mode` 默认 `"quiz"`，按 mode 分发校验，返回判别联合 `{ ok:true, mode, questions, state? }`。
- `formatBankFile({ mode, questions, state? })`：导出序列化。
- `readMode()` 当前接受 `"quiz" | "recite"`。
- 裸数组、缺 `questions`、非法 `mode`、`state` 非字符串都会报错。

你要做：mode 字面量改名；确认记忆模式题库能顺利通过 `BankStore.importBank`。

### 4.4 题库仓库（`src/source/`）

- `types.ts`：`QuizBank` / `ReciteBank` / `Bank = QuizBank | ReciteBank`（判别联合）、`BankSummary`（含 `mode`）、`QuizSource`。
- `bankStore.ts`：`BankStore`（唯一实现）。`importBank` 用 `parseBankFileJson` 解析、按 `questions` 算 hash、把 `mode` 写进 `library[].mode`；`getActiveBank()` 按 `summary.mode` 返回 `QuizBank` 或 `ReciteBank`；`exportBank` 用 `formatBankFile` 写出 `{ mode, state, questions }`。
- **hash 只覆盖 `questions` 数组**（不含 `mode` / `state`），所以 `mode` 改名不会影响进度 hash 兼容性。

你要做：`ReciteBank` → `MemoryBank`；其余逻辑基本可直接用。

### 4.5 根组件分支（`src/App.svelte`）

已有：

```svelte
const quizBank = $derived(activeBank?.mode === "quiz" ? activeBank : null);
const reciteBank = $derived(activeBank?.mode === "recite" ? activeBank : null);
```

`quizBank` → `<QuizView bank={quizBank} />`；`reciteBank` → 目前渲染一个「尚未实现」占位。

你要做：把占位替换成记忆模式的入口组件（例如 `ReciteView` / `MemoryView`，或让 `QuizView` 按 mode 分发）。

### 4.6 进度编码（`src/features/importExport.ts`）

- 编解码只依赖题目 `id`：`interface ProgressQuestion { id: string }`，所以刷题 / 记忆模式的题目都能直接传入。
- 当前 `FORMAT_VERSION = 8`，只编码按库设置 + UI + 掌握/活动池。

你要做：决定记忆模式的进度怎么存（见 §6）。如果要新增字段，**bump 版本号并保留旧版本解码分支**。

### 4.7 总览预留（`BankOverviewGroup` / `BankOverviewModel`）

```ts
interface BankOverviewGroup { key: string; label: string; questionIds: string[]; }
interface BankOverviewModel { groups: BankOverviewGroup[]; }
```

`ReviewView.svelte` 目前是刷题模式专用（按题型分组、显示掌握/活动/正确率等）。记忆模式的总览维度不同（例如按「记得 / 不记得 / 未复习」）。

你要做：

- 在 `memoryModeDef.buildOverview` 里返回记忆模式的分组模型；
- 在 `ReviewView.svelte` 或新建 `MemoryOverview.svelte` 里按 `bank.mode` 分支渲染。

### 4.8 Prompt（`src/features/bankPrompts.ts`）

- `BANK_PROMPTS: Partial<Record<BankMode, string>>` 目前只有 `quiz: quizPrompt`（`assets/prompt.md`）。
- `getBankPrompt(mode)` 返回对应 prompt。

你要做：新增 `assets/prompts/memory.md`（或沿用命名），注册 `BANK_PROMPTS.memory`；在 `Sidebar.svelte` 的「复制 Prompt」入口按模式提供（可以让用户二选一）。

期望的记忆模式题库结构：

```json
{
  "mode": "memory",
  "questions": [
    { "id": "m1", "question": "……", "answer": "……" }
  ]
}
```

### 4.9 设置

- **全局设置**（`GlobalSettings`：音效 / 选中自动提交 / 答对自动下一题）与题库无关，记忆模式直接复用。
- **按题库设置**（`BankSettings`：活动池大小 / 掌握次数 / 刷题顺序 / 新题预览）是刷题模式语义，记忆模式大概率**用不上或语义不同**。

你要做：决定记忆模式是否提供自己的按库设置段，以及存到哪里（`StoredState` 目前是刷题模式形状）。当前设置 UI 分两处：全局设置在侧边栏左下角（滑块图标），当前题库设置在答题界面右下角（齿轮图标）。

---

## 5. 建议实现顺序

1. **全局改名** `recite` → `memory`（类型、注册表、解析、source、文案、测试、文档）。
2. **新增记忆题型**（`src/quiz/types/memory/` + 两个 registry + `QuestionType` union）。
3. **实现 `memoryModeDef.validateQuestions`**：校验 `id` / `question` / `answer`，给缺省 `type` 填记忆题型。
4. **记忆模式答题流 / 会话 / 组件**：看题 → 展示答案 → 「记得」/「不记得」自评；设计好状态层（可参考 `src/quiz/session/QuizSession.svelte.ts` 的组织方式）。
5. **总览**：`buildOverview` + 按 mode 分支渲染。
6. **状态与进度**：决定 `StoredState` 复用还是扩展；如扩展，处理 `importExport` 版本。
7. **Prompt**：`assets/prompts/memory.md` + 注册 + UI 入口。
8. **测试**：见 §7。
9. **文档**：更新 `AGENTS.md` / `README.md`，本文件可删除或归档。

---

## 6. 需要你拍板的设计点（当前未定）

1. 记忆模式的进度语义：只记录「记得 / 不记得」的最终状态？还是也要复习轮次 / 间隔重复？
2. 是否复用 `StoredState.masteredIds` 表示「记得」？（`masteredMistakes` 等刷题语义字段大概率不适用。）
3. 记忆模式的总览维度：按「记得 / 不记得 / 未复习」？按批次 / 分组？
4. 特殊题型的准确 id 与中文名（建议 `memory` / 「记忆」）。
5. 题库文件 `mode` 值最终用 `"memory"` 还是别的。
6. 记忆模式是否需要「题型筛选 / 刷题顺序 / 活动池」这些按库设置（预计不需要）。
7. 「记得 / 不记得」是否要支持撤销、键盘快捷键、以及是否计入统计。

建议在动工前把这些先定下来（可以问项目 owner），再按 §5 推进。

---

## 7. 验收标准

- `pnpm verify`（check + test + build）全绿。
- 导入 `{ "mode": "memory", "questions": [{ "id": "m1", "question": "…", "answer": "…" }] }` 成功，侧边栏出现该题库，点进去进入记忆模式。
- 记忆模式答题流：看题 → 看答案 → 自评「记得 / 不记得」，状态能持久化、刷新后保留。
- 总览按记忆模式的口径展示。
- 导出 / 再导入该题库能往返（`exportBank` → `importBank`）。
- 新增测试至少覆盖：memory 模式解析校验、默认题型填充、答题流状态流转、进度 round-trip、总览分组。
- 旧命名残留检查：`grep -rniE "recite|背诵" src tests assets` 应为空（或仅在明确的兼容/迁移注释里）。

---

## 8. 参考

- `AGENTS.md` — 架构、存储布局、题库格式，以及「背诵模式接入指引」章节（内容与本文件重叠，实现时以本文件为准）。
- `README.md` — 用户视角的题库格式说明。
- 关键文件：`src/types.ts`、`src/lib/bankFile.ts`、`src/quiz/modes/`、`src/source/`、`src/App.svelte`、`src/quiz/types/`、`src/features/importExport.ts`。
