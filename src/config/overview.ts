/**
 * 总览窗口（刷题 / 记忆共用）的版面常量。
 *
 * 上半部分是「整排卡片（统计卡 + 热力图）」横着排的一条 rail，下半部分是筛选栏 + 虚拟列表。
 * 这里只放**跨模块**的数值：热力图每列几格、格子多大、rail 多高。
 * 只服务某一个组件的实现细节（比如 tooltip 的偏移）留在组件里。
 */

/**
 * 热力图小方块的边长（像素）——**看得见的那块**，也就是格子里那个 `div`。
 *
 * 鼠标的 hitbox 不是这个数：命中是按坐标算的（`floor(offset / stride)`），
 * 所以整片网格都是活的，鼠标落在两个方块中间也能命中最近的那一格。
 */
export const OVERVIEW_CELL_SIZE = 12;

/** 热力图小方块四周的留白（像素）：视觉上是间距，实际是格子的外边距。 */
export const OVERVIEW_CELL_GAP = 4;

/** 一个格子（含四周留白）占的方形边长：命中判定的步长，也是列与列的步长。 */
export const OVERVIEW_CELL_STRIDE = OVERVIEW_CELL_SIZE + OVERVIEW_CELL_GAP;

/**
 * 热力图每列几格。
 *
 * 由 `OVERVIEW_RAIL_HEIGHT` 反推，不是随手定的：
 *   卡片高 128 − 上下内边距 24 = 104
 *   104 − 标题行 16 − 标题与格子的间距 8 = 80
 *   5 行 × 16（`OVERVIEW_CELL_STRIDE`）= 80（**正好填满**，底部不会多出一条留白）
 * 最后一条很关键：多出来的几个像素会让格子到卡片下沿的距离比到左右两边大，
 * 看起来像「热力图没对齐」。改高度 / 格子尺寸 / 行数时必须一起重算
 * （`overviewRail.test.ts` 钉住了这条）。
 */
export const OVERVIEW_CELL_ROWS = 5;

/**
 * 顶部 rail 的高度（像素）。
 *
 * 三张统计卡与热力图卡片**必须一样高**——这是这套版面的全部意义：
 * 把原来竖着堆的「三张卡 + 一条热力图」压成一行，省出垂直空间给题目列表。
 *
 * 128 是让热力图「上下左右留白一样宽」反推出来的：
 *   卡片上下内边距 12×2 + 标题行 16 + 标题与格子的间距 8 + 格子区 80 = 128
 * 于是格子到左 / 右 / 下的距离都是 12px（见 `OVERVIEW_CELL_ROWS` 的注释）。
 */
export const OVERVIEW_RAIL_HEIGHT = 128;

/** 热力图左右各多渲染几列，避免快速滚动时边缘露白。 */
export const OVERVIEW_HEATMAP_BUFFER_COLUMNS = 3;

/** 横向还能滚动的距离小于这个值（像素）就不显示渐变遮罩——差几像素不值得提示。 */
export const OVERVIEW_RAIL_MIN_OVERFLOW = 8;

/** 热力图每列的高度：`rows` 个格子（每个都是 stride 见方）。 */
export const OVERVIEW_HEATMAP_HEIGHT = OVERVIEW_CELL_ROWS * OVERVIEW_CELL_STRIDE;
