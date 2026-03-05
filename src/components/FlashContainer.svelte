<script lang="ts">
    import { FLASH_ANIMATION_DURATION } from "../config";

    let container: HTMLDivElement;

    // 触发闪烁效果
    export function flash(isCorrect: boolean): void {
        if (!container) return;

        const flashLayer = document.createElement("div");
        flashLayer.className = isCorrect
            ? "flash-layer-correct"
            : "flash-layer-wrong";
        container.appendChild(flashLayer);

        // 动画结束后移除
        setTimeout(() => {
            flashLayer.remove();
        }, FLASH_ANIMATION_DURATION);
    }
</script>

<div id="flash-container" bind:this={container}></div>

<style>
    #flash-container {
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        pointer-events: none;
        z-index: -1;
    }

    :global(.flash-layer-correct),
    :global(.flash-layer-wrong) {
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
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
            background: rgba(40, 167, 69, 0.04);
        }
    }

    @keyframes flashWrong {
        0%,
        100% {
            background: transparent;
        }
        10% {
            background: rgba(220, 53, 69, 0.04);
        }
    }
</style>
