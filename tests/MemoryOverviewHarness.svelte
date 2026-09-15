<script lang="ts">
    /**
     * 记忆总览（`MemoryOverview.svelte`）的测试外壳。
     *
     * 存在的理由：总览是个 Dialog，要 `MemorySession` 与 `QuizSource` 两个上下文
     * 才能挂起来，而这两份都由 `MemoryView` / `App.svelte` 在上层 provide。
     * 外壳按 `MemoryView` 的写法补上它们，再把 `open` 交出去：
     * 真实应用里这个开关是底部工具栏那颗「总览」按钮，测试要能自己关一次再开一次，
     * 才能验证「关掉总览会重置搜索与筛选」。
     */
    import * as Tooltip from "$lib/components/ui/tooltip";
    import MemoryOverview from "@/components/memory/MemoryOverview.svelte";
    import { provideMemorySession } from "@/features/memory/context";
    import { provideQuizSource } from "@/source/context";
    import type { MemorySession } from "@/features/memory/MemorySession.svelte";
    import type { QuizSource } from "@/source/types";

    interface Props {
        session: MemorySession;
        source: QuizSource;
    }

    let { session, source }: Props = $props();

    provideMemorySession(session);
    provideQuizSource(source);

    let open = $state(true);

    /** 供测试开关总览；`MemoryView` 里对应的是工具栏上的「总览」按钮 */
    export function setOpen(value: boolean): void {
        open = value;
    }
</script>

<!-- bits-ui 的 Tooltip.Root 没有 Provider 会直接抛错，与 App.svelte 的层级一致 -->
<Tooltip.Provider delayDuration={0}>
    <MemoryOverview {open} onOpenChange={(value) => (open = value)} />
</Tooltip.Provider>
