<script lang="ts">
    import { FLASH_ANIMATION_DURATION } from "../config";

    let container: HTMLDivElement;

    export function flash(isCorrect: boolean): void {
        if (!container) return;

        const flashLayer = document.createElement("div");
        flashLayer.className = isCorrect
            ? "flash-layer-correct"
            : "flash-layer-wrong";
        container.appendChild(flashLayer);

        setTimeout(() => {
            flashLayer.remove();
        }, FLASH_ANIMATION_DURATION);
    }
</script>

<div
    bind:this={container}
    class="pointer-events-none fixed inset-0 -z-10"
></div>

<style>
    :global(.flash-layer-correct),
    :global(.flash-layer-wrong) {
        position: absolute;
        inset: 0;
    }

    :global(.flash-layer-correct) {
        animation: flashCorrect 6s ease;
    }

    :global(.flash-layer-wrong) {
        animation: flashWrong 6s ease;
    }

    @keyframes flashCorrect {
        0%,
        100% {
            background: transparent;
        }
        10% {
            background: rgba(129, 145, 47, 0.06);
        }
    }

    @keyframes flashWrong {
        0%,
        100% {
            background: transparent;
        }
        10% {
            background: rgba(224, 63, 79, 0.06);
        }
    }
</style>
