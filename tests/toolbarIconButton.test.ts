import { afterEach, describe, expect, it, vi } from "vitest";
import { flushSync, mount, unmount } from "svelte";
import ToolbarIconButtonHarness from "./ToolbarIconButtonHarness.svelte";
import { APP_SHORTCUTS } from "../src/config";
import { modKeyLabel } from "../src/lib/platform";

/**
 * 底部工具栏上的圆图标按钮（设置 / 总览 / 活动池）。
 *
 * 两个模式共用这一份。它守的第一条是用户提过的那个缺口：**tooltip 里的快捷键提示
 * 必须来自 `@/config` 的注册表**——以前两个视图各写一遍按钮，记忆模式那份就没有
 * 提示，而按键其实是能用的。第二条是无障碍状态（`aria-expanded` / `aria-pressed`）
 * 别在抽取时丢掉。
 */

const mounted: Array<() => void> = [];

function render(props: Record<string, unknown> = {}) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const app = mount(ToolbarIconButtonHarness, {
    target: host,
    props: { ...props, onclick: props.onclick ?? (() => {}) },
  });
  flushSync();
  mounted.push(() => {
    void unmount(app);
    host.remove();
  });
  const button = host.querySelector<HTMLButtonElement>("button");
  if (!button) throw new Error("没有渲染出按钮");
  return { host, button };
}

/** bits-ui 的 Tooltip 在 hover / focus 后打开，内容走 portal 挂到 body 上 */
async function tooltipText(button: HTMLElement): Promise<string> {
  button.dispatchEvent(
    new PointerEvent("pointerenter", { bubbles: true, pointerType: "mouse" }),
  );
  button.dispatchEvent(
    new PointerEvent("pointermove", { bubbles: true, pointerType: "mouse" }),
  );
  button.focus();
  flushSync();

  let text = "";
  await vi.waitFor(() => {
    text =
      document
        .querySelector('[data-slot="tooltip-content"]')
        ?.textContent?.replace(/\s+/g, " ")
        .trim() ?? "";
    expect(text, "tooltip 没出现").not.toBe("");
  });
  return text;
}

afterEach(() => {
  while (mounted.length > 0) mounted.pop()?.();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("工具按钮", () => {
  it("点击触发回调，并带上无障碍标签", () => {
    const onclick = vi.fn();
    const { button } = render({ label: "当前题库设置", onclick });

    expect(button.getAttribute("aria-label")).toBe("当前题库设置");
    button.click();

    expect(onclick).toHaveBeenCalledOnce();
  });

  it("tooltip 的快捷键提示来自注册表", async () => {
    const { button } = render({
      label: "当前题库设置",
      shortcut: "toggleSettings",
    });

    const text = await tooltipText(button);

    expect(text).toContain("当前题库设置");
    expect(text, "缺少修饰键").toContain(modKeyLabel);
    expect(text, "缺少注册表里的按键").toContain(
      APP_SHORTCUTS.toggleSettings.kbd,
    );
  });

  it("没传 shortcut 的按钮不显示按键提示", async () => {
    const { button } = render({ label: "无快捷键的按钮" });

    const text = await tooltipText(button);

    expect(text).toBe("无快捷键的按钮");
    expect(text).not.toContain(modKeyLabel);
  });

  it("tooltip 文案可以被覆盖（活动池那颗是「收起 / 展开活动池」）", async () => {
    const { button } = render({
      label: "查看活动池",
      tooltip: "收起活动池",
    });

    expect(button.getAttribute("aria-label"), "无障碍标签保持固定").toBe(
      "查看活动池",
    );
    expect(await tooltipText(button)).toBe("收起活动池");
  });

  it("展开态 / 按下态如实写进 aria", () => {
    const expanded = render({ label: "设置", expanded: true });
    expect(expanded.button.getAttribute("aria-expanded")).toBe("true");

    const pressed = render({ label: "活动池", pressed: true });
    expect(pressed.button.getAttribute("aria-pressed")).toBe("true");

    const idle = render({ label: "活动池" });
    expect(idle.button.getAttribute("aria-pressed")).toBeNull();
  });
});
