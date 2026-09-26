<script lang="ts">
    import type { Snippet } from "svelte";

    // @ts-ignore
    import logoRaw from "/assets/icons/logo.svg?raw";

    import { cn } from "$lib/utils";
    import { globalSettingsDialog } from "@/features/globalSettingsDialog.svelte";
    import { syncConfigStore } from "@/features/sync/config.svelte";
    import { syncEngine } from "@/features/sync/engine.svelte";
    import { handleSyncNowShortcut } from "@/features/sync/shortcut";
    import { modKeyLabel } from "$lib/platform";
    import * as Tooltip from "$lib/components/ui/tooltip";
    import * as Kbd from "$lib/components/ui/kbd";

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
    /** 上一次求值时的 `syncing`（`$effect` 里判「跑完了」那个下降沿用）。 */
    let prevSyncing = false;
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

    /**
     * 每种状态对应一个主题变量，圆点、光晕、呼吸灯、变亮动画**全都读它**：
     * 颜色只写在这一处，不会出现「圆点是绿的、光晕还是黄的」这种漂移。
     *
     * 「变亮」不另配一份颜色——那是同一色加 `filter: brightness()`（见 `@keyframes wink`），
     * 省掉一套按亮 / 暗主题各配一遍的混色比例。
     */
    const TONE_VAR: Record<Tone, string> = {
        ok: "--success",
        pending: "--warning",
        danger: "--destructive",
    };

    /** 挂到按钮上的内联变量（圆点从它取色）。 */
    const toneStyle = $derived(`--tone-color: var(${TONE_VAR[tone]})`);

    /** 圆点等元素的类：底色读按钮上那个变量（见 `TONE_VAR`）。 */
    const TONE_CLASS = "bg-(--tone-color)";

    /**
     * 圆点的光晕：**照搬旧版**的 `box-shadow`（常态 6px、能点时 hover 加到 12px）。
     *
     * 颜色走 `--tone-color`，所以三种状态共用这一份，不像旧版那样写三遍。
     * （旧版是 `shadow-[0_0_6px_var(--success)]` + `group-hover:shadow-[0_0_12px_var(--success)]`，
     * 看着完全一样。）
     */
    const HALO_CLASS =
        "shadow-[0_0_6px_var(--tone-color)] group-hover:shadow-[0_0_12px_var(--tone-color)]";

    /**
     * 点一下跑完那阵「亮一下」的时长（CSS 里 `animate-wink` 也写 700ms，两边对齐）。
     */
    const CLICK_FLASH_MS = 700;

    const indicatorLabel = $derived(
        syncing
            ? "正在同步"
            : hasConflicts
              ? `${conflicts} 个题库存在冲突`
              : storageBlocked
                ? "本地存储不可写"
                : failed
                  ? `${syncEngine.status.message}`
                  : syncEngine.status.phase === "offline"
                    ? "云同步：当前离线"
                    : inSync
                      ? "已同步"
                      : "还没同步",
    );

    /**
     * 悬浮提示 / 无障碍文案：状态说明后面挂上快捷键，省得这个键只活在说明面板里。
     *
     * 只在真的按得动时挂（`clickable`）——正在同步时 ⌘Y 与点击一样是空操作，
     * 那会儿提示它反而是骗人。
     */
    const indicatorText = $derived(
        clickable ? `${indicatorLabel}（${modKeyLabel}+Y）` : indicatorLabel,
    );

    /**
     * 手动点击（点圆点或按 ⌘Y）排下的那一次同步 —— 跑完要「亮一下」。
     *
     * 只是给用户的回执（点下去除了呼吸灯之外总得有个收尾），成功失败都亮：
     * 落点是什么颜色由那一轮的结果决定，亮的是**那个颜色**本身。
     * 自动同步（打开页面 / 防抖上传 / 轮询）不亮——用户没在等它。
     */
    let manualSync = false;
    /**
     * 正在播「亮一下」的那个状态；`null` = 不亮。
     *
     * 用状态而不是直接挂 class：动画只在**由不亮变成亮**的那一刻需要重启，
     * 而 Svelte 对同一个 class 重复赋值不会再触发一次动画。
     */
    let flashTone = $state<Tone | null>(null);
    let flashTimer: ReturnType<typeof setTimeout> | null = null;

    /**
     * 一轮同步跑完：手动点的就亮一下。
     *
     * 判定「跑完」用 `syncing` 的下降沿（`prev`）：这一轮无论是成功、报错还是
     * 有冲突，只要不在跑了就算跑完——用户要的是「这次点击有回执」，
     * 具体结果由圆点接下来停在哪一色说明。
     */
    $effect(() => {
        const running = syncing;
        const wasRunning = prevSyncing;
        prevSyncing = running;
        if (!wasRunning || running || !manualSync) return;
        playClickFlash();
    });

    $effect(() => () => {
        if (flashTimer) clearTimeout(flashTimer);
    });

    function playClickFlash(): void {
        manualSync = false;
        flashTone = settledTone;
        if (flashTimer) clearTimeout(flashTimer);
        flashTimer = setTimeout(() => {
            flashTone = null;
            flashTimer = null;
        }, CLICK_FLASH_MS + 60);
    }

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
        manualSync = true;
        void syncEngine.sync();
    }

    /**
     * ⌘Y 走**同一个** `onClick`——「红点去设置、否则同步一次」这条规则不写第二遍，
     * 快捷键与点击就不会各自漂移（判定与上下文守卫在 `sync/shortcut.ts`）。
     *
     * 窗口监听挂在这里而不是答题视图里：指示点住在这儿，而且它始终挂载
     * ——没有题库的空状态也要能按（新设备打开正是为了把云端题库拉下来）。
     * 云同步关掉时 `enabled` 为假，那次按键我们完全不碰。
     */
    function onWindowKeydown(event: KeyboardEvent): void {
        handleSyncNowShortcut(event, { enabled: syncEnabled, run: onClick });
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
                    <Tooltip.Root>
                        <Tooltip.Trigger>
                            <button
                                type="button"
                                data-slot="sync-indicator"
                                data-syncing={syncing ? "true" : undefined}
                                style={toneStyle}
                                class={cn(
                                    // 命中区域（size-8）和圆点（size-1.5）分开：点起来够大，
                                    // 看起来仍然是小圆点
                                    "focus-visible:ring-ring/50 flex size-8 items-center justify-center rounded-full outline-none focus-visible:ring-2",
                                    clickable
                                        ? "group cursor-pointer"
                                        : "cursor-default",
                                )}
                                aria-label={indicatorText}
                                aria-disabled={!clickable}
                                onclick={onClick}
                            >
                                <!--
                                    圆点：尺寸与光晕**照搬旧版**（`size-1.5` = 6px，
                                    光晕是 `box-shadow: 0 0 6px <状态色>`），
                                    也就是被换掉之前那一版的观感。这里改的只有两点：

                                      1. 「在跑」的动画（`syncing`）——旧版是 `animate-pulse`
                                         （只淡到 50%），现在用 `animate-breathe` 略强一点
                                      2. 手动点击跑完那一下 `animate-wink`（见 `flashTone`）

                                    光晕必须**挂在圆点自己身上**、不能挪到按钮的伪元素上：
                                    伪元素画出来是「6px 的实心圆 + 3px 模糊」，视觉直径比
                                    `box-shadow` 大一圈，看着就是「指示灯变大了」（踩过）。
                                -->
                                <span
                                    class={cn(
                                        // `brightness-100` = 常态滤镜值：`@keyframes wink` 只在中段写
                                        // `brightness(2)`，两端省略，靠它定住基线
                                        "size-1.5 rounded-full brightness-100 transition-[filter,box-shadow,width,height] duration-150",
                                        TONE_CLASS,
                                        HALO_CLASS,
                                        syncing && "animate-breathe",
                                        flashTone !== null && "animate-wink",
                                        // 能点的时候才吃 hover：提亮 + 光晕变强 + 稍微长大
                                        // 一点；正在同步时这些 class 根本不在
                                        clickable &&
                                            "group-hover:brightness-125 group-hover:size-2",
                                    )}
                                ></span>
                            </button>
                        </Tooltip.Trigger>
                        <Tooltip.Content
                            side={"bottom-end" as
                                "top" | "right" | "bottom" | "left" | undefined}
                            sideOffset={-10}
                            class="relative px-2"
                        >
                            <span>{indicatorLabel}</span>
                            <div
                                class={cn(
                                    "text-foreground/70 pointer-events-none",
                                    "absolute bottom-0 translate-y-full right-0 w-max",
                                    "flex items-center gap-1",
                                )}
                            >
                                <Kbd.Group
                                    class="*:bg-muted! *:text-muted-foreground!"
                                >
                                    <Kbd.Root>{modKeyLabel}</Kbd.Root>
                                    <Kbd.Root>Y</Kbd.Root>
                                </Kbd.Group>单击以立即同步
                            </div>
                        </Tooltip.Content>
                    </Tooltip.Root>
                {/if}
            </div>
        </div>
    </header>

    <div class="flex h-full min-h-0 flex-col">
        {@render children?.()}
    </div>
</div>

<!-- ⌘Y：跟指示点同一个动作（云同步关着时这个监听什么都不做） -->
<svelte:window onkeydown={onWindowKeydown} />

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
