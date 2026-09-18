<script lang="ts">
	import { Slider as SliderPrimitive } from "bits-ui";
	import type { Snippet } from "svelte";
	import { cn, type WithoutChildrenOrChild } from "$lib/utils.js";
	import Range from "./range.svelte";
	import Thumb from "./thumb.svelte";

	// 片段参数的类型只能从原语自己的 `children` 上取（bits-ui 没把
	// `SliderRootSnippetProps` 放进 `Slider` 命名空间），这样调用方
	// `{#snippet children({ tickItems })}` 里的解构才有类型。
	type RootProps = SliderPrimitive.RootProps;
	type RootSnippetProps = Parameters<NonNullable<RootProps["children"]>>[0];

	// `children` 必须显式接住再转发：原语只通过 `children` 片段交出 `tickItems`
	// 这些东西，而后面那个默认的 `{#snippet children}`（轨道 + 滑块）会**盖掉**
	// 透传进来的同名片段——要画刻度就得自己铺一遍轨道，所以「有没有传 `children`」
	// 必须在这里分流。
	let {
		ref = $bindable(null),
		value = $bindable(),
		orientation = "horizontal",
		class: className,
		children,
		...restProps
	}: WithoutChildrenOrChild<RootProps> & {
		children?: Snippet<[RootSnippetProps]>;
	} = $props();
</script>

<!--
Discriminated Unions + Destructing (required for bindable) do not
get along, so we shut typescript up by casting `value` to `never`.
-->
<SliderPrimitive.Root
	bind:ref
	bind:value={value as never}
	data-slot="slider"
	{orientation}
	class={cn(
		"relative flex w-full touch-none items-center select-none data-[disabled]:opacity-50 data-[orientation=vertical]:h-full data-[orientation=vertical]:min-h-44 data-[orientation=vertical]:w-auto data-[orientation=vertical]:flex-col",
		className
	)}
	{...restProps}
>
	{#snippet children(snippetProps)}
		{#if children}
			{@render children(snippetProps)}
		{:else}
			<span
				data-orientation={orientation}
				data-slot="slider-track"
				class={cn(
					"bg-muted relative grow overflow-hidden rounded-full data-[orientation=horizontal]:h-1.5 data-[orientation=horizontal]:w-full data-[orientation=vertical]:h-full data-[orientation=vertical]:w-1.5"
				)}
			>
				<Range />
			</span>
			{#each snippetProps.thumbs as thumb (thumb)}
				<Thumb index={thumb} />
			{/each}
		{/if}
	{/snippet}
</SliderPrimitive.Root>
