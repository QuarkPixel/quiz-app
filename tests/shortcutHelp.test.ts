import { afterEach, describe, expect, it } from "vitest";
import { flushSync, mount, unmount } from "svelte";
import ShortcutHelp from "../src/components/settings/ShortcutHelp.svelte";
import { APP_SHORTCUTS, LISTED_SHORTCUTS } from "../src/config";

/**
 * 设置面板底部的「快捷键」表。
 *
 * 这个组件上出过一次真实事故：刷题模式的题目级按键被写成**两行同名**
 * （「选择 / 切换选项」出现两次），而那一行 `{#each}` 当时用 `row.label` 当 key，
 * Svelte 直接抛 `each_key_duplicate` —— 整个设置弹窗渲染不出来，
 * 表现成「点齿轮没反应」。svelte-check / vitest / build 三道关卡全绿。
 *
 * 所以这里守的第一条就是那个场景本身。
 */

const mounted: Array<() => void> = [];

function render(props: Record<string, unknown> = {}): HTMLElement {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const app = mount(ShortcutHelp, { target: host, props });
  flushSync();
  mounted.push(() => {
    void unmount(app);
    host.remove();
  });
  return host;
}

afterEach(() => {
  while (mounted.length > 0) mounted.pop()?.();
  document.body.innerHTML = "";
});

describe("题目级快捷键（调用方传入）", () => {
  it("两行同名不会让整个弹窗渲染失败", () => {
    const host = render({
      answerRows: [
        { label: "选择 / 切换选项", keys: ["A–Z"] },
        { label: "选择 / 切换选项", keys: ["1–9"] },
      ],
    });

    expect(host.textContent).toContain("A–Z");
    expect(host.textContent).toContain("1–9");
    expect(
      [...host.querySelectorAll("span")].filter(
        (span) => span.textContent?.trim() === "选择 / 切换选项",
      ),
      "两行都该在",
    ).toHaveLength(2);
  });

  it("没传题目级按键时不显示「答题」这个分组标题", () => {
    const host = render();

    expect(host.textContent).not.toContain("答题");
    // 但应用级那一段永远在
    expect(host.textContent).toContain("应用");
  });
});

describe("应用级快捷键（读注册表）", () => {
  it("说明面板里的每一条都来自注册表，文案与按键同源", () => {
    const host = render();

    for (const id of LISTED_SHORTCUTS) {
      const meta = APP_SHORTCUTS[id];
      expect(host.textContent, `缺少快捷键说明：${id}`).toContain(meta.label);
      // `⇧I` 这类要拆成两个 Kbd，所以按键是按字符比的
      for (const key of meta.kbd.split("")) {
        expect(host.textContent, `${id} 的按键 ${key} 没渲染`).toContain(key);
      }
    }
  });

  it("未列入清单的快捷键不出现（它们由各自的 UI 自己表达）", () => {
    const host = render();

    expect(host.textContent).not.toContain(APP_SHORTCUTS.togglePool.label);
    expect(host.textContent).not.toContain(APP_SHORTCUTS.sidebar.label);
  });
});
