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
    /** 状态描述（**不要**自己带 id 前缀，tooltip 里由组件统一拼成「id · 状态」） */
    status: string;
    /** 纯色格子用它（Tailwind 类，如 `bg-success`） */
    className?: string;
    /**
     * 需要插值的格子用它：**只给颜色值**（如 `color-mix(…)`），不要写成
     * `background-color: …`。
     *
     * 组件会把**所有出现过的颜色值去重**、编号成网格上的 `--heat-1..N`，
     * 格子自己只写 `background-color: var(--heat-k)`。于是 300 个格子共用
     * 那几条声明，而不是每人一条几十字符的 `color-mix(…)`；去重是每次从数据
     * 现算的，档位数（记忆模式的 `graduateLevel`、刷题模式的连对目标）改了
     * 立刻跟着变。
     *
     * 为什么不让格子直接写 `background-color: color-mix(…)`：`style` 属性会被
     * 样式解析器重新序列化，`color-mix()` 会被某些实现判成非法值整条丢掉。
     * `var()` 没有这个问题。
     */
    color?: string;
}
