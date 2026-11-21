import { afterEach, describe, expect, it, vi } from "vitest";
import { flushSync, mount, unmount } from "svelte";
import OverlaySoundHarness from "./OverlaySoundHarness.svelte";
import { appSound } from "../src/sound";

/**
 * 浮层开合音的「不要叠音」规则。
 *
 * 两个真实场景：
 *   1. 记忆首页点热力图 → 已经响过 `heatmap-jump`，窗口紧接着出现，
 *      不该再补一声 `dialog-open`；
 *   2. 删除 / 重命名在关闭对话框的同一下给出结果音，不该再补 `dialog-close`。
 *
 * 这两条都靠 `attachOverlaySound` 的一次性判断，而不是让每个调用方自己算
 * 时间差——所以直接测这个入口最省事。
 */

type Harness = {
    setOpen: (value: boolean) => void;
};

let mounted: ReturnType<typeof mount> | null = null;

afterEach(() => {
    if (mounted) void unmount(mounted);
    mounted = null;
    document.body.innerHTML = "";
    vi.restoreAllMocks();
});

function render(props: {
    open?: boolean;
    skipOpen?: () => boolean;
    skipClose?: () => boolean;
}): Harness {
    const host = document.createElement("div");
    document.body.appendChild(host);
    mounted = mount(OverlaySoundHarness, { target: host, props });
    flushSync();
    return mounted as unknown as Harness;
}

function spyPlay(): ReturnType<typeof vi.spyOn> {
    return vi.spyOn(appSound, "play").mockReturnValue(false);
}

describe("浮层开合音", () => {
    it("打开响 dialog-open，关闭响 dialog-close", () => {
        const play = spyPlay();
        const harness = render();

        harness.setOpen(true);
        flushSync();
        expect(play).toHaveBeenLastCalledWith("dialog-open");

        harness.setOpen(false);
        flushSync();
        expect(play).toHaveBeenLastCalledWith("dialog-close");
    });

    it("skipOpen：这一次打开已经有别的动作音，不再叠 dialog-open", () => {
        const play = spyPlay();
        let skip = true;
        const harness = render({ skipOpen: () => skip });

        harness.setOpen(true);
        flushSync();
        expect(play).not.toHaveBeenCalledWith("dialog-open");

        // 之后的正常打开照常响：skipOpen 只压这一次
        harness.setOpen(false);
        flushSync();
        skip = false;
        harness.setOpen(true);
        flushSync();
        expect(play).toHaveBeenLastCalledWith("dialog-open");
    });

    it("skipClose：关闭紧跟着结果音时，不再叠 dialog-close", () => {
        const play = spyPlay();
        let skip = false;
        const harness = render({ skipClose: () => skip });

        harness.setOpen(true);
        flushSync();
        play.mockClear();

        skip = true;
        harness.setOpen(false);
        flushSync();
        expect(play).not.toHaveBeenCalledWith("dialog-close");
    });
});
