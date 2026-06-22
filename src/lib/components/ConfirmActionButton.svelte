<script lang="ts">
    import { onDestroy, type Snippet } from "svelte";
    import type { HTMLButtonAttributes } from "svelte/elements";
    import {
        buttonVariants,
        type ButtonSize,
        type ButtonVariant,
    } from "$lib/components/ui/button";
    import { createConfirmAction } from "$lib/hooks/createConfirmAction.svelte";
    import { cn, type WithElementRef } from "$lib/utils";

    type RenderProps = {
        confirming: boolean;
    };

    type Props = WithElementRef<
        Omit<HTMLButtonAttributes, "children" | "onclick">,
        HTMLButtonElement
    > & {
        onConfirm: () => void;
        confirmClass?: string;
        confirmStyle?: string;
        idleLabel?: string;
        confirmLabel?: string;
        idleTitle?: string;
        confirmTitle?: string;
        idleAriaLabel?: string;
        confirmAriaLabel?: string;
        variant?: ButtonVariant;
        size?: ButtonSize;
        unstyled?: boolean;
        children?: Snippet<[RenderProps]>;
    };

    let {
        class: className,
        style,
        ref = $bindable<HTMLButtonElement | null>(null),
        onConfirm,
        confirmClass,
        confirmStyle,
        idleLabel,
        confirmLabel,
        idleTitle = idleLabel,
        confirmTitle = confirmLabel,
        idleAriaLabel = idleTitle ?? idleLabel,
        confirmAriaLabel = confirmTitle ?? confirmLabel,
        variant = "default",
        size = "default",
        unstyled = false,
        children,
        type = "button",
        ...restProps
    }: Props = $props();

    const action = createConfirmAction(() => onConfirm());

    onDestroy(() => action.reset());

    const resolvedClass = $derived(
        cn(
            !unstyled && buttonVariants({ variant, size }),
            className,
            action.confirming && confirmClass,
        ),
    );
    const resolvedStyle = $derived(
        action.confirming ? (confirmStyle ?? style) : style,
    );
    const resolvedTitle = $derived(
        action.confirming ? confirmTitle : idleTitle,
    );
    const resolvedAriaLabel = $derived(
        action.confirming ? confirmAriaLabel : idleAriaLabel,
    );

    export function reset(): void {
        action.reset();
    }

    export function trigger(): void {
        action.trigger();
    }
</script>

<button
    bind:this={ref}
    data-slot="confirm-action-button"
    class={resolvedClass}
    style={resolvedStyle}
    {type}
    title={resolvedTitle}
    aria-label={resolvedAriaLabel}
    onclick={() => action.trigger()}
    {...restProps}
>
    {#if children}
        {@render children({ confirming: action.confirming })}
    {:else}
        {action.confirming ? confirmLabel : idleLabel}
    {/if}
</button>
