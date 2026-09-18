<script lang="ts">
	import { Slider as SliderPrimitive } from "bits-ui";
	import { cn } from "$lib/utils.js";

	let {
		ref = $bindable(null),
		index,
		class: className,
		...restProps
	}: SliderPrimitive.ThumbLabelProps = $props();
</script>

<SliderPrimitive.ThumbLabel
	bind:ref
	{index}
	data-slot="slider-thumb-label"
	class={cn(
		"text-foreground text-xs font-medium tabular-nums",
		className
	)}
	{...restProps}
/>
