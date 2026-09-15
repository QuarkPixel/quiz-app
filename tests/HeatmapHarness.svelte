<script module lang="ts">
    /**
     * 热力图的测试外壳：三份被测对象（共享外壳 + 两个模式的包装）共用一份挂载脚本。
     *
     * 为什么必须是组件：两个包装要读 session context
     * （`useQuizSession` / `useMemorySession`），而 `setContext` 只能在组件初始化期
     * 调用，普通函数里注入不进去。
     *
     * 共享外壳本来不需要 context，但它的对外契约只有一条 `cells(expanded)`，
     * 只有能自己塞一个可观察的 `cells` 进来才能把「收起时到底算不算」钉住，
     * 所以也走同一个外壳。
     */
    import type { HeatmapCell } from "@/components/shared/HeatmapSection.svelte";
    import type { QuizSession } from "@/quiz/session/QuizSession.svelte";
    import type { MemorySession } from "@/features/memory/MemorySession.svelte";

    export type HeatmapSubject =
        | { kind: "quiz"; session: QuizSession }
        | { kind: "memory"; session: MemorySession }
        | {
              kind: "shared";
              title: string;
              cells: (expanded: boolean) => HeatmapCell[];
          };
</script>

<script lang="ts">
    import SharedHeatmapSection from "@/components/shared/HeatmapSection.svelte";
    import QuizHeatmapSection from "@/components/review/HeatmapSection.svelte";
    import MemoryHeatmapSection from "@/components/memory/MemoryHeatmapSection.svelte";
    import { provideQuizSession } from "@/quiz/session/context";
    import { provideMemorySession } from "@/features/memory/context";

    interface Props {
        subject: HeatmapSubject;
        /** 省略时热力图就没有跳转能力——记忆模式的 `onJump` 本来就是可选的 */
        onJump?: (id: string) => void;
    }

    let { subject, onJump }: Props = $props();

    /**
     * 按模式注入 session：只有 `kind` 对得上时才注入，注入一个错模式的实例会让
     * `useXxxSession()` 拿到不认识的 session，坏在离现场很远的地方。
     *
     * 抽出函数只为少读几遍 prop：初始化期读 prop，Svelte 会发一条
     * `state_referenced_locally`（与 `tests/ViewHarness.svelte` 里
     * `provideQuizSource(source)` 那处同类）——这里本来就只在挂载时注入一次。
     */
    function provideSession(target: HeatmapSubject): void {
        if (target.kind === "quiz") {
            provideQuizSession(target.session);
        } else if (target.kind === "memory") {
            provideMemorySession(target.session);
        }
    }

    provideSession(subject);

    // 经 `$derived` 转一手：模板里直接读 `subject.title` 会被 Svelte 当成
    // 「只捕获了初始值」而报警（state_referenced_locally），这里本来就只在挂载时取一次
    const shared = $derived(subject.kind === "shared" ? subject : null);
</script>

<!-- 热力图的 tooltip 是自己算位置的 div（不走 bits-ui 浮层），所以这里不需要 Tooltip.Provider -->
{#if subject.kind === "quiz"}
    <QuizHeatmapSection onJump={(id) => onJump?.(id)} />
{:else if subject.kind === "memory"}
    <MemoryHeatmapSection {onJump} />
{:else if shared}
    <SharedHeatmapSection title={shared.title} cells={shared.cells} {onJump} />
{/if}
