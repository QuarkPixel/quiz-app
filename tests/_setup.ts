import { installLocalStoragePolyfill } from "./_localStoragePolyfill";

installLocalStoragePolyfill();

/**
 * happy-dom 没有实现 Web Animations API，而 Svelte 的 `transition:`（slide 等）
 * 走的是 `element.animate()`。组件测试里补一个「立刻结束」的替身就够了：
 * 我们不测动画，只测 DOM 结构。
 */
interface StubAnimation {
    onfinish: (() => void) | null;
    cancel: () => void;
    finish: () => void;
    addEventListener: (type: string, cb: () => void) => void;
    removeEventListener: () => void;
}

function installAnimationPolyfill(): void {
    if (typeof Element === "undefined") return;
    const proto = Element.prototype as unknown as {
        animate?: (keyframes: unknown, options?: unknown) => StubAnimation;
    };
    if (typeof proto.animate === "function") return;

    proto.animate = () => {
        const animation: StubAnimation = {
            onfinish: null,
            cancel() {},
            finish() {},
            addEventListener(type, cb) {
                if (type === "finish") queueMicrotask(cb);
            },
            removeEventListener() {},
        };
        queueMicrotask(() => animation.onfinish?.());
        return animation;
    };
}

installAnimationPolyfill();
