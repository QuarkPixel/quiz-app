<script lang="ts">
    import { onMount } from "svelte";
    import { Button } from "$lib/components/ui/button";
    import { formatAbsoluteTime, formatRelativeTime } from "$lib/time";
    import { syncEngine } from "@/features/sync/engine.svelte";
    import type { SyncConflict } from "@/features/sync/types";

    /**
     * 「这个题库两边都改过，保留哪边」——**设置面板与弹窗共用这一份**。
     *
     * 以前这块内联在 `SyncSettings` 里。需要弹窗时如果另写一份按钮，两处的
     * 时间口径（冲突发生时间 / 上传时间）与文案就会各演化各的——那正是这个
     * 项目里反复出现的问题。所以只留一个组件，两处都渲染它。
     *
     * 数据来自 `syncEngine.status.conflicts`，动作直接调引擎的
     * `keepLocal` / `keepRemote`（按题库逐个裁决，见 `resolveConflicts`）。
     */
    interface Props {
        conflicts: SyncConflict[];
        /** 弹窗里用：少一点内边距，按钮占满宽度（默认就是占满）。 */
        compact?: boolean;
    }

    let { conflicts, compact = false }: Props = $props();

    // 相对时间要"现在"才准（"3 分钟前"过一分钟就该是 4 分钟）。
    let now = $state(Date.now());
    onMount(() => {
        const timer = setInterval(() => (now = Date.now()), 1000);
        return () => clearInterval(timer);
    });

    /**
     * 两行小字要的时间点。
     *
     * **本地那行用 `detectedAt`（第一次看到冲突的时间），不是 `localAt`**：
     * 冲突发生后用户往往还在继续改，mtime 会一直往前跑，显示的永远是「刚刚」。
     * 云端那行是 Gist 的 `updated_at`（整条 Gist 的最后改动时间），取不到时退到
     * `lastSyncAt`——上一次真的同步成功的时间。
     */
    const first = $derived(conflicts[0]);
    const detectedAt = $derived(first?.detectedAt ?? first?.localAt ?? 0);
    const remoteAt = $derived(first?.remoteAt || syncEngine.status.lastSyncAt);

    /** 冲突侧的小字：`3 分钟前`；时间点不明时退回「未知」。 */
    function timeText(at: number): string {
        return at ? formatRelativeTime(at, now) : "未知";
    }

    /** 悬停给绝对时间；没有时间点时不挂 title。 */
    function timeTitle(at: number): string | undefined {
        return at ? formatAbsoluteTime(at) : undefined;
    }

    /**
     * 晚的那一边用实心按钮（＝推荐按这个）。
     *
     * 一边是「本地这份从什么时候起就和云端不一样了」，另一边是「云端那份什么时候
     * 传上来的」；谁更晚谁新。相同时算本地（自己手上这份，不用猜）。
     */
    const localIsNewer = $derived(detectedAt >= remoteAt);

    let busy = $state(false);
    async function resolve(kind: "keepLocal" | "keepRemote"): Promise<void> {
        if (busy) return;
        busy = true;
        try {
            await (kind === "keepLocal"
                ? syncEngine.keepLocal()
                : syncEngine.keepRemote());
        } finally {
            busy = false;
        }
    }
</script>

<div
    class="border-warning/40 bg-warning/5 flex flex-col gap-2 rounded-lg border {compact
        ? 'p-2'
        : 'p-2.5'}"
>
    <p class="text-xs font-medium">
        {conflicts.length} 个题库两边都改过，请选择保留哪一边：
    </p>
    <ul class="text-muted-foreground flex flex-col gap-0.5">
        {#each conflicts.slice(0, 5) as conflict (conflict.hash)}
            <li class="truncate text-[11px]">
                {conflict.name}
                <span class="font-mono opacity-60"
                    >{conflict.hash.slice(0, 8)}</span
                >
                {#if conflict.detail}
                    <span class="opacity-70">· {conflict.detail}</span>
                {/if}
            </li>
        {/each}
        {#if conflicts.length > 5}
            <li class="text-[11px]">还有 {conflicts.length - 5} 个…</li>
        {/if}
    </ul>
    <div class="flex items-start gap-2">
        <div class="flex flex-1 flex-col gap-1">
            <Button
                variant={localIsNewer ? "default" : "outline"}
                size="sm"
                class="w-full"
                disabled={busy}
                onclick={() => void resolve("keepLocal")}
            >
                保留本地
            </Button>
            <!--
                两个时间点各贴在它自己那个按钮下面，文字跟按钮左边缘对齐。
                「保留本地」要说的是本地这份从什么时候起就和云端不一样了——用户
                一边答题它一边变，所以显示的是**冲突发生**的时间；「保留云端」说的是
                云端那份什么时候传上来的。
            -->
            <p
                class="text-muted-foreground text-left text-[10px] leading-tight"
                title={timeTitle(detectedAt)}
            >
                冲突发生时间：{timeText(detectedAt)}
            </p>
        </div>
        <div class="flex flex-1 flex-col gap-1">
            <Button
                variant={localIsNewer ? "outline" : "default"}
                size="sm"
                class="w-full"
                disabled={busy}
                onclick={() => void resolve("keepRemote")}
            >
                保留云端
            </Button>
            <p
                class="text-muted-foreground text-left text-[10px] leading-tight"
                title={timeTitle(remoteAt)}
            >
                上传时间：{timeText(remoteAt)}
            </p>
        </div>
    </div>
</div>
