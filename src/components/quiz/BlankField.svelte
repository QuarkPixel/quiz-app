<script lang="ts">
    import type { Snippet } from "svelte";
    import { cn } from "$lib/utils";

    /**
     * 填空题的「一条下划线」输入位。
     *
     * 以前是一个带边框的输入框（`h-12 rounded-lg border`），看起来像设置面板里的
     * 表单控件；填空是**答题**，字要大、框要轻。现在只剩一条线：没有背景、没有
     * 圆角、没有边框，聚焦时线从中间往两边加深加粗一点点（`scaleX(0→1)`），
     * 余光里能感觉到「光标在这儿」，但不抢题干。
     *
     * 两种内容：
     *   - 默认可编辑的 `<input>`（`onInput` 传值）；
     *   - 传 `children` 就换成只读内容（答错时的 diff、预览态的答案），
     *     壳与下划线完全一样，所以「作答」和「对答案」在视觉上是同一个位置。
     *
     * 配色档位 `tone` 只影响那条线：预览/模糊 = warning，答对 = success。
     */
    interface Props {
        value?: string;
        placeholder?: string;
        disabled?: boolean;
        onInput?: (value: string) => void;
        ariaLabel?: string;
        /** 线的颜色档位（默认中性） */
        tone?: "neutral" | "success" | "warning" | "destructive";
        /** 只读展示时用：内容替掉 input */
        children?: Snippet;
    }

    let {
        value = "",
        placeholder,
        disabled = false,
        onInput,
        ariaLabel,
        tone = "neutral",
        children,
    }: Props = $props();
</script>

<div
    class={cn(
        "blank-field relative flex w-full items-center",
        disabled && "blank-field-disabled",
    )}
    data-tone={tone === "neutral" ? undefined : tone}
    data-empty={value.length === 0 ? "true" : undefined}
    aria-label={children ? ariaLabel : undefined}
    role={children ? "group" : undefined}
>
    {#if children}
        <div class="blank-readout">
            {@render children()}
        </div>
    {:else}
        <input
            class="blank-input"
            {value}
            {placeholder}
            {disabled}
            aria-label={ariaLabel}
            oninput={(event) =>
                onInput?.((event.currentTarget as HTMLInputElement).value)}
            autocomplete="off"
            autocapitalize="off"
            spellcheck="false"
        />
    {/if}

    <!-- 下划线：底一条常态线，上面再叠一条聚焦时才从中间展开的深色线 -->
    <span class="blank-rule" aria-hidden="true"></span>
</div>

<style>
    .blank-field {
        /* 答题用的字号：比题干小一档，但明显大于普通表单控件 */
        --blank-font: 1.25rem;
        min-height: 2.75rem;
        padding-bottom: 0.5rem;
    }

    @media (min-width: 40rem) {
        .blank-field {
            --blank-font: 1.5rem;
        }
    }

    .blank-input {
        width: 100%;
        min-width: 0;
        padding: 0.25rem 0 0.375rem;
        border: 0;
        outline: none;
        background: transparent;
        color: var(--foreground);
        caret-color: var(--foreground);
        font-size: var(--blank-font);
        line-height: 1.35;
        font-weight: 500;
        letter-spacing: 0.01em;
    }

    .blank-input::placeholder {
        color: color-mix(in oklab, var(--muted-foreground) 55%, transparent);
        font-size: 0.8em;
        font-weight: 400;
        letter-spacing: 0;
    }

    /* 只读（对答案 / 预览）：同一套字号，别让答案看起来像另一套控件 */
    .blank-readout {
        width: 100%;
        padding: 0.25rem 0 0.375rem;
        font-size: var(--blank-font);
        line-height: 1.35;
        font-weight: 500;
        letter-spacing: 0.01em;
        white-space: pre-wrap;
        overflow-wrap: anywhere;
    }

    .blank-rule {
        position: absolute;
        inset-inline: 0;
        bottom: 0;
        height: 1px;
        background-color: color-mix(
            in oklab,
            var(--foreground) 18%,
            transparent
        );
        transition: background-color 200ms ease;
    }

    /*
     * 聚焦那条：从中间向两边长出来（`transform-origin: center`）。
     * 用 `scaleX` 而不是改 `width`——`transform` 不触发布局，几十个空的题也不会卡。
     */
    .blank-rule::after {
        content: "";
        position: absolute;
        inset-inline: 0;
        bottom: -0.5px;
        height: 2px;
        border-radius: 1px;
        background-color: color-mix(
            in oklab,
            var(--foreground) 55%,
            transparent
        );
        transform: scaleX(0);
        transform-origin: left center;
        transition: transform 220ms var(--ease-emphasized);
    }

    .blank-field:focus-within .blank-rule {
        background-color: color-mix(
            in oklab,
            var(--foreground) 28%,
            transparent
        );
    }

    .blank-field:focus-within .blank-rule::after {
        transform: scaleX(1);
    }

    /* 对答案时线不再闪：读的那一份是静态的 */
    .blank-field-disabled .blank-rule::after {
        transform: scaleX(0);
    }

    .blank-field[data-tone="success"] .blank-rule {
        background-color: color-mix(in oklab, var(--success) 45%, transparent);
    }
    .blank-field[data-tone="warning"] .blank-rule {
        background-color: color-mix(in oklab, var(--warning) 55%, transparent);
    }
    .blank-field[data-tone="destructive"] .blank-rule {
        background-color: color-mix(
            in oklab,
            var(--destructive) 45%,
            transparent
        );
    }

    @media (prefers-reduced-motion: reduce) {
        .blank-rule,
        .blank-rule::after {
            transition-duration: 0ms;
        }
    }
</style>
