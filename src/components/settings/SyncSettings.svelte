<script lang="ts">
    import { onMount, onDestroy } from "svelte";
    import { Button } from "$lib/components/ui/button";
    import { Input } from "$lib/components/ui/input";
    import { Label } from "$lib/components/ui/label";
    import { Switch } from "$lib/components/ui/switch";
    import * as Tooltip from "$lib/components/ui/tooltip";
    import AlertToast from "../layout/AlertToast.svelte";
    import ConfirmActionButton from "$lib/components/ConfirmActionButton.svelte";
    import { cn } from "$lib/utils";
    import IconCloud from "@tabler/icons-svelte/icons/cloud";
    import IconCloudOff from "@tabler/icons-svelte/icons/cloud-off";
    import IconEye from "@tabler/icons-svelte/icons/eye";
    import IconEyeOff from "@tabler/icons-svelte/icons/eye-off";
    import IconInfoCircle from "@tabler/icons-svelte/icons/info-circle";
    import {
        isValidSupabaseUrl,
        maskKey,
        syncConfigStore,
    } from "@/features/sync/config.svelte";
    import { syncEngine } from "@/features/sync/engine.svelte";
    import { relayBase } from "@/features/sync/relay";
    import { collectLocalEntries } from "@/features/sync/storage";
    import { SYNC_TABLE } from "@/features/sync/types";

    let toast: AlertToast;

    // 已保存的连接信息默认以掩码形态展示（避免录屏 / 截图泄露）；点「修改」才进编辑态
    let editing = $state(false);
    let draftUrl = $state(syncConfigStore.value.supabaseUrl);
    let draftKey = $state(syncConfigStore.value.supabaseKey);
    let keyVisible = $state(false);
    let autoSync = $state(syncConfigStore.value.autoSync);
    let busy = $state<"" | "test" | "merge" | "push" | "pull">("");
    let report = $state<{ ok: boolean; lines: string[] } | null>(null);

    const status = $derived(syncEngine.status);
    const endpoint = $derived(relayBase());
    const configured = $derived(
        isValidSupabaseUrl(syncConfigStore.value.supabaseUrl) &&
            syncConfigStore.value.supabaseKey.length > 0,
    );
    const draftUrlValid = $derived(isValidSupabaseUrl(draftUrl));
    const draftValid = $derived(draftUrlValid && draftKey.trim().length > 0);

    const statusTone = $derived(
        status.phase === "error" || status.phase === "offline"
            ? "text-destructive"
            : status.phase === "conflict"
              ? "text-amber-600 dark:text-amber-500"
              : "text-muted-foreground",
    );

    // 本地数据量：操作完成后算一次就够，不必跟随每次写入重算
    let localBytes = $state(0);
    function refreshLocalBytes(): void {
        localBytes = collectLocalEntries().reduce(
            (sum, entry) => sum + entry.id.length + entry.value.length,
            0,
        );
    }

    let unsubscribe: (() => void) | null = null;

    onMount(() => {
        refreshLocalBytes();
        // 没填过就直接进编辑态，省一次点击
        editing = syncConfigStore.value.supabaseUrl.length === 0;
        unsubscribe = syncEngine.subscribe((event) => {
            if (event.kind === "synced") {
                refreshLocalBytes();
            } else if (event.kind === "conflict") {
                toast?.show("发现同步冲突", event.message, "destructive");
            } else if (event.kind === "error") {
                toast?.show("同步失败", event.message, "destructive");
            }
        });
        return () => unsubscribe?.();
    });

    onDestroy(() => unsubscribe?.());

    function saveDraft(): void {
        syncConfigStore.update({
            supabaseUrl: draftUrl,
            supabaseKey: draftKey,
        });
        report = null;
    }

    function startEditing(): void {
        draftUrl = syncConfigStore.value.supabaseUrl;
        draftKey = syncConfigStore.value.supabaseKey;
        keyVisible = false;
        editing = true;
    }

    function cancelEditing(): void {
        draftUrl = syncConfigStore.value.supabaseUrl;
        draftKey = syncConfigStore.value.supabaseKey;
        editing = false;
        report = null;
    }

    async function withBusy<T>(
        kind: typeof busy,
        task: () => Promise<T>,
    ): Promise<void> {
        busy = kind;
        try {
            await task();
            refreshLocalBytes();
        } finally {
            busy = "";
        }
    }

    function setAutoSync(next: boolean): void {
        autoSync = next;
        syncConfigStore.update({ autoSync: next });
        toast?.show(
            next ? "已开启自动同步" : "已关闭自动同步",
            next
                ? "本地改动会在 2 秒后自动上传，切回页面时自动检查云端。"
                : "之后只有点「立即同步」才会同步。",
        );
    }

    function testConnection(): void {
        void withBusy("test", async () => {
            const result = await syncEngine.testConnection();
            const relay = result.relay;

            const lines: string[] = [];
            if (relay?.ok) {
                lines.push(`后端 ${endpoint}：可达`);
            } else if (relay?.stale) {
                lines.push(
                    `后端 ${endpoint}：是旧版本（缺 /_ping 自检端点），把仓库最新的代码重新部署一次`,
                );
            } else {
                lines.push(`后端 ${endpoint}：不可达`);
                lines.push(`　${relay?.error ?? "无法访问"}`);
            }

            lines.push(
                result.ok
                    ? `数据表 ${SYNC_TABLE}：可读，云端现有 ${result.rowCount} 项`
                    : `数据表 ${SYNC_TABLE}：${result.error ?? "读取失败"}`,
            );

            report = { ok: result.ok, lines };
            if (result.ok) toast?.show("连接正常", undefined, "success");
        });
    }

    function syncNow(): void {
        void withBusy("merge", async () => {
            const outcome = await syncEngine.sync();
            if (outcome.conflicts.length === 0) {
                toast?.show(
                    "同步完成",
                    `上传 ${outcome.pushed} 项 · 下载 ${outcome.pulled} 项`,
                    "success",
                );
            }
        });
    }

    function forceUpload(): void {
        void withBusy("push", async () => {
            const outcome = await syncEngine.pushLocal();
            toast?.show("已用本地覆盖云端", `上传 ${outcome.pushed} 项`, "success");
        });
    }

    function forceDownload(): void {
        void withBusy("pull", async () => {
            // 下载成功后会整页刷新，这里不必再提示
            await syncEngine.pullRemote();
        });
    }

    function formatBytes(bytes: number): string {
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
        return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
    }

    function formatTime(at: number): string {
        if (!at) return "从未";
        return new Date(at).toLocaleString("zh-CN", {
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
        });
    }
</script>

<AlertToast bind:this={toast} />

<section class="flex flex-col gap-3">
    <div class="flex items-center justify-between gap-3">
        <Label class="flex items-center gap-2 text-sm font-normal">
            {#if status.phase === "error" || status.phase === "offline"}
                <IconCloudOff size={15} stroke={1.5} class="text-destructive" />
            {:else}
                <IconCloud size={15} stroke={1.5} />
            {/if}
            云同步
        </Label>
        <Tooltip.Root>
            <Tooltip.Trigger>
                {#snippet child({ props })}
                    <button
                        {...props}
                        type="button"
                        class="text-muted-foreground hover:text-foreground inline-flex items-center"
                        aria-label="关于云同步"
                    >
                        <IconInfoCircle size={14} stroke={1.5} />
                    </button>
                {/snippet}
            </Tooltip.Trigger>
            <Tooltip.Content side="top" align="end" class="max-w-72">
                <span class="text-xs leading-relaxed">
                    同步本地的 <code>quiz_app_*</code> 数据：题库内容、题库列表与顺序、
                    每个题库的进度与设置、全局设置。请求发往本站自己的后端
                    {" "}<code>{endpoint}</code>，由它转发到你的 Supabase ——
                    凭据只存在这台设备上，后端不保存任何密钥。
                </span>
            </Tooltip.Content>
        </Tooltip.Root>
    </div>

    {#if editing}
        <div class="flex flex-col gap-2">
            <div class="flex flex-col gap-2">
                <div class="flex flex-col gap-1">
                    <Input
                        bind:value={draftUrl}
                        type="text"
                        placeholder="https://xxxx.supabase.co"
                        aria-label="Supabase 项目地址"
                        class="font-mono text-[11px]"
                        aria-invalid={draftUrl.length > 0 && !draftUrlValid}
                        oninput={() => (report = null)}
                        onkeydown={(event) => {
                            if (event.key === "Enter") {
                                saveDraft();
                                testConnection();
                            }
                        }}
                    />
                    {#if draftUrl.length > 0 && !draftUrlValid}
                        <p class="text-destructive text-[11px]">
                            应该形如 https://xxxx.supabase.co
                        </p>
                    {/if}
                </div>

                <div class="flex gap-2">
                    <Input
                        bind:value={draftKey}
                        type={keyVisible ? "text" : "password"}
                        placeholder="sb_secret_…"
                        aria-label="Supabase 密钥"
                        class="font-mono text-[11px]"
                        oninput={() => (report = null)}
                        onkeydown={(event) => {
                            if (event.key === "Enter") {
                                saveDraft();
                                testConnection();
                            }
                        }}
                    />
                    <Button
                        variant="outline"
                        size="icon"
                        class="shrink-0"
                        title={keyVisible ? "隐藏" : "显示"}
                        aria-label={keyVisible ? "隐藏密钥" : "显示密钥"}
                        onclick={() => (keyVisible = !keyVisible)}
                    >
                        {#if keyVisible}
                            <IconEyeOff size={15} stroke={1.5} />
                        {:else}
                            <IconEye size={15} stroke={1.5} />
                        {/if}
                    </Button>
                </div>
            </div>

            <p class="text-muted-foreground text-[11px] leading-relaxed">
                两样都在 Supabase 控制台的 <code>Project Settings → API Keys</code> 里。
                密钥只存在这台设备的本地存储里，<strong>不会上传</strong>。
            </p>

            <div class="flex gap-2">
                <Button
                    size="sm"
                    disabled={!draftValid}
                    onclick={() => {
                        saveDraft();
                        testConnection();
                    }}
                >
                    保存并测试
                </Button>
                <Button variant="ghost" size="sm" onclick={() => cancelEditing()}>
                    取消
                </Button>
            </div>
        </div>
    {:else}
        <div class="flex items-center gap-2">
            <div class="flex min-w-0 flex-1 flex-col gap-0.5">
                <code
                    class="bg-muted/50 truncate rounded-md px-2.5 py-1 font-mono text-[11px]"
                    title="已保存的项目地址"
                >
                    {syncConfigStore.value.supabaseUrl}
                </code>
                <code
                    class="bg-muted/50 text-muted-foreground truncate rounded-md px-2.5 py-1 font-mono text-[11px]"
                    title="已保存的密钥（已打码）"
                >
                    {maskKey(syncConfigStore.value.supabaseKey)}
                </code>
            </div>
            <Button variant="outline" size="sm" onclick={() => startEditing()}>
                修改
            </Button>
            <Button
                variant="outline"
                size="icon"
                class="shrink-0"
                title="重新测试连接"
                aria-label="重新测试连接"
                disabled={busy !== ""}
                onclick={() => testConnection()}
            >
                <IconCloud size={15} stroke={1.5} />
            </Button>
        </div>
    {/if}

    <div class="flex flex-wrap gap-2">
        <Button
            variant="outline"
            size="sm"
            disabled={busy !== "" || !configured || editing}
            onclick={() => syncNow()}
        >
            {busy === "merge" ? "同步中…" : "立即同步"}
        </Button>
    </div>

    {#if status.conflicts.length > 0}
        <div
            class="flex flex-col gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-2.5"
        >
            <p class="text-xs font-medium">
                {status.conflicts.length} 项内容两边都改过，请选择保留哪一边：
            </p>
            <ul class="text-muted-foreground flex flex-col gap-0.5">
                {#each status.conflicts.slice(0, 5) as conflict (conflict.id)}
                    <li class="truncate font-mono text-[11px]">{conflict.id}</li>
                {/each}
                {#if status.conflicts.length > 5}
                    <li class="text-[11px]">
                        还有 {status.conflicts.length - 5} 项…
                    </li>
                {/if}
            </ul>
            <div class="flex gap-2">
                <Button
                    size="sm"
                    disabled={busy !== ""}
                    onclick={() => void withBusy("merge", () => syncEngine.keepLocal())}
                >
                    保留本地
                </Button>
                <Button
                    variant="outline"
                    size="sm"
                    disabled={busy !== ""}
                    onclick={() => void withBusy("merge", () => syncEngine.keepRemote())}
                >
                    保留云端
                </Button>
            </div>
        </div>
    {/if}

    <p class={cn("text-[11px] leading-relaxed", statusTone)}>
        状态：{status.message}
        {#if status.at}· {formatTime(status.at)}{/if}
    </p>

    {#if report}
        <div
            class={cn(
                "flex flex-col gap-0.5 rounded-lg border p-2.5 text-[11px] leading-relaxed",
                !report.ok && "border-destructive bg-destructive/5",
            )}
        >
            {#each report.lines as line}
                <p>{line}</p>
            {/each}
        </div>
    {/if}

    <details class="group">
        <summary
            class="text-muted-foreground hover:text-foreground cursor-pointer list-none text-[11px] select-none"
        >
            <span class="group-open:hidden">▸ 更多操作</span>
            <span class="hidden group-open:inline">▾ 更多操作</span>
        </summary>

        <div class="mt-2.5 flex flex-col gap-2.5">
            <div class="flex items-center justify-between gap-3">
                <Label for="sync-auto" class="text-xs font-normal">自动同步</Label>
                <Switch
                    id="sync-auto"
                    checked={autoSync}
                    onCheckedChange={(checked) => setAutoSync(checked)}
                    size="sm"
                />
            </div>

            <div class="flex flex-wrap items-center gap-2">
                <ConfirmActionButton
                    variant="outline"
                    size="xs"
                    idleLabel="用本地覆盖云端"
                    confirmLabel="确认覆盖"
                    disabled={busy !== ""}
                    onConfirm={() => forceUpload()}
                />
                <ConfirmActionButton
                    variant="outline"
                    size="xs"
                    idleLabel="用云端覆盖本地"
                    confirmLabel="确认覆盖"
                    disabled={busy !== ""}
                    onConfirm={() => forceDownload()}
                />
                <ConfirmActionButton
                    variant="ghost"
                    size="xs"
                    idleLabel="忘记同步记录"
                    confirmLabel="确认忘记"
                    disabled={busy !== ""}
                    onConfirm={() => {
                        syncEngine.forgetLocalSyncState();
                        report = null;
                        refreshLocalBytes();
                        toast?.show(
                            "已忘记同步记录",
                            "下次同步会按「首次同步」处理，云端数据没有动。",
                        );
                    }}
                />
            </div>

            <p class="text-muted-foreground text-[11px]">
                本地 {formatBytes(localBytes)} · 云端 {status.remoteCount} 项
            </p>
        </div>
    </details>
</section>
