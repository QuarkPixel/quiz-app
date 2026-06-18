# Quiz! aPP.

一款基于间隔重复算法的刷题应用，帮助你高效记忆和掌握题目。支持判断题、单选题、多选题、填空题四种题型。

提供两种构建模式：

- **Library 模式**（默认）：浏览器内导入和管理多份题库，常规多文件构建。
- **Bundled 模式**：把题库在构建时打包进 HTML，一份题库一个单文件，便于分发和离线分享。

## 特性

- **间隔重复算法**：根据答题情况智能安排复习，答错的题目需要更多次正确才能掌握
- **四种题型**：支持判断题、单选题、多选题、填空题
- **双模式**：Library 模式管理多份题库；Bundled 模式打包成单文件分发
- **音效反馈**：Library 模式可开启答题与操作成功音效
- **答案预览**：一键浏览全部题目与正确答案，按题型分组展示，方便快速过一遍
- **进度持久化**：学习进度保存在浏览器 localStorage 中，每个题库独立
- **可调参数**：活动池大小、掌握所需正确次数等均可在设置中调整

## 快速开始

```bash
# 安装依赖
pnpm install

# Library 模式（默认）开发服务器：空壳应用，在浏览器里导入题库
pnpm dev

# Bundled 模式开发：默认使用 banks/questions.example.json
pnpm dev -- --bundled

# Bundled 模式开发，自定义题库路径
pnpm dev -- --bundled banks/questions.json

# 构建：Library 模式 → dist/index.html + assets
pnpm build

# 构建：Bundled 模式 → dist/bundled-<hash>.html
pnpm build -- --bundled
pnpm build -- --bundled path/to/questions.json

# 预览最近一次构建
pnpm preview

# 类型检查（Svelte-aware）
pnpm check
```

> `--bundled` 是 cli wrapper 的 flag，所以走 `pnpm` 脚本时仍建议前置 `--` 转发：`pnpm dev -- --bundled`。

### 两种模式怎么选

- **Library 模式**：日常使用、需要在不同题库间切换、想随时导入新题库——选这个。学习进度存浏览器，每份题库一份独立进度。
- **Bundled 模式**：发布给别人、希望离线打开就能用、题库体积大到担心浏览器存储限制——选这个。构建产物是 `dist/bundled-<hash>.html`，发邮件、丢 U 盘、传 GitHub Pages 都行。

两种模式的存储 key 都按题库哈希分（`quiz_app_state_<hash>`），所以**同一份 JSON 内容**在两种模式下的进度是互通的。

## 导入自定义题库

### Library 模式

直接在 UI 左侧栏点击「导入」按钮选择 JSON 文件即可。文件不会上传到任何服务器，只存在浏览器 localStorage 中。

如果浏览器存储空间不足（导入返回配额错误），可以改用 Bundled 模式把题库直接打包进 HTML。

### Bundled 模式

替换 `banks/questions.json`（或用 `--bundled path/to/your.json` 指定别的路径），然后 `pnpm build -- --bundled`。

### JSON 格式说明

题库是一个 JSON 数组，每个元素是一道题目。支持四种题型：

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
### 完整示例

完整示例见 [`banks/questions.example.json`](banks/questions.example.json)，内容如下：

```json
[
  { "id": "judgment_1", "type": "judgment", "question": "地球是太阳系中最大的行星。", "answer": false },
  { "id": "judgment_2", "type": "judgment", "question": "水的化学式是 H2O。", "answer": true },
  {
    "id": "single_1",
    "type": "single",
    "question": "以下哪个是 JavaScript 的包管理器？",
    "options": [ { "text": "pip" }, { "text": "npm" }, { "text": "cargo" }, { "text": "gem" } ],
    "answer": [1]
  },
  {
    "id": "single_2",
    "type": "single",
    "question": "光在真空中的传播速度约为多少？",
    "options": [ { "text": "3×10⁶ m/s" }, { "text": "3×10⁷ m/s" }, { "text": "3×10⁸ m/s" }, { "text": "3×10⁹ m/s" } ],
    "answer": [2]
  },
  {
    "id": "multiple_1",
    "type": "multiple",
    "question": "以下哪些是前端框架/库？",
    "options": [ { "text": "React" }, { "text": "Django" }, { "text": "Vue" }, { "text": "Flask" } ],
    "answer": [0, 2]
  },
  {
    "id": "multiple_2",
    "type": "multiple",
    "question": "以下哪些元素属于惰性气体？",
    "options": [ { "text": "氦 (He)" }, { "text": "氧 (O)" }, { "text": "氖 (Ne)" }, { "text": "氮 (N)" } ],
    "answer": [0, 2]
  },
  { "id": "blank_1", "type": "blank", "question": "取得进步", "answer": "make progress" },
  { "id": "blank_2", "type": "blank", "question": "平均而言（括号内容可选）", "answer": "on (an) average" },
  { "id": "blank_3", "type": "blank", "question": "生病（斜杠分支）", "answer": "fall ill/sick" },
  { "id": "blank_4", "type": "blank", "question": "得出结论（多动词可选）", "answer": "draw/reach/come to a conclusion" },
  { "id": "blank_5", "type": "blank", "question": "习惯于……（括号内词级替换）", "answer": "(be/get) used to" },
  { "id": "blank_6", "type": "blank", "question": "3 × 3 = ___，4 × 4 = ___（数字填空，两空）", "answer": ["9", "16"] },
  { "id": "blank_7", "type": "blank", "question": "联系某人（等号分支）", "answer": "contact/call sb = get in touch with sb" }
]
```

### 注意事项

1. **ID 必须唯一**：每道题目的 `id` 必须不同，否则会导致进度记录混乱
2. **索引从 0 开始**：`answer` 中的索引对应 `options` 数组的位置，第一个选项是 0
3. **JSON 格式要求**：确保 JSON 格式正确，可以使用在线 JSON 校验工具检查
4. **换行使用 `\n`**：题目内容中如需换行，使用 `\n` 转义字符
5. **Library 模式**导入后即时生效；**Bundled 模式**需要重新 `pnpm build -- --bundled`

### 进度重置

每份题库的进度可独立重置：打开应用，进入该题库，点击右下角设置图标 → 「重置进度」。

或者在浏览器开发者工具的 Console 中执行（替换 `<hash>` 为题库哈希）：

```javascript
localStorage.removeItem('quiz_app_state_<hash>')
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
- [vite-plugin-singlefile](https://github.com/nickreese/vite-plugin-singlefile) - 单文件打包

## License

MIT
