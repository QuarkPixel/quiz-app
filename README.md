# Quiz! aPP.

一款基于间隔重复算法的刷题应用，帮助你高效记忆和掌握题目。支持判断题、单选题、多选题、填空题四种题型。

应用是一个「空壳」：题库在浏览器里导入和管理，多份题库互相独立，学习进度保存在本地 localStorage，不会上传到任何服务器。

## 特性

- **间隔重复算法**：根据答题情况智能安排复习，答错的题目需要更多次正确才能掌握
- **四种题型**：支持判断题、单选题、多选题、填空题
- **多题库管理**：导入、重命名、排序、删除多份题库，随时切换
- **全局 + 按题库设置**：音效 / 选中自动提交 / 答对自动下一题是全局设置；活动池大小、掌握次数、刷题顺序等跟着题库走
- **总览**：一键浏览答题统计、题目状态与正确答案，按题型分组展示，方便快速过一遍
- **进度持久化与备份**：进度存浏览器 localStorage，每份题库独立；可导出 / 导入紧凑进度串，也可整库导出 JSON
- **PWA / 移动端友好**：可安装到桌面，适配手机

## 快速开始

```bash
# 安装依赖
pnpm install

# 开发服务器
pnpm dev

# 构建 → dist/index.html + assets
pnpm build

# 预览最近一次构建
pnpm preview

# 类型检查（Svelte-aware）
pnpm check

# 跑测试
pnpm test
```

## 导入自定义题库

在 UI 左侧栏点击「导入」按钮，可以从 JSON 文件或剪贴板导入。文件不会上传到任何服务器，只存在浏览器 localStorage 中。

如果浏览器存储空间不足，导入会提示配额错误；可以删除不用的题库后重试。

## 题库格式

一份题库是一个 JSON **对象**（不再支持裸数组）：

```json
{
  "mode": "quiz",
  "state": "……可选的进度备份……",
  "questions": [ /* 题目数组，必需 */ ]
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `questions` | array | 必需，题目数组，见下方题型说明 |
| `mode` | string | 可选，题库模式。目前支持 `"quiz"`（刷题模式，默认）；`"recite"`（背诵模式）接口已预留但尚未实现 |
| `state` | string | 可选，由本应用导出的进度备份编码。给 LLM 的生成题库 Prompt 不需要输出它 |

> 让 AI 生成题库时，直接复制侧边栏导入菜单里的「复制「给 LLM 的生成题库 Prompt」」，把题目内容附在后面即可。Prompt 只要求输出 `questions`。

### 刷题模式（quiz）

`questions` 是一个数组，每个元素是一道题目，支持四种题型。

#### 1. 判断题 (judgment)

```json
{
  "id": "judgment_1",
  "type": "judgment",
  "question": "这是一道判断题的题目内容",
  "answer": true
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | string | 题目唯一标识，建议格式：`judgment_序号` |
| `type` | string | 固定为 `"judgment"` |
| `question` | string | 题目内容 |
| `answer` | boolean | 正确答案，`true` 或 `false` |

#### 2. 单选题 (single)

```json
{
  "id": "single_1",
  "type": "single",
  "question": "这是一道单选题的题目内容",
  "options": [
    { "text": "选项 A" },
    { "text": "选项 B" },
    { "text": "选项 C" },
    { "text": "选项 D" }
  ],
  "answer": [0]
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | string | 题目唯一标识，建议格式：`single_序号` |
| `type` | string | 固定为 `"single"` |
| `question` | string | 题目内容，支持换行符 `\n` |
| `options` | array | 选项数组，每个选项包含 `text` 字段 |
| `answer` | number[] | 正确答案的索引数组（从 0 开始），单选题只有一个元素 |

#### 3. 多选题 (multiple)

```json
{
  "id": "multiple_1",
  "type": "multiple",
  "question": "这是一道多选题的题目内容",
  "options": [
    { "text": "选项 A" },
    { "text": "选项 B" },
    { "text": "选项 C" },
    { "text": "选项 D" }
  ],
  "answer": [0, 2]
}
```

格式与单选题相同，区别在于 `answer` 数组可以包含多个索引。

#### 4. 填空题 (blank)

```json
{
  "id": "blank_1",
  "type": "blank",
  "question": "取得进步",
  "answer": "make progress"
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | string | 题目唯一标识，建议格式：`blank_序号` |
| `type` | string | 固定为 `"blank"` |
| `question` | string | 提示内容（展示给用户） |
| `answer` | string \| string[] | 答案。为 `string` 时展示单个输入框；为 `string[]` 时按元素数量展示多个输入框，每空逐一匹配对应答案 |

填空题答案支持以下语法，系统会自动宽松匹配：

| 语法 | 含义 | 示例 |
|------|------|------|
| `(xxx)` | 括号内容可选 | `on (an) average` → 写不写 `an` 都算对 |
| `A/B` | 斜杠两侧任选其一 | `fall ill/sick` → `fall ill` 或 `fall sick` 均可 |
| `(A/B)` | 括号内词级替换 | `(be/get) used to` → `be used to` 或 `get used to` |
| `A=B` | 等号两侧任选一套完整答案 | `contact/call sb = get in touch with sb` → `contact sb`、`call sb` 或 `get in touch with sb` 均可 |
| 全角符号 | 自动转半角 | `（an）`、`／`、`＝` 与半角等价 |

匹配时忽略大小写、空格和标点，保留字母、数字和中文进行比对。等号优先级高于斜杠，会先把答案拆成多套完整答案；每套内部仍按斜杠和括号规则匹配。斜杠分支支持共享前缀/后缀，例如 `draw/reach/come to a conclusion`，输入 `draw conclusion` 也会被判为正确。

常见占位词（用户可不输入）：`sb`、`sth`、`sb's`、`one's`、`oneself`、`doing`、`to do`。

### 背诵模式（recite，预留）

`mode: "recite"` 目前导入会返回「背诵模式尚未实现」的错误。接口（解析、类型、总览、UI 分支）已经预留，见 `AGENTS.md`。

### 完整示例

完整示例见 [`banks/questions.example.json`](banks/questions.example.json)。

### 注意事项

1. **ID 必须唯一**：每道题目的 `id` 必须不同，否则会导致进度记录混乱
2. **索引从 0 开始**：`answer` 中的索引对应 `options` 数组的位置，第一个选项是 0
3. **JSON 格式要求**：确保 JSON 格式正确，最外层必须是 `{ "questions": [...] }` 对象
4. **换行使用 `\n`**：题目内容中如需换行，使用 `\n` 转义字符

## 设置

设置分两层，分布在两个入口：

- **全局设置**（跨题库共享）：音效、选中答案自动提交、答对自动下一题。
  入口在**侧边栏左下角**（滑块图标）。没有题库时也能修改。
- **当前题库设置**（跟着题库走）：题型筛选、刷题顺序、新题入池时预览、活动题目池大小、掌握所需正确次数。
  入口在答题界面**右下角的齿轮图标**。

按题库设置的默认模板（「default settings」）会保存在 general 配置里：调整当前题库的设置时，默认模板同步更新，新导入的题库会继承它。

## 进度重置

每份题库的进度可独立重置：打开应用，进入该题库，点击右下角设置图标 → 「重置所有进度」。

或者在浏览器开发者工具的 Console 中执行（替换 `<hash>` 为题库哈希）：

```javascript
localStorage.removeItem('quiz_app_state_<hash>')
```

## 本地存储布局

```
quiz_app_general               唯一的 general 配置：
                               { activeBank, defaultSettings, library, globalSettings }
quiz_app_questions_<hash>      某份题库的题目数组 JSON
quiz_app_state_<hash>          某份题库的进度 + 按库设置 + UI 偏好
```

## 算法说明

应用使用间隔重复算法来安排题目的复习，灵感来源于[不背单词](https://www.bbdc.cn/)。

- **活动池**：同时学习的题目数量（默认 25 题）
- **掌握条件**：
  - 从未答错：连续答对 3 次即掌握
  - 曾经答错：连续答对 4 次才能掌握
- **选题策略**：优先选择距离上次回答轮次较远的题目，避免连续重复

这些参数可以在应用设置中调整。

## 技术栈

- [Svelte 5](https://svelte.dev/) - 前端框架
- [Vite](https://vitejs.dev/) - 构建工具
- [TypeScript](https://www.typescriptlang.org/) - 类型系统
- [shadcn-svelte](https://shadcn-svelte.com/) - UI 组件

## License

MIT
