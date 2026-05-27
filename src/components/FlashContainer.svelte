<script lang="ts">
    import { onDestroy } from "svelte";
    import { FLASH_ANIMATION_DURATION } from "../config";

    // 直接挂到 document.body，避免落入任何祖先 stacking context / overflow 裁切
    const active = new Set<HTMLDivElement>();

    export function flash(isCorrect: boolean): void {
        const layer = document.createElement("div");
        layer.className = isCorrect
            ? "flash-layer-correct"
            : "flash-layer-wrong";
        document.body.appendChild(layer);
        active.add(layer);

        setTimeout(() => {
            layer.remove();
            active.delete(layer);
        }, FLASH_ANIMATION_DURATION);
    }

    onDestroy(() => {
        active.forEach((layer) => layer.remove());
        active.clear();
    });
</script>

