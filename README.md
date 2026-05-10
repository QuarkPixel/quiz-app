# Quiz! app

一款基于间隔重复算法的刷题应用，帮助你高效记忆和掌握题目。支持判断题、单选题、多选题、填空题四种题型。

构建后生成单个 HTML 文件，方便分享和离线使用。

## 特性

- **间隔重复算法**：根据答题情况智能安排复习，答错的题目需要更多次正确才能掌握
- **四种题型**：支持判断题、单选题、多选题、填空题
- **答案预览**：一键浏览全部题目与正确答案，按题型分组展示，方便快速过一遍
- **进度持久化**：学习进度保存在浏览器 localStorage 中
- **单文件部署**：构建产物为单个 HTML 文件，易于传输，随时随地可刷题
- **可调参数**：活动池大小、掌握所需正确次数等均可在设置中调整

## 快速开始

```bash
# 安装依赖
npm install

# 开发模式
npm run dev

# 构建生产版本（生成 dist/index.html）
npm run build

# 预览生产版本
npm run preview
```

## 导入自定义题库

题库存储在 `assets/questions.json` 文件中。替换此文件即可使用自己的题库。

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
| `question` | string | 中文提示（展示给用户） |
| `answer` | string | 英文答案（用于比对） |

填空题答案支持以下语法，系统会自动宽松匹配：

| 语法 | 含义 | 示例 |
|------|------|------|
| `(xxx)` | 括号内容可选 | `on (an) average` → 写不写 `an` 都算对 |
| `A/B` | 斜杠两侧任选其一 | `fall ill/sick` → `fall ill` 或 `fall sick` 均可 |
| `(A/B)` | 括号内词级替换 | `(be/get) used to` → `be used to` 或 `get used to` |
| 全角符号 | 自动转半角 | `（an）`、`／` 与半角等价 |

匹配时忽略大小写、空格和标点，只比较英文字母。斜杠分支支持共享前缀/后缀，例如 `draw/reach/come to a conclusion`，输入 `draw conclusion` 也会被判为正确（宽松原则：存在合理解读即算对）。

### 完整示例

完整示例见 [`assets/questions.example.json`](assets/questions.example.json)，内容如下：

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
  { "id": "blank_1", "type": "blank", "question": "取得进步", "answer": "make progress" }
]
```

### 注意事项

1. **ID 必须唯一**：每道题目的 `id` 必须不同，否则会导致进度记录混乱
2. **索引从 0 开始**：`answer` 中的索引对应 `options` 数组的位置，第一个选项是 0
3. **JSON 格式要求**：确保 JSON 格式正确，可以使用在线 JSON 校验工具检查
4. **换行使用 `\n`**：题目内容中如需换行，使用 `\n` 转义字符
5. **替换后重新构建**：修改 `assets/questions.json` 后需要重新运行 `npm run build`

### 进度重置

如果更换了题库，建议清除浏览器中的学习进度：

1. 打开应用
2. 点击右上角设置图标
3. 点击「重置进度」按钮

或者在浏览器开发者工具的 Console 中执行：

```javascript
localStorage.removeItem('quiz-state')
```

## 算法说明

应用使用间隔重复算法来安排题目的复习，灵感来源于[不背单词](https://www.bbdc.cn/)。

- **活动池**：同时学习的题目数量（默认 25 题）
- **掌握条件**：
  - 从未答错：连续答对 1 次即掌握
  - 曾经答错：连续答对 5 次才能掌握
- **选题策略**：优先选择距离上次回答轮次较远的题目，避免连续重复

这些参数可以在应用设置中调整。

## 技术栈

- [Svelte 5](https://svelte.dev/) - 前端框架
- [Vite](https://vitejs.dev/) - 构建工具
- [TypeScript](https://www.typescriptlang.org/) - 类型系统
- [vite-plugin-singlefile](https://github.com/nickreese/vite-plugin-singlefile) - 单文件打包

## License

MIT
