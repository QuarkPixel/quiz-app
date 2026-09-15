<script lang="ts">
    /**
     * `FilterBar` / `QuestionListSection` 的测试外壳。
     *
     * 两个组件都要 snippet 或 context，测试文件里没法直接造，所以用外壳转一层：
     *   - `FilterBar` 的 `actions`（展开面板右侧那块）由调用方决定内容；
     *   - `QuestionListSection` 的 `row` 是「自定义行」的入口，且传了它之后列表
     *     就不该再去取刷题会话（记忆模式没有 provide `QuizSession`）。
     */
    import * as Tooltip from "$lib/components/ui/tooltip";
    import FilterBar, {
        type FilterGroupDef,
    } from "@/components/shared/FilterBar.svelte";
    import QuestionListSection from "@/components/review/QuestionListSection.svelte";
    import type { QuestionGroup } from "@/components/review/virtualList/types";

    interface Props {
        kind: "filter" | "list";
        // FilterBar
        groups?: FilterGroupDef[];
        scopeApplied?: boolean;
        searchTerm?: string;
        onSearchChange?: (value: string) => void;
        showActions?: boolean;
        // QuestionListSection
        grouped?: QuestionGroup[];
        withHeaders?: boolean;
        emptyText?: string;
        onJumpHandled?: () => void;
    }

    let {
        kind,
        groups = [],
        scopeApplied = false,
        searchTerm = "",
        onSearchChange = () => {},
        showActions = false,
        grouped = [],
        withHeaders = true,
        emptyText,
        onJumpHandled = () => {},
    }: Props = $props();
</script>

{#if kind === "filter"}
    <!-- 筛选栏里的筛选按钮用了 Tooltip，没有 Provider 会直接抛错 -->
    <Tooltip.Provider delayDuration={0}>
    <FilterBar
        subject="展示题目"
        {searchTerm}
        {onSearchChange}
        searchPlaceholder="搜索"
        searchLabel="搜索题目"
        {groups}
        {scopeApplied}
    >
        {#snippet actions()}
            {#if showActions}
                <span data-testid="actions">附加操作</span>
            {/if}
        {/snippet}
    </FilterBar>
    </Tooltip.Provider>
{:else}
    <QuestionListSection
        {grouped}
        jumpTarget={null}
        {onJumpHandled}
        {withHeaders}
        {emptyText}
    >
        {#snippet row({ question, highlight })}
            <div
                data-review-question-id={question.id}
                data-testid="custom-row"
                data-highlight={highlight ? "true" : "false"}
            >
                自定义行：{question.id}
            </div>
        {/snippet}
    </QuestionListSection>
{/if}
