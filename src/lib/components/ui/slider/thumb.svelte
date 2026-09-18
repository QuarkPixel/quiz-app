<script lang="ts">
	import { Slider as SliderPrimitive } from "bits-ui";
	import { cn } from "$lib/utils.js";

	let {
		ref = $bindable(null),
		index,
		class: className,
		...restProps
	}: SliderPrimitive.ThumbProps = $props();
</script>

<SliderPrimitive.Thumb
	bind:ref
	{index}
	data-slot="slider-thumb"
	class={cn(
		"border-primary ring-ring/50 block size-4 shrink-0 rounded-full border bg-white shadow-sm transition-[color,box-shadow] hover:ring-4 focus-visible:ring-4 focus-visible:outline-hidden disabled:pointer-events-none disabled:opacity-50",
		className
	)}
	{...restProps}
/>
