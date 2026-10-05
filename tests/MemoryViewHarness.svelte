<script lang="ts">
    /**
     * `MemoryView` 的测试外壳：把路由、题库仓库、提示三样上下文补齐。
     *
     * 真实应用里这三样分别来自 `App.svelte`（路由 / 仓库）、`App.svelte` 里的
     * `<AlertToast>`（提示单例不需要 provider）、`main.ts`（引擎）。这里只多给一个
     * 「路由从哪读地址」的出口——测试塞一个假的 `RouterEnv` 进来，
     * 就能在不碰真 `window.history` 的情况下验「地址 → 会话」这一层。
     */
    import * as Tooltip from "$lib/components/ui/tooltip";
    import MemoryView from "@/components/memory/MemoryView.svelte";
    import { provideQuizSource } from "@/source/context";
    import { provideRouter } from "@/features/routing/context";
    import type { Router } from "@/features/routing/router.svelte";
    import type { MemoryBank, QuizSource } from "@/source/types";

    interface Props {
        bank: MemoryBank;
        source: QuizSource;
        router: Router;
    }

    let { bank, source, router }: Props = $props();

    // 这两个是稳定引用（造一次、用到底），传进来只为建上下文
    // svelte-ignore state_referenced_locally
    provideQuizSource(source);
    // svelte-ignore state_referenced_locally
    provideRouter(router);
</script>

<!-- 与 App.svelte 的层级一致：底下的 bits-ui 原语（tooltip 等）需要 Provider -->
<Tooltip.Provider delayDuration={0}>
    <MemoryView {bank} />
</Tooltip.Provider>
