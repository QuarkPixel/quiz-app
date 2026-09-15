import { describe, expect, it } from "vitest";
import {
  createMemoryFilterState,
  describeMemoryScope,
  hasMemoryScope,
  type MemoryDueStatus,
  type MemoryFilterState,
  type MemoryLearningStatus,
} from "../src/features/memory/filters";

/**
 * 记忆模式总览「导出为新题库」的两个纯函数判定。
 *
 * 为什么单独守这两个：
 *   - `hasMemoryScope` 决定导出按钮显不显示，`describeMemoryScope` 决定导出题库名
 *     的后缀——它们是同一件事（这批卡是不是被挑过的）的两面，必须同一口径。
 *     写成 `searchTerm !== ""` 也说得通，但只敲一个空格就会被当成「筛选生效」：
 *     按钮亮起来、导出的题库名后面还挂着一条空空的「搜索：」，而列表其实一张没少。
 *   - 题库名会躺进侧边栏的题库列表，标签顺序必须是筛选栏里看到的顺序，
 *     否则用户按名字找不到自己刚导出的那一份（名字里写着「未学习+已掌握」
 *     而界面上是「已掌握 / 学习中 / 未学习」，读起来就是乱的）。
 */

/** 造筛选状态：集合的插入顺序故意与筛选栏顺序不同，用来验证输出不跟着插入顺序走 */
function filter(
  learning: MemoryLearningStatus[] = [],
  due: MemoryDueStatus[] = [],
): MemoryFilterState {
  return { learning: new Set(learning), due: new Set(due) };
}

describe("记忆模式：总览是否收窄了范围（导出按钮的显隐依据）", () => {
  it("空筛选 + 空搜索词：没有收窄", () => {
    const state = createMemoryFilterState();

    expect(hasMemoryScope(state, "")).toBe(false);
    // 导出题库名这时不该多出后缀——名字就是原题库名。返回非空串的话，
    // 侧边栏会多出一份叫「记忆题库 」这种带空尾巴的副本
    expect(describeMemoryScope(state, "")).toBe("");
  });

  it("只有空格组成的搜索词不算收窄（不能退回成 searchTerm !== \"\"）", () => {
    const state = createMemoryFilterState();

    expect(hasMemoryScope(state, "   ")).toBe(false);
    expect(describeMemoryScope(state, "   ")).toBe("");
    // 空白搜索词也不许在筛选描述里留下一条「搜索：」的空尾巴
    expect(describeMemoryScope(filter([], ["today"]), "\t ")).toBe("今天复习");
  });

  it("勾了筛选：按筛选栏的选项顺序拼中文标签，与勾选顺序无关", () => {
    // 界面上「学习进度」是 已掌握 / 学习中 / 未学习，「复习进度」是
    // 今天 / 明天 / 近期 / 以后；这里反着勾，描述仍要按界面顺序输出
    const state = filter(["unlearned", "mastered"], ["later", "today"]);

    expect(hasMemoryScope(state, "")).toBe(true);
    expect(describeMemoryScope(state, "")).toBe(
      "已掌握+未学习+今天复习+以后复习",
    );
  });

  it("搜索词以「搜索：」出现在筛选标签之后，并折成一行", () => {
    const state = filter(["learning"]);

    expect(hasMemoryScope(state, " foo ")).toBe(true);
    expect(describeMemoryScope(state, " foo ")).toBe("学习中+搜索：foo");
    // 换行 / 连续空格会把侧边栏那一行题库名撑断，统一压成一个空格
    expect(describeMemoryScope(createMemoryFilterState(), "  a \n b  ")).toBe(
      "搜索：a b",
    );
  });
});
