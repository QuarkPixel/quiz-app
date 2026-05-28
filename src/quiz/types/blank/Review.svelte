<script lang="ts">
    import type { QuestionReviewProps } from "../types";

    let { question }: QuestionReviewProps = $props();
</script>

<div class="flex items-center gap-1.5">
    <span class="text-muted-foreground text-xs">答案</span>
    <span class="text-success text-sm font-semibold">
        {Array.isArray(question.answer)
            ? (question.answer as string[]).join(" | ")
            : (question.answer as string)}
    </span>
</div>
