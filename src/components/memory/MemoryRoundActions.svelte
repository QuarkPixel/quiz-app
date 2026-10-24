<script lang="ts">
    import { useMemorySession } from "@/features/memory/context";
    import { Button } from "$lib/components/ui/button";
    import ConfirmActionButton from "$lib/components/ConfirmActionButton.svelte";
    import * as Tooltip from "$lib/components/ui/tooltip";
    import { Kbd } from "$lib/components/ui/kbd";
    import { isCoarsePointer, prefersReducedMotion } from "$lib/utils";
    import { cubicIn, cubicOut } from "svelte/easing";
    import IconArrowLeft from "@tabler/icons-svelte/icons/arrow-left";
    import IconHandStop from "@tabler/icons-svelte/icons/hand-stop";

    /**
     * 本轮的两颗操作：退出本轮（保留进度）与结束本轮（作废、下次开新一轮）。
     *
     * 它住在**顶部固定区**（`ViewShell` 的 `header` 槽）里，所以滚到哪儿都在——
     * 以前它跟着内容一起滚，学到一半想退出得先滚回顶上。
     *
     * 交互沿用旧版：平时只有一颗返回箭头；指针落在箭头上（或键盘焦点进来、
     * 或触屏）才依次长出「退出本轮」文案 → 分割线 → 「结束本轮」。
     * 三部分各有自己的**壳**（`data-reveal-part`），壳占的位置就是最终位置、
     * 自己不参与动画；动画全在里面的元素上（transform + opacity），
     * 唯一的例外是文案的宽度（它得从 0 长出来，否则文字要么在要么不在）。
     *
     * **只有学习轮有「结束本轮」**：复习队列就是「今天还欠什么」，没有可以结束的一轮。
     */
    const session = useMemorySession();

    /** 指针落在触发区（箭头那颗按钮）上 */
    let triggerHovered = $state(false);
    /** 焦点在这一行里（键盘 Tab 进来） */
    let rowFocused = $state(false);
    const revealed = $derived(triggerHovered || rowFocused || isCoarsePointer);

    /**
     * 三部分的节奏（数值只此一份：这里给文案的 Svelte 过渡用，同时注入成 CSS 变量
     * 给分割线 / 结束按钮的 CSS 过渡用）。
     *
     * 顺序是「文案 → 分割线 → 结束按钮」一个接一个长出来（从左往右）；
     * 退场**反过来**：最后出现的「结束本轮」先走，文案垫底（最后离开）。
     */
    const REVEAL_IN_MS = 190;
    const REVEAL_OUT_MS = 150;
    /** 相邻两部分之间的间隔（细微的先后感） */
    const REVEAL_STAGGER_MS = 55;
    /** 文案是第一部分：进场第一个出发，退场最后一个收 */
    const LABEL_LEAVE_DELAY_MS = REVEAL_STAGGER_MS * 2;

    interface RevealOptions {
        delay: number;
        duration: number;
        easing: (t: number) => number;
    }

    /** 「退出本轮」文案：`cubicOut` 进、`cubicIn` 出 */
    const labelIn: RevealOptions = {
        duration: prefersReducedMotion ? 0 : REVEAL_IN_MS,
        delay: 0,
        easing: cubicOut,
    };
    const labelOut: RevealOptions = {
        duration: prefersReducedMotion ? 0 : REVEAL_OUT_MS,
        delay: prefersReducedMotion ? 0 : LABEL_LEAVE_DELAY_MS,
        easing: cubicIn,
    };

    /**
     * 文案的展开 / 收起：宽度 0 → 自然宽度 ＋ 淡入（Svelte 过渡，因为宽度得现量）。
     *
     * `min-width: 0` 不能省：flex 项默认 `min-width: auto`，按内容宽度撑住的话
     * 上面那条 `width` 根本压不下去（`slide` 内部也做了同一件事）。
     */
    function expandLabel(node: Element, options: RevealOptions) {
        const style = getComputedStyle(node);
        const width = parseFloat(style.width) || 0;
        const marginLeft = parseFloat(style.marginLeft) || 0;
        return {
            ...options,
            css: (t: number) =>
                "overflow: hidden; min-width: 0;" +
                `opacity: ${Math.min(1, t * 2)};` +
                `width: ${t * width}px;` +
                `margin-left: ${t * marginLeft}px;`,
        };
    }

    /**
     * 工具提示给触发元素的属性，只做一件事：把 `onclick` 摘掉。
     *
     * bits-ui 的 trigger 属性里带一个 `onclick`（点一下收起提示），而
     * `ConfirmActionButton` 把自己的「确认」动作也绑在 `onclick` 上、`{...restProps}`
     * 又排在那行之后——整包透进去会把确认动作顶掉（按钮就点不动了）。
     */
    function tooltipProps<T extends object>(props: T): Omit<T, "onclick"> {
        const rest = { ...props } as Record<string, unknown>;
        delete rest.onclick;
        return rest as Omit<T, "onclick">;
    }

    /** 焦点离开这一行（去别处 / 去 body）时才收起 */
    function onRowFocusOut(
        event: FocusEvent & { currentTarget: EventTarget & HTMLDivElement },
    ): void {
        const next = event.relatedTarget as Node | null;
        if (!next || !event.currentTarget.contains(next)) rowFocused = false;
    }
</script>

<div
    class="round-actions flex items-center"
    style="--reveal-in: {REVEAL_IN_MS}ms; --reveal-out: {REVEAL_OUT_MS}ms; --reveal-stagger: {REVEAL_STAGGER_MS}ms"
    data-slot="memory-round-actions"
    data-revealed={revealed ? "true" : "false"}
    role="group"
    aria-label="本轮操作"
    onmouseleave={() => (triggerHovered = false)}
    onfocusin={() => (rowFocused = true)}
    onfocusout={onRowFocusOut}
>
    <!-- 三部分各自套一层壳：`data-reveal-part` 必须打在**本组件模板里的元素**
         上（样式块是带作用域的，子组件渲染出来的 <button> 拿不到作用域类）。
         壳是 flex 项，占的就是最终位置；未点亮时里面的按钮/分割线往左挪
         几像素待命、opacity 为 0（箭头那颗留着 100%，点了不生效）。 -->
    <div class="flex" data-reveal-part="exit" role="menubar" tabindex="0">
        <Tooltip.Root>
            <Tooltip.Trigger>
                {#snippet child({ props })}
                    <!-- `{...props}` 必须排在 `onclick` 前面：工具提示的触发属性里
                         也有一个 `onclick`（用来点一下收起提示），排在后面会把
                         退出这个动作顶掉 -->
                    <Button
                        {...props}
                        variant="ghost"
                        size="sm"
                        class="gap-0"
                        aria-label="退出本轮"
                        onmouseenter={() => (triggerHovered = true)}
                        onclick={() => {
                            // 「hover 上之后才可被点击」：这一块同时是悬停
                            // 触发区，不能靠 `pointer-events: none` 拦（拦了
                            // 指针就落不到这里、这一行也就 hover 不开），
                            // 所以在点击时判一次
                            if (revealed) session.exitSession();
                        }}
                    >
                        <IconArrowLeft size={16} stroke={1.75} class="size-4" />
                        {#if revealed}
                            <!-- 标签长在按钮**里面**：点文字也是退出，不是一个看得见点不着的摆设 -->
                            <span
                                class="ml-1.5 block"
                                in:expandLabel={labelIn}
                                out:expandLabel={labelOut}
                            >
                                退出本轮
                            </span>
                        {/if}
                    </Button>
                {/snippet}
            </Tooltip.Trigger>
            <!-- 提示的内容只在「点亮」时挂上（`revealed`）：同一时刻只留一份提示，
                 不然从箭头滑到「结束本轮」时两份会叠在一起（见 `08640a7`） -->
            {#if revealed}
                <Tooltip.Content
                    side="bottom"
                    class="flex-col items-start gap-0.5"
                >
                    <span class="flex items-center gap-2"
                        >暂时退出<Kbd class="text-xs">Esc</Kbd></span
                    >
                    <span class="text-background/70">保留进度</span>
                </Tooltip.Content>
            {/if}
        </Tooltip.Root>
    </div>
    <!-- 分割线 + 「结束本轮」只在学习轮出现（复习轮没有可结束的一轮）。
         分割线两边各留一个按钮自己的内边距（px-2.5），所以这里不加 margin：
         一加右边就比左边宽 -->
    {#if session.run === "learning"}
        <span
            aria-hidden="true"
            class="block h-4 w-px mx-2 bg-foreground/20"
            data-reveal-part="divider"
        ></span>

        <span class="flex" data-reveal-part="stop">
            <Tooltip.Root>
                <Tooltip.Trigger>
                    {#snippet child({ props })}
                        <!-- `onclick` 要摘掉再透进去，见 `tooltipProps` -->
                        <ConfirmActionButton
                            {...tooltipProps(props)}
                            variant="ghost"
                            size="sm"
                            confirmClass="bg-destructive/10 text-destructive hover:bg-destructive/20 hover:text-destructive"
                            idleAriaLabel="结束本轮"
                            confirmAriaLabel="再次点击确认结束本轮"
                            onConfirm={() => session.endRound()}
                        >
                            {#snippet children({ confirming })}
                                <IconHandStop size={14} stroke={1.75} />
                                <!-- 点一下只是换词（「结束本轮」→「确认退出」，
                                 字数一样，宽度不跳），第二下才真的结束 -->
                                <span
                                    >{confirming
                                        ? "确认结束"
                                        : "结束本轮"}</span
                                >
                            {/snippet}
                        </ConfirmActionButton>
                    {/snippet}
                </Tooltip.Trigger>
                {#if revealed}
                    <Tooltip.Content
                        side="bottom"
                        class="flex-col items-start gap-0.5 pointer-events-none"
                    >
                        <span>完全退出</span>
                        <span class="text-background/70">下次开启新一轮</span>
                    </Tooltip.Content>
                {/if}
            </Tooltip.Root>
        </span>
    {/if}
</div>

<style>
    /*
     * 悬停点亮的节奏。数值（时长 / 间隔）由组件注入成 CSS 变量，只此一份；
     * 两条贝塞尔曲线就是 `svelte/easing` 的 cubicOut / cubicIn——
     * 文案那段 Svelte 过渡用的是同两条曲线的函数版。
     *
     * 三部分的**壳**（`data-reveal-part`）占着最终位置、自己不参与动画；动画全在
     * 里面的元素上：未点亮时往左挪 `--reveal-shift` 待命、`opacity: 0`，点亮后
     * 回到 0 位并淡入。所以这里只有 transform 与 opacity 两条属性——没有宽度动画，
     * 也就没有 slider 那种「擦出来」的效果（文案的宽度是唯一例外，见脚本）。
     *
     * 三档透明度：
     *   未点亮        → 只有箭头露着（100%），右边两部分全 0，两颗按钮都不可点
     *   点亮（悬停整行）→ 箭头与「结束本轮」60%，分割线 100%
     *   悬停到某个按钮  → 它自己回到 100%
     */
    .round-actions {
        --reveal-shift: -8px;
        --reveal-ease-enter: cubic-bezier(0.215, 0.61, 0.355, 1); /* cubicOut */
        --reveal-ease-leave: cubic-bezier(
            0.55,
            0.055,
            0.675,
            0.19
        ); /* cubicIn */
    }

    /* 未点亮：待命位置 + 藏起来，而且里面的按钮点不动
       （`pointer-events: none` 而不是 `disabled`——后者会让键盘 Tab 不进来）。
       这里的延迟是**退场**用的那一套：最后出现的先走（见下面 --reveal-delay-leave）。 */
    .round-actions [data-reveal-part] {
        opacity: 0;
        transform: translateX(var(--reveal-shift));
        pointer-events: none;
        transition:
            transform var(--reveal-out) var(--reveal-ease-leave)
                var(--reveal-delay-leave, 0ms),
            opacity var(--reveal-out) var(--reveal-ease-leave)
                var(--reveal-delay-leave, 0ms);
    }

    /* 未点亮时唯一的例外：箭头留着（让用户知道这一行有东西），而且**只有它的壳**
       是悬停触发区（`pointer-events: auto`）——指针得落得上去，这一行才 hover 得开。
       所以「未点亮不可点」拦在那颗按钮的 onclick 里，而不是靠 `pointer-events`。 */
    .round-actions [data-reveal-part="exit"] {
        --reveal-delay-enter: 0ms;
        --reveal-delay-leave: calc(var(--reveal-stagger) * 2);
        opacity: 1;
        pointer-events: auto;
    }
    .round-actions [data-reveal-part="divider"] {
        --reveal-delay-enter: var(--reveal-stagger);
        --reveal-delay-leave: var(--reveal-stagger);
    }
    .round-actions [data-reveal-part="stop"] {
        --reveal-delay-enter: calc(var(--reveal-stagger) * 2);
        --reveal-delay-leave: 0ms;
    }

    /* 点亮：延迟换成进场那一套（文案 → 分割线 → 结束按钮） */
    .round-actions[data-revealed="true"] [data-reveal-part] {
        opacity: 0.6;
        transform: translateX(0);
        pointer-events: auto;
        transition:
            transform var(--reveal-in) var(--reveal-ease-enter)
                var(--reveal-delay-enter, 0ms),
            opacity var(--reveal-in) var(--reveal-ease-enter)
                var(--reveal-delay-enter, 0ms);
    }

    /* 分割线不是按钮，不跟着压到 60% */
    .round-actions[data-revealed="true"] [data-reveal-part="divider"] {
        opacity: 1;
    }

    /* 鼠标压在哪一颗上，哪一颗才回到 100% */
    .round-actions[data-revealed="true"] [data-reveal-part]:hover {
        opacity: 1;
    }

    @media (prefers-reduced-motion: reduce) {
        /* 选择器要带上 [data-revealed]：不带的话优先级低于「点亮」那条规则，
           进场那一段照样走满 190ms（文案那段由脚本里的 prefersReducedMotion 管） */
        .round-actions[data-revealed] [data-reveal-part] {
            transition-duration: 0ms;
            transition-delay: 0ms;
        }
    }
</style>
