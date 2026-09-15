import { afterEach, describe, expect, it, vi } from "vitest";
import { flushSync, mount, unmount } from "svelte";
import SharedListHarness from "./SharedListHarness.svelte";
import type { FilterGroupDef } from "../src/components/shared/FilterBar.svelte";
import type { QuestionGroup } from "../src/components/review/virtualList/types";
import type { Question } from "../src/types";

/**
 * 两个模式共用的筛选栏外壳，以及虚拟列表的「无分组头」模式。
 *
 * 这两块都是这轮为了去重/复用才出现的**新契约**：
 *   - 筛选栏：分组由调用方给，右侧附加内容（导出按钮 / 结果数）走 `actions`；
 *     `scopeApplied` 决定按钮变绿、图标换成 spark —— 用户靠它判断
 *     「我现在看到的列表是筛过的」，忘了传就会出现「筛了却没有任何提示」。
 *   - 虚拟列表：记忆模式只有一种题型，明确不要那条 sticky 分组标题条，
 *     所以有了 `withHeaders=false`；而自定义行（`row`）是记忆模式画
 *     「状态 + 题号」的入口，传了它就不该再渲染刷题模式的卡片。
 */

const mounted: Array<() => void> = [];

function render(props: Record<string, unknown>) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const app = mount(SharedListHarness, { target: host, props });
  flushSync();
  mounted.push(() => {
    void unmount(app);
    host.remove();
  });
  return host;
}

function question(id: string): Question {
  return {
    id,
    type: "judgment",
    question: `题 ${id}`,
    answer: true,
  };
}

function group(ids: string[]): QuestionGroup[] {
  return [
    { type: "judgment", items: ids.map((id) => ({ question: question(id), indicator: null })) },
  ];
}

function makeGroups(onChange: (values: string[]) => void): FilterGroupDef[] {
  return [
    {
      label: "学习进度",
      values: [],
      onChange,
      items: [
        { value: "mastered", label: "已掌握" },
        { value: "learning", label: "学习中" },
      ],
    },
  ];
}

afterEach(() => {
  while (mounted.length > 0) mounted.pop()?.();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("筛选栏外壳", () => {
  it("筛选按钮切换展开态（收起 / 展开是 class 驱动，内容始终在 DOM 里）", () => {
    const host = render({
      kind: "filter",
      groups: makeGroups(() => {}),
      showActions: true,
    });
    const button = host.querySelector<HTMLElement>('button[aria-label="筛选"]')!;
    const panel = host.querySelector<HTMLElement>(".filter-collapsible")!;

    expect(button.getAttribute("aria-pressed")).toBe("false");
    expect(panel.classList.contains("expanded")).toBe(false);
    // 折叠靠 CSS（`.filter-collapsible` 的高度动画），所以内容一直在 DOM 里——
    // 断言「DOM 里没有」会得到假的结论
    expect(host.textContent).toContain("学习进度");

    button.click();
    flushSync();

    expect(button.getAttribute("aria-pressed")).toBe("true");
    expect(panel.classList.contains("expanded")).toBe(true);
    expect(host.querySelector('[data-testid="actions"]')).not.toBeNull();
  });

  it("勾选分组把新的值交给调用方", () => {
    const onChange = vi.fn();
    const host = render({ kind: "filter", groups: makeGroups(onChange) });

    host.querySelector<HTMLElement>('button[aria-label="筛选"]')!.click();
    flushSync();
    host.querySelector<HTMLElement>('button[aria-label="已掌握"]')!.click();
    flushSync();

    expect(onChange).toHaveBeenCalledWith(["mastered"]);
  });

  it("scopeApplied 时按钮变绿并换成「已筛选」图标", () => {
    const plain = render({ kind: "filter", groups: makeGroups(() => {}) });
    const filterButton = plain.querySelector<HTMLElement>(
      'button[aria-label="筛选"]',
    )!;
    expect(filterButton.className).not.toContain("text-success");

    const applied = render({
      kind: "filter",
      groups: makeGroups(() => {}),
      scopeApplied: true,
    });
    const appliedButton = applied.querySelector<HTMLElement>(
      'button[aria-label="筛选"]',
    )!;
    expect(appliedButton.className).toContain("text-success");
    // 图标也要换（filter-2 → filter-2-spark）：比对两个 svg 的实际内容，
    // 只要还是同一个图标就说明条件写错了
    expect(appliedButton.querySelector("svg")!.innerHTML).not.toBe(
      filterButton.querySelector("svg")!.innerHTML,
    );
  });
});

describe("虚拟列表：无分组头模式", () => {
  it("withHeaders=false 时不渲染那条 sticky 分组标题条", () => {
    const withHeaders = render({
      kind: "list",
      grouped: group(["a", "b"]),
      withHeaders: true,
    });
    expect(withHeaders.textContent).toContain("判断题");

    const headerless = render({
      kind: "list",
      grouped: group(["a", "b"]),
      withHeaders: false,
    });
    expect(headerless.textContent, "不该出现题型名").not.toContain("判断题");
    expect(headerless.textContent).toContain("自定义行：a");
  });

  it("传了 row 就渲染调用方的行，并且高亮状态跟着 highlightId 走", () => {
    const host = render({
      kind: "list",
      grouped: group(["a"]),
      withHeaders: false,
    });

    const rows = host.querySelectorAll('[data-testid="custom-row"]');
    expect(rows).toHaveLength(1);
    expect(rows[0].getAttribute("data-highlight")).toBe("false");
  });

  it("列表为空时用调用方给的空态文案", () => {
    const host = render({
      kind: "list",
      grouped: [],
      emptyText: "当前筛选条件下没有卡片",
    });

    expect(host.textContent).toContain("当前筛选条件下没有卡片");
  });
});
