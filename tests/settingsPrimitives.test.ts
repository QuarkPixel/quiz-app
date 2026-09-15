import { afterEach, describe, expect, it } from "vitest";
import { flushSync, mount, tick, unmount } from "svelte";
import SettingsPrimitivesHarness from "./SettingsPrimitivesHarness.svelte";

/**
 * 三个共享设置基元的组件测试：`SettingsDialog` / `SettingsSection` / `SettingNumberRow`。
 *
 * 为什么值得单独守：它们是从「当前题库设置」和「记忆模式设置」两个面板里抽出来的，
 * 一旦回归就是**两个面板一起坏**，而且坏法都很安静：
 *   - `bind:value` / `bind:open` 断掉 —— 面板看着照常，改动就是不落盘 / 关不干净；
 *   - `Label` 的 `for` 与 `Input` 的 `id` 对不上 —— 点标签没反应，纯无障碍回归，
 *     类型检查、截图、点按钮的冒烟测试全都看不出来；
 *   - `onChange` 挂到 `input` 上 —— 每敲一个字符写一次设置；
 *   - `SettingsSection` 的间距被统一成一个值 —— 四个调用点的视觉一起变。
 * 每个用例都写清「它守的是哪条回归」，其余一概不测（框架行为、样式细节不在其中）。
 */

/** 外壳的 props（与 SettingsPrimitivesHarness.svelte 的 Props 一致）。 */
interface HarnessProps {
    kind: "number-row" | "section" | "dialog";
    id?: string;
    label?: string;
    min?: number;
    max?: number;
    initialValue?: number;
    decoration?: boolean;
    sectionClass?: string;
    initialOpen?: boolean;
}

let app: ReturnType<typeof mount> | null = null;
let target: HTMLElement | null = null;

function render(props: HarnessProps): void {
    target = document.createElement("div");
    document.body.appendChild(target);
    app = mount(SettingsPrimitivesHarness, { target, props });
    flushSync();
}

/** 拆掉外壳并清干净挂载点：对话框走 portal 挂在 body 上，用例之间必须互不污染。 */
async function destroyHarness(): Promise<void> {
    if (app) await unmount(app);
    app = null;
    flushSync();
    target?.remove();
    target = null;
}

/**
 * 让「关掉对话框」这件事真的落到 DOM 上。
 *
 * 为什么不能只 `flushSync()`：bits-ui 的退场走 `PresenceManager`，`open` 变假之后
 * 它先等一次 `tick()` 才把节点摘掉。happy-dom 没有 `Element.getAnimations`，
 * 所以它不会去等动画帧——`await tick()` 就够，不用计时器，也就不会偶发失败。
 */
async function settle(): Promise<void> {
    flushSync();
    await tick();
    flushSync();
}

/** 外壳里的父状态探针：断言读的是**父组件**的状态。 */
function probe(): HTMLElement {
    const el = target?.querySelector<HTMLElement>("[data-probe]");
    if (!el) throw new Error("外壳没渲染出来");
    return el;
}

function parentValue(): string | undefined {
    return probe().dataset.value;
}

function parentOpen(): string | undefined {
    return probe().dataset.open;
}

/** `onChange` 被调了几次（也就是「落了几次盘」）。 */
function changeCalls(): string | undefined {
    return probe().dataset.changeCalls;
}

function numberInput(): HTMLInputElement {
    const input = document.querySelector<HTMLInputElement>("input[type=number]");
    if (!input) throw new Error("没有渲染出数字输入框");
    return input;
}

/** 对话框是 portal 到 body 上的，所以整页找，不在挂载点里找。 */
function dialog(): HTMLElement | null {
    return document.querySelector<HTMLElement>('[role="dialog"]');
}

/** 设置面板里唯一一类间距：`gap-*`。取出来比整个列表，避免只 `contains` 漏掉多写的那个。 */
function gapClasses(el: Element): string[] {
    return [...el.classList].filter((name) => name.startsWith("gap-"));
}

afterEach(async () => {
    await destroyHarness();
    // portal 残留 + bits-ui 的 ScrollLock 往 body 上写的 style，逐个用例复原
    document.body.innerHTML = "";
    document.body.removeAttribute("style");
    localStorage.clear();
});

// ---------------------------------------------------------------------------
// SettingNumberRow：两个面板一共 5 行，全靠它
// ---------------------------------------------------------------------------

describe("SettingNumberRow", () => {
    it("label 的 for 与 input 的 id 指向同一个输入框（点标签能聚焦）", () => {
        render({ kind: "number-row", id: "pool-size" });

        const input = numberInput();
        const label = document.querySelector<HTMLLabelElement>("label");

        expect(input.id).toBe("pool-size");
        expect(label?.htmlFor, "for 没跟着传进来的 id 走").toBe(input.id);
        // 光字符串相等还不够：for 要真的能在文档里解析回这个输入框，
        // 否则点标签依然不聚焦（抽取时最容易丢的就是这一层）
        expect(label?.control, "for 指不到这个输入框").toBe(input);
    });

    it("输入框改动写回父组件的 value（bind:value 真的双向）", () => {
        render({ kind: "number-row", id: "pool-size", initialValue: 3 });

        const input = numberInput();
        // 父 → 子先得成立，否则下面那句「写回」没有对照
        expect(input.value).toBe("3");

        input.value = "42";
        input.dispatchEvent(new Event("input", { bubbles: true }));
        flushSync();

        expect(
            parentValue(),
            "父状态没被写回：两个面板的设置都落不了盘",
        ).toBe("42");
    });

    it("min / max 落到 input 上（浏览器据此拦非法值）", () => {
        render({ kind: "number-row", id: "pool-size", min: 5, max: 100 });

        const input = numberInput();
        expect(input.type).toBe("number");
        expect(input.min).toBe("5");
        expect(input.max).toBe("100");
    });

    it("onChange 只在 change 事件时调一次（input 阶段不该触发）", () => {
        render({ kind: "number-row", id: "pool-size", initialValue: 5 });

        const input = numberInput();
        input.value = "6";
        input.dispatchEvent(new Event("input", { bubbles: true }));
        flushSync();

        // 先确认 input 事件真的走到了绑定上，不然「没调 onChange」是句空话
        expect(parentValue()).toBe("6");
        expect(
            changeCalls(),
            "input 阶段就落盘 = 每敲一个字符写一次设置",
        ).toBe("0");

        input.dispatchEvent(new Event("change", { bubbles: true }));
        flushSync();
        expect(changeCalls()).toBe("1");

        // 第二次改动依然一一对应（排掉「挂载时调过一次」这种假通过）
        input.value = "7";
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
        flushSync();
        expect(changeCalls()).toBe("2");
    });

    it("传了 children 时装饰出现在 label 里", () => {
        render({ kind: "number-row", id: "pool-size", decoration: true });

        const label = document.querySelector("label");
        const mark = document.querySelector("[data-decoration]");

        expect(mark).not.toBeNull();
        expect(
            label?.contains(mark),
            "装饰没挂进 label：活动池梯度条、两个连对圆点都会掉到标签外面",
        ).toBe(true);
    });

    it("不传 children 也能渲染（记忆模式那两行就没有装饰）", () => {
        render({ kind: "number-row", id: "memory-round" });

        // children 是可选的：`{@render children?.()}` 里的 `?.` 丢了会直接抛
        expect(document.querySelector("[data-decoration]")).toBeNull();
        expect(numberInput().id).toBe("memory-round");
        expect(document.querySelector("label")?.textContent?.trim()).toBe("设置项");
    });
});

// ---------------------------------------------------------------------------
// SettingsSection：标题那串 class 只写一次，间距仍然归调用方
// ---------------------------------------------------------------------------

describe("SettingsSection", () => {
    it("默认 gap-2.5，传 class 时由调用方覆盖（改一处会改到四个面板的视觉）", async () => {
        render({ kind: "section" });

        const byDefault = document.querySelector("section");
        expect(byDefault).not.toBeNull();
        expect(byDefault?.querySelector("h3")?.textContent?.trim()).toBe("学习算法");
        expect(byDefault?.querySelector("[data-section-child]")).not.toBeNull();
        // 比整个 gap-* 列表：多写一个（twMerge 没生效）也会被抓出来
        expect(gapClasses(byDefault!)).toEqual(["gap-2.5"]);

        await destroyHarness();
        render({ kind: "section", sectionClass: "gap-3" });

        // 快捷键表是 gap-2、掌握阈值是 gap-3：统一成一个值就是视觉回归
        expect(gapClasses(document.querySelector("section")!)).toEqual(["gap-3"]);
    });
});

// ---------------------------------------------------------------------------
// SettingsDialog：外壳只有一份，两个面板的开关都绑在它身上
// ---------------------------------------------------------------------------

describe("SettingsDialog", () => {
    it("open 为真时渲染标题与 children（默认标题「当前题库设置」）", () => {
        render({ kind: "dialog", initialOpen: true });

        const el = dialog();
        expect(el, "open 为真却没有对话框").not.toBeNull();
        expect(el?.textContent).toContain("当前题库设置");
        expect(el?.textContent).toContain("面板内容");
        // 走 portal：断言必须落在 body 上，挂载点里是找不到的
        expect(target?.contains(el)).toBe(false);
    });

    it("父组件把 open 置真 → 弹窗出现（父 → 子这一半）", () => {
        render({ kind: "dialog", initialOpen: false });
        expect(dialog()).toBeNull();

        target?.querySelector<HTMLElement>("[data-parent-open]")?.click();
        flushSync();

        expect(parentOpen()).toBe("true");
        expect(dialog()?.textContent).toContain("面板内容");
    });

    it("点弹窗自带的关闭按钮 → 父组件的 open 跟着变假（子 → 父这一半）", async () => {
        render({ kind: "dialog", initialOpen: true });

        const close = document.querySelector<HTMLElement>(
            '[data-slot="dialog-close"]',
        );
        expect(close, "对话框自带的那颗关闭按钮没渲染出来").not.toBeNull();

        close!.click();
        await settle();

        expect(
            parentOpen(),
            "内部关掉了而父组件还以为是开着的：齿轮 / ⌘I 就再也打不开设置",
        ).toBe("false");
        expect(dialog()).toBeNull();
    });

    it("父组件把 open 置假 → 弹窗消失", async () => {
        render({ kind: "dialog", initialOpen: true });
        expect(dialog()).not.toBeNull();

        target?.querySelector<HTMLElement>("[data-parent-close]")?.click();
        await settle();

        expect(parentOpen()).toBe("false");
        expect(dialog()).toBeNull();
    });
});
