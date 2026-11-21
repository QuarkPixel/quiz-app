import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushSync, mount, unmount } from "svelte";

import GlobalSettings from "./GlobalSettingsHarness.svelte";
import { globalSettingsStore } from "../src/features/globalSettings.svelte";
import { appSound } from "../src/sound";

/**
 * 全局设置面板里「音效」这一组的行为：
 *   - 音量是**子项**：音效关着时整行不渲染，打开才出现，并且比主项更小更淡；
 *   - 音量滑杆**每一档**都落盘并试听（不是松手才响）；
 *   - switch 按结果状态响开 / 关。
 *
 * 只测这一组；SyncSettings 的细节由 `syncSettings.test.ts` 守。
 */

let destroy: (() => void) | null = null;

function mountPanel(): void {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const app = mount(GlobalSettings, {
        target: host,
        props: { open: true },
    });
    flushSync();
    destroy = () => {
        void unmount(app);
        host.remove();
    };
}

function soundSwitch(): HTMLElement {
    const el = document.querySelector<HTMLElement>("#global-sound-enabled");
    if (!el) throw new Error("找不到音效开关");
    return el;
}

beforeEach(() => {
    localStorage.clear();
    globalSettingsStore.reload();
});

afterEach(() => {
    vi.restoreAllMocks();
    destroy?.();
    destroy = null;
    document.body.innerHTML = "";
    document.body.removeAttribute("style");
    localStorage.clear();
    globalSettingsStore.reload();
});

describe("音效与音量子项", () => {
    it("音效关着不渲染音量行；打开后才出现，且标签更小更淡", () => {
        const play = vi.spyOn(appSound, "play").mockReturnValue(false);
        mountPanel();

        expect(
            document.querySelector("#global-sound-volume"),
            "音效关着时不该有音量子项",
        ).toBeNull();

        soundSwitch().click();
        flushSync();

        expect(play).toHaveBeenCalledWith("sound-enabled");
        const label = document.querySelector<HTMLElement>(
            'label[for="global-sound-volume"]',
        );
        expect(label, "打开音效后音量子项要出现").not.toBeNull();
        expect(label!.className).toContain("text-xs");
        expect(label!.className).toContain("text-muted-foreground");
        expect(label!.closest(".mb-1\\.5"), "子项下方要留出额外间距").not.toBeNull();
        expect(document.querySelector("#global-sound-volume")).not.toBeNull();
    });

    it("音量滑杆按一档就落盘并立刻试听（不用等松手）", () => {
        const play = vi.spyOn(appSound, "play").mockReturnValue(false);
        mountPanel();
        soundSwitch().click();
        flushSync();
        play.mockClear();

        const before = globalSettingsStore.value.soundVolume;
        const thumb = document.querySelector<HTMLElement>(
            "#global-sound-volume",
        );
        if (!thumb) throw new Error("音量滑杆没渲染出来");

        thumb.dispatchEvent(
            new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
        );
        flushSync();

        expect(globalSettingsStore.value.soundVolume).toBeGreaterThan(before);
        expect(play).toHaveBeenCalledWith("volume-changed", {
            cooldownMs: 45,
            retrigger: "restart",
        });
    });

    it("普通开关按结果状态响开 / 关", () => {
        const play = vi.spyOn(appSound, "play").mockReturnValue(false);
        mountPanel();

        const autoSubmit = document.querySelector<HTMLElement>(
            "#global-auto-submit",
        );
        if (!autoSubmit) throw new Error("找不到自动提交开关");

        autoSubmit.click();
        flushSync();
        expect(play).toHaveBeenLastCalledWith("setting-toggle-off");

        autoSubmit.click();
        flushSync();
        expect(play).toHaveBeenLastCalledWith("setting-toggle-on");
    });
});
