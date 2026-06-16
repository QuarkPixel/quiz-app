<script lang="ts">
    import { FLASH_ANIMATION_DURATION } from "../config";

    let flashes: { id: Symbol; isCorrect: boolean }[] = $state([]);

    export function flash(isCorrect: boolean): void {
        const id = Symbol();
        flashes.push({ id, isCorrect });
        setTimeout(() => {
            const index = flashes.findIndex((f) => f.id === id);
            if (index !== -1) flashes.splice(index, 1);
        }, FLASH_ANIMATION_DURATION);
    }
</script>

<div
    class="fixed inset-0 pointer-events-none z-1024
    mix-blend-multiply dark:mix-blend-screen
    *:absolute *:inset-0 *:will-change-[opacity]"
>
    {#each flashes as { id, isCorrect } (id)}
        <div class={isCorrect ? "flash-correct" : "flash-wrong"}></div>
    {/each}
</div>

<style>
    .flash-correct {
        animation: flashCorrect 6s ease;
    }
    .flash-wrong {
        animation: flashWrong 6s ease;
    }

    @keyframes flashCorrect {
        0%,
        100% {
            background: transparent;
        }
        10% {
            background: rgba(129, 145, 47, 0.1);
        }
    }
    @keyframes flashWrong {
        0%,
        100% {
            background: transparent;
        }
        10% {
            background: rgba(224, 63, 79, 0.1);
        }
    }
</style>
