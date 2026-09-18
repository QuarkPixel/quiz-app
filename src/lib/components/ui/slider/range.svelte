<script lang="ts">
	import { Slider as SliderPrimitive } from "bits-ui";
	import { cn } from "$lib/utils.js";

	let {
		ref = $bindable(null),
		class: className,
		...restProps
	}: SliderPrimitive.RangeProps = $props();
</script>

<SliderPrimitive.Range
	bind:ref
	data-slot="slider-range"
	class={cn(
		"bg-primary absolute data-[orientation=horizontal]:h-full data-[orientation=vertical]:w-full",
		className
	)}
	{...restProps}
/>
