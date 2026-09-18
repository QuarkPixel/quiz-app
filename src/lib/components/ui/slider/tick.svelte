<script lang="ts">
	import { Slider as SliderPrimitive } from "bits-ui";
	import { cn } from "$lib/utils.js";

	let {
		ref = $bindable(null),
		index,
		class: className,
		...restProps
	}: SliderPrimitive.TickProps = $props();
</script>

<SliderPrimitive.Tick
	bind:ref
	{index}
	data-slot="slider-tick"
	class={cn(
		"bg-background data-[orientation=horizontal]:h-full data-[orientation=horizontal]:w-px data-[orientation=vertical]:h-px data-[orientation=vertical]:w-full",
		className
	)}
	{...restProps}
/>
