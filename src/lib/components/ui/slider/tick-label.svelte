<script lang="ts">
	import { Slider as SliderPrimitive } from "bits-ui";
	import { cn } from "$lib/utils.js";

	let {
		ref = $bindable(null),
		index,
		class: className,
		...restProps
	}: SliderPrimitive.TickLabelProps = $props();
</script>

<SliderPrimitive.TickLabel
	bind:ref
	{index}
	data-slot="slider-tick-label"
	class={cn(
		"text-muted-foreground text-xs font-medium tabular-nums data-selected:text-foreground",
		className
	)}
	{...restProps}
/>
