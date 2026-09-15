<script lang="ts">
    import type { Snippet } from "svelte";

    // @ts-ignore
    import logoRaw from "/assets/icons/logo.svg?raw";

    import { cn } from "$lib/utils";
    import { globalSettingsDialog } from "@/features/globalSettingsDialog.svelte";
    import { syncConfigStore } from "@/features/sync/config.svelte";
    import { syncEngine } from "@/features/sync/engine.svelte";

    interface Props {
        headerStart?: Snippet;
        children?: Snippet;
    }

    let { headerStart, children }: Props = $props();

    /** 云同步关掉时整个指示点都不出现。 */
    const syncEnabled = $derived(syncConfigStore.value.enabled);
    /** 绿 = 和云端一致；黄 = 还有没同步上去的东西（或正在跑 / 离线）。 */
    const inSync = $derived(syncEngine.inSync);
    const syncing = $derived(syncEngine.status.phase === "syncing");
    const conflicts = $derived(syncEngine.status.conflicts.length);
    const hasConflicts = $derived(conflicts > 0);
    /**
     * 出错了（令牌失效、Gist 被删、限流……）。
     *
     * 「离线」不算：那不是数据问题，联网后下一次同步自己就好了，标红只会让人白紧张。
     */
    const failed = $derived(syncEngine.status.phase === "error");
    /**
     * 这台设备根本写不了 localStorage（iOS 隐私模式 / 系统拦截）。
     * 那比同步失败更严重：做题进度随时会丢，必须让用户看见。
     */
    const storageBlocked = $derived(syncEngine.storageBlocked);

    /** 指示点的三种状态。 */
    type Tone = "ok" | "pending" | "danger";

    /**
     * 指示点的三种状态：
     *   - `ok`（绿）  和云端一致
     *   - `pending`（黄）还有没同步上去的东西 / 离线
     *   - `danger`（红）**需要用户操心**：有冲突等着拍板、同步报错了，
     *     或者这台设备根本写不了本地存储
     */
    function settledToneNow(): Tone {
        return hasConflicts || failed || storageBlocked
            ? "danger"
            : inSync
              ? "ok"
              : "pending";
    }
    const settledTone = $derived(settledToneNow());

    /**
     * 正在同步时**保留跑之前那个颜色**，只用圆点脉冲表示「在跑」。
     *
     * 不这么做的话，从绿色点一下会先闪一下黄再变回绿：那一瞬间的黄来自
     * `phase === "syncing"`，而黄的意思是「有没传上去的改动」——那会儿其实没有，
     * 看着就像刚点就出问题了。红的同理：报错后重试期间也该一直是红的。
     */
    let toneWhileRunning = $state<Tone>(settledToneNow());
    $effect(() => {
        if (!syncing) toneWhileRunning = settledTone;
    });
    const tone = $derived<Tone>(syncing ? toneWhileRunning : settledTone);

    /**
     * 三种状态都能点：黄 / 绿点一下是手动同步一次（绿的时候也常用——想主动把
     * 云端的改动拉下来），红点一下去设置里处理冲突或报错。正在同步时不给点。
     */
    const clickable = $derived(syncEnabled && !syncing);

    /** 每种状态一套：底色 + 常态光晕 + hover 时更强的光晕（颜色跟着状态走）。 */
    const TONE_CLASS = {
        ok: "bg-success shadow-[0_0_6px_var(--success)] group-hover:shadow-[0_0_12px_var(--success)]",
        pending:
            "bg-warning shadow-[0_0_6px_var(--warning)] group-hover:shadow-[0_0_12px_var(--warning)]",
        danger: "bg-destructive shadow-[0_0_6px_var(--destructive)] group-hover:shadow-[0_0_12px_var(--destructive)]",
    } as const;

    const indicatorLabel = $derived(
        syncing
            ? "云同步：正在同步"
            : hasConflicts
              ? `云同步：${conflicts} 个题库存在冲突`
              : storageBlocked
                ? "云同步：本地存储不可写"
                : failed
                  ? `云同步：${syncEngine.status.message}`
                : syncEngine.status.phase === "offline"
                  ? "云同步：当前离线"
                  : inSync
                    ? "云同步：已同步"
                    : "云同步：还没同步",
    );

    /**
     * 点一下：
     *   - **红色**（有冲突 / 报错）：把人送到全局设置。冲突要在那儿选保留哪一边；
     *     报错（令牌失效、Gist 被删……）也是在那儿修——这两件事再同步一次都解决不了。
     *   - 黄 / 绿（还没同步 / 已同步 / 离线）：手动同步一次（跟设置面板里的
     *     「立即同步」同一个入口）。
     *
     * **刻意不弹任何提示**：成功了它自己就变绿（那就是反馈）；出错就变红并保持，
     * 悬浮看一眼标题就知道是什么错。
     */
    function onClick(): void {
        if (!clickable) return;
        if (hasConflicts || failed || storageBlocked) {
            globalSettingsDialog.show();
            return;
        }
        void syncEngine.sync();
    }

    function forwardWheelToMainScroll(event: WheelEvent): void {
        const viewport = document.querySelector<HTMLElement>(
            '[data-main-scroll-viewport="true"]',
        );
        if (!viewport) return;
        if (event.deltaX === 0 && event.deltaY === 0) return;

        viewport.scrollBy({
            left: event.deltaX,
            top: event.deltaY,
            behavior: "auto",
        });
        event.preventDefault();
    }
</script>

<div
    class="app-shell relative h-full min-h-0 [--app-shell-content-top:calc(env(safe-area-inset-top)+6rem)] sm:[--app-shell-content-top:calc(env(safe-area-inset-top)+5.25rem)]"
>
    <header
        class="pointer-events-none absolute inset-x-0 top-0 z-20 px-5 pt-[calc(env(safe-area-inset-top)+1.25rem)] sm:px-8 sm:pt-[calc(env(safe-area-inset-top)+1.5rem)]"
    >
        <div
            aria-hidden="true"
            class="app-shell-backdrop pointer-events-none absolute inset-x-0 top-0 h-26 bg-linear-to-b from-background via-background/96 to-background/0"
        ></div>

        <div
            class="pointer-events-auto relative grid grid-cols-[2rem_minmax(0,1fr)_2rem] items-center gap-3 pb-5 sm:pb-6"
            onwheel={forwardWheelToMainScroll}
        >
            <div class="flex size-8 items-center justify-start">
                {@render headerStart?.()}
            </div>

            <div
                class="text-muted-foreground mx-auto [&_svg]:h-4 [&_svg]:w-auto"
                aria-label="Quiz! aPP."
            >
                {@html logoRaw}
            </div>

            <div class="flex size-8 items-center justify-end">
                {#if syncEnabled}
                    <button
                        type="button"
                        class={cn(
                            // 命中区域（size-6）和圆点（size-2.5）分开：点起来够大，
                            // 看起来仍然是小圆点
                            "focus-visible:ring-ring/50 flex size-8 items-center justify-center rounded-full outline-none focus-visible:ring-2",
                            clickable
                                ? "group cursor-pointer"
                                : "cursor-default",
                        )}
                        title={indicatorLabel}
                        aria-label={indicatorLabel}
                        aria-disabled={!clickable}
                        onclick={onClick}
                    >
                        <span
                            class={cn(
                                // 光晕用 box-shadow 做，颜色跟着状态走（主题变量）
                                "size-1.5 rounded-full transition-[filter,box-shadow,width,height] duration-150",
                                TONE_CLASS[tone],
                                syncing && "animate-pulse",
                                // 能点的时候才吃 hover：提亮 + 光晕变强 + 稍微长大
                                // 一点；正在同步时这些 class 根本不在
                                clickable &&
                                    "group-hover:brightness-125 group-hover:size-2",
                            )}
                        ></span>
                    </button>
                {/if}
            </div>
        </div>
    </header>

    <div class="flex h-full min-h-0 flex-col">
        {@render children?.()}
    </div>
</div>

<style>
    .app-shell-backdrop {
        opacity: 0;
        transition: opacity 200ms ease;
    }

    :global(
        .app-shell:has([data-shell-scrollable="true"]) .app-shell-backdrop
    ) {
        opacity: 1;
    }
</style>
