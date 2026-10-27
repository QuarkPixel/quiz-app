/**
 * 总览（刷题 / 记忆共用）的视图模型。
 *
 * 两个模式的总览以前是两份几乎逐行重复的组件：同样的 Dialog 外壳、同样的
 * 筛选栏 + 虚拟列表。差别只在「格子怎么上色、每行画什么」。现在这些差别收进
 * 两个适配器（`components/overview/QuizOverview.svelte` /
 * `MemoryOverview.svelte`），外壳只认这里的类型。
 *
 * **统计卡不在这里**：卡片里的数字与文案各模式完全不同，DOM 由
 * `MemoryOverviewCards.svelte` / `QuizOverviewCards.svelte` 各自手写（共用的是
 * 外层的 `OverviewCard`：底色、标题行、sticky）。以前试过「每张卡一个对象 +
 * 一个共用模板」，卡片里的字号 / 间距立刻跟原来走形——这类高度定制的版面不值得
 * 为省几十行去抽公共模板。
 *
 * 卡片文件**自己取数据**（`useMemorySession` / `useQuizSession`），所以这里只剩
 * 热力图格子这一种模型——没有「热力图配置对象」这种中间层。
 */

/** 热力图的一个小方块。 */
export interface HeatmapCell {
    id: string;
    /** 状态描述（**不要**自己带 id 前缀，无障碍标签由组件统一拼） */
    status: string;
    /** 纯色格子用它（Tailwind 类，如 `bg-success`） */
    className?: string;
    /**
     * 需要插值的格子用它：**只给颜色值**（如 `color-mix(…)`），不要写成
     * `background-color: …`。组件会把它塞进 `--cell-color` 再由
     * `bg-(--cell-color)` 取用——这样格子的背景色与其他样式互不干扰，
     * 也不会在 `style` 属性被重新序列化时丢掉（`color-mix` 会被某些
     * 样式解析器判成非法值而整条丢弃）。
     */
    color?: string;
}
