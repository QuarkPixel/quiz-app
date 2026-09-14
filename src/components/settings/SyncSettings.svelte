<script lang="ts">
    import { onMount, onDestroy } from "svelte";
    import { slide } from "svelte/transition";
    import { cubicOut } from "svelte/easing";
    import { Button } from "$lib/components/ui/button";
    import { Input } from "$lib/components/ui/input";
    import { Label } from "$lib/components/ui/label";
    import { Switch } from "$lib/components/ui/switch";
    import * as Tooltip from "$lib/components/ui/tooltip";
    import AlertToast from "../layout/AlertToast.svelte";
    import ConfirmActionButton from "$lib/components/ConfirmActionButton.svelte";
    import SyncGuideDrawer from "./SyncGuideDrawer.svelte";
    import { cn } from "$lib/utils";
    import IconCloud from "@tabler/icons-svelte/icons/cloud";
    import IconCloudOff from "@tabler/icons-svelte/icons/cloud-off";
    import IconCloudCheck from "@tabler/icons-svelte/icons/cloud-check";
    import IconCloudUp from "@tabler/icons-svelte/icons/cloud-up";
    import IconCloudUpload from "@tabler/icons-svelte/icons/cloud-upload";
    import IconCloudDownload from "@tabler/icons-svelte/icons/cloud-download";
    import IconCloudPlus from "@tabler/icons-svelte/icons/cloud-plus";
    import IconEdit from "@tabler/icons-svelte/icons/edit";
    import IconEye from "@tabler/icons-svelte/icons/eye";
    import IconEyeOff from "@tabler/icons-svelte/icons/eye-off";
    import IconHelpCircle from "@tabler/icons-svelte/icons/help-circle";
    import IconInfoCircle from "@tabler/icons-svelte/icons/info-circle";
    import IconExternalLink from "@tabler/icons-svelte/icons/external-link";
    import IconCheck from "@tabler/icons-svelte/icons/check";
    import { syncConfigStore } from "@/features/sync/config.svelte";
    import { syncEngine } from "@/features/sync/engine.svelte";
    import { collectLocalFiles } from "@/features/sync/collect";
    import { maskToken } from "@/features/sync/target";
    import { mtimeOf } from "@/features/sync/storage";
    import { looksLikeSyncGist } from "@/features/sync/types";
    import type { GistSummary } from "@/features/sync/gitee";
    import { IconChevronDown } from "@tabler/icons-svelte";

    let toast: AlertToast;

    /** 总开关：关掉只是不显示、不自动跑，令牌仍留着。 */
    let enabled = $state(syncConfigStore.value.enabled);
    /** 编辑态：首次没配置时直接进；保存后退出。 */
    let editing = $state(false);
    /** 这次编辑是不是「第一次」（本地从没存过令牌）。首次编辑不显示状态行、取消、更多操作。 */
    let firstEdit = $state(false);

    let draftToken = $state("");
    let keyVisible = $state(false);
    let autoSync = $state(syncConfigStore.value.autoSync);
    let busy = $state<"" | "test" | "merge" | "push" | "pull">("");
    /** 最近一次自检的结果，合并进状态行展示（不再单独弹一个红框）。 */
    let checkResult = $state<{ ok: boolean; text: string } | null>(null);

    let guideOpen = $state(false);
    let advancedOpen = $state(false);

    // ── 云端代码片段的选择 ──
    /** 测试连接拉回来的列表；null = 还没测过 */
    let gists = $state<GistSummary[] | null>(null);
    /** 选中的 id；空字符串表示「新建一条」 */
    let pickedId = $state("");
    const NEW_GIST = "__new__";

    const status = $derived(syncEngine.status);
    const savedGistId = $derived(syncConfigStore.value.gistId);
    const hasSavedToken = $derived(syncConfigStore.value.token.length > 0);
    const draftValid = $derived(draftToken.trim().length > 0);

    /**
     * 云端的题库 / 文件数量。
     *
     * 直接读引擎状态，**不要**在挂载时拷一份到本地 `$state`——那样这份数字
     * 只在打开面板那一刻是对的，后台同步完也不会更新（线上表现：永远显示 0）。
     */
    const remoteFileCount = $derived(status.remoteCount);
    const remoteBankCount = $derived(status.remoteBanks);

    /** 列表里看起来是本应用建的那些。 */
    const syncGists = $derived(
        (gists ?? []).filter((g) => looksLikeSyncGist(g)),
    );

    /** 状态行的文字与颜色：自检结果优先，其次引擎状态。 */
    const statusText = $derived(checkResult?.text ?? status.message);
    const statusOk = $derived(
        checkResult
            ? checkResult.ok
            : status.phase !== "error" && status.phase !== "offline",
    );

    // 本地数据量：操作完成后算一次就够，不必跟随每次写入重算
    let localBytes = $state(0);
    function refreshLocalBytes(): void {
        localBytes = collectLocalFiles(mtimeOf).reduce(
            (sum, file) => sum + JSON.stringify(file.snapshot).length,
            0,
        );
    }
    let unsubscribe: (() => void) | null = null;

    onMount(() => {
        refreshLocalBytes();
        const neverConfigured = syncConfigStore.value.token.length === 0;
        editing = neverConfigured;
        firstEdit = neverConfigured;
        draftToken = syncConfigStore.value.token;
        pickedId = syncConfigStore.value.gistId;

        unsubscribe = syncEngine.subscribe((event) => {
            if (event.kind === "synced") {
                checkResult = null;
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

    // ── 开关 ────────────────────────────────────────────────────────────────

    function setEnabled(next: boolean): void {
        enabled = next;
        syncConfigStore.update({ enabled: next });
        if (next) {
            if (!hasSavedToken) {
                firstEdit = true;
                editing = true;
            }
        } else {
            editing = false;
            firstEdit = false;
            checkResult = null;
            gists = null;
        }
    }

    // ── 编辑态 ──────────────────────────────────────────────────────────────

    function startEditing(): void {
        draftToken = syncConfigStore.value.token;
        pickedId = syncConfigStore.value.gistId;
        keyVisible = false;
        firstEdit = false;
        editing = true;
        checkResult = null;
        gists = null;
    }

    function cancelEditing(): void {
        draftToken = syncConfigStore.value.token;
        pickedId = syncConfigStore.value.gistId;
        editing = false;
        checkResult = null;
        gists = null;
    }

    /** 清空持久化配置，并把总开关关掉；当前输入令牌只留在本次面板生命周期内。 */
    function clearConfig(): void {
        const tokenToKeep = syncConfigStore.value.token || draftToken;
        syncConfigStore.update({
            token: "",
            gistId: "",
            gistUrl: "",
            enabled: false,
        });
        enabled = false;
        draftToken = tokenToKeep;
        pickedId = "";
        gists = null;
        editing = false;
        firstEdit = true;
        checkResult = null;
        syncEngine.forgetGist();
        refreshLocalBytes();
        toast?.show("已清空云同步配置", "Gitee Gists 上仍有保留。");
    }

    /** 保存：记住令牌 + 选中的代码片段，然后退出编辑态。 */
    function save(): void {
        const selectedId = pickedId === NEW_GIST ? "" : pickedId;
        const picked = gists?.find((g) => g.id === selectedId);
        const changedGist = selectedId !== savedGistId;

        syncConfigStore.update({
            token: draftToken,
            enabled: true,
            gistId: selectedId,
            gistUrl:
                picked?.htmlUrl ??
                (changedGist ? "" : syncConfigStore.value.gistUrl),
        });
        // 换了云端 = 换了基准，旧记账对新云端没有意义（留着会把整包判成冲突）
        if (changedGist) {
            syncEngine.selectGist(selectedId, picked?.htmlUrl ?? "");
        }

        enabled = true;
        editing = false;
        firstEdit = false;
        gists = null;
        toast?.show(
            "云同步已保存",
            selectedId
                ? "已选定云端代码片段，正在同步…"
                : "第一次同步会新建一条代码片段，正在同步…",
        );
        // 立刻同步一次：选了已有的是「马上把云端拉下来」，选新建的是「马上把 Gist
        // 建出来并回填 id」。否则面板会一直停在「第一次同步时新建」，
        // 用户也不知道到底有没有生效。
        syncNow();
    }

    // ── 动作 ────────────────────────────────────────────────────────────────

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

    /**
     * 测试连接：验令牌，然后**把账号里的代码片段列出来**让用户挑。
     *
     * 列表是这一步的关键——新设备没有本地记的 Gist ID，不列出来就只能闷头新建一条，
     * 于是「同一个令牌在别处同步」永远拿不到已有数据。
     */
    function testConnection(): void {
        void withBusy("test", async () => {
            // 先落令牌：列表接口要用它
            syncConfigStore.update({ token: draftToken });

            const result = await syncEngine.testConnection();
            if (!result.ok) {
                checkResult = { ok: false, text: result.message };
                gists = null;
                return;
            }

            if (!firstEdit) {
                syncConfigStore.update({ token: draftToken, enabled: true });
                enabled = true;
                editing = false;
                checkResult = null;
                toast?.show("连接正常", result.message, "success");
                return;
            }

            try {
                const list = await syncEngine.listGists(draftToken);
                gists = list;

                const ours = list.filter((g) => looksLikeSyncGist(g));
                // 默认选中：已经选着的 > 当前正在用的 > 最近更新的那条 > 新建
                if (list.some((g) => g.id === pickedId)) {
                    // 保持用户已经选好的
                } else if (list.some((g) => g.id === savedGistId)) {
                    pickedId = savedGistId;
                } else {
                    pickedId = ours[0]?.id ?? NEW_GIST;
                }

                if (pickedId === "") pickedId = NEW_GIST;

                checkResult = {
                    ok: true,
                    text: `令牌有效 · 账号里共 ${list.length} 条代码片段，其中 ${ours.length} 条可用于同步`,
                };
            } catch (error) {
                checkResult = {
                    ok: false,
                    text:
                        error instanceof Error ? error.message : String(error),
                };
                gists = null;
            }
        });
    }

    function syncNow(): void {
        void withBusy("merge", async () => {
            const outcome = await syncEngine.sync();
            if (outcome.conflicts.length > 0) {
                // 冲突时给出明确指引：上面会出现「保留本地 / 保留云端」的选择
                toast?.show(
                    "有题库两边都改过",
                    `${outcome.conflicts.length} 个题库需要你选择保留哪一边`,
                    "destructive",
                );
                return;
            }
            toast?.show(
                "同步完成",
                `上传 ${outcome.pushed} · 下载 ${outcome.pulled} 个题库`,
                "success",
            );
        });
    }

    function forceUpload(): void {
        void withBusy("push", async () => {
            const outcome = await syncEngine.pushLocal();
            toast?.show(
                "已用本地覆盖云端",
                `上传 ${outcome.pushed} 个题库`,
                "success",
            );
        });
    }

    /**
     * 重建云端：丢掉本地记的 Gist 与同步记账，立刻新建一条并把本地推上去。
     *
     * 用在「云端那条 Gist 被删了 / 令牌换了账号」这种怎么同步都 404 的情况。
     * 令牌留着（不用重填），旧的那条 Gist 还在 Gitee 上，需要的话自己去删。
     */
    function rebuildCloud(): void {
        syncEngine.forgetGist();
        gists = null;
        toast?.show("已断开原云端", "正在新建一条并重新上传…");
        syncNow();
    }

    function forceDownload(): void {
        void withBusy("pull", async () => {
            // 下载成功后会整页刷新，这里不必再提示
            await syncEngine.pullRemote();
        });
    }

    function setAutoSync(next: boolean): void {
        autoSync = next;
        syncConfigStore.update({ autoSync: next });
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
<SyncGuideDrawer bind:open={guideOpen} />

{#snippet gistOption(value: string, title: string, meta: string)}
    <label
        data-slot="gist-option"
        data-value={value}
        class={cn(
            "flex cursor-pointer items-start gap-2 px-2.5 py-2 transition-colors",
            pickedId === value
                ? "bg-accent"
                : "hover:bg-accent/60 focus-within:bg-accent/60",
        )}
    >
        <input
            type="radio"
            name="sync-gist"
            class="sr-only"
            {value}
            checked={pickedId === value}
            onchange={() => (pickedId = value)}
        />
        <span class="flex min-w-0 flex-1 flex-col gap-0.5">
            <span class="truncate text-xs font-medium">{title}</span>
            <span
                class="text-muted-foreground truncate text-[11px]"
                data-slot="gist-option-meta">{meta}</span
            >
        </span>
        {#if pickedId === value}
            <IconCheck size={14} stroke={2} class="mt-px shrink-0" />
        {/if}
    </label>
{/snippet}

<section class="flex flex-col gap-3">
    <!-- ── 标题行：标签 + 说明 + 开关 ─────────────────────────────────── -->
    <div class="flex items-center justify-between gap-3">
        <Label
            for="sync-enabled"
            class="flex items-center gap-2 text-sm font-normal"
        >
            {#if enabled && !statusOk}
                <IconCloudOff size={15} stroke={1.5} class="text-destructive" />
            {:else if enabled}
                <IconCloud size={15} stroke={1.5} />
            {:else}
                <IconCloudOff size={15} stroke={1.5} />
            {/if}
            云同步
        </Label>

        <div class="flex items-center gap-1.5">
            <Button
                variant="ghost"
                size="icon-xs"
                class="text-muted-foreground hover:text-foreground"
                title="云同步说明"
                aria-label="云同步说明"
                onclick={() => (guideOpen = true)}
            >
                <IconInfoCircle size={14} stroke={1.5} />
            </Button>
            <Switch
                id="sync-enabled"
                checked={enabled}
                onCheckedChange={(checked) => setEnabled(checked)}
                size="sm"
            />
        </div>
    </div>

    {#if enabled}
        <div
            class="flex flex-col gap-3"
            transition:slide={{ duration: 220, easing: cubicOut }}
        >
            {#if syncEngine.storageBlocked}
                <p
                    class="border-destructive/40 bg-destructive/5 text-destructive rounded-lg border p-2.5 text-[11px] leading-relaxed"
                >
                    这台设备<strong>写不了本地存储</strong>（iOS
                    隐私模式 / 系统拦截？）：做题进度不会保存，云同步也没法工作。
                    换普通窗口、关掉隐私模式，或改用主屏幕上的那个应用图标再试。
                </p>
            {/if}
            {#if editing}
                <!-- ── 编辑态 ─────────────────────────────────────────── -->
                <div class="flex gap-2">
                    <Input
                        bind:value={draftToken}
                        type={keyVisible ? "text" : "password"}
                        placeholder="Gitee 私人令牌"
                        aria-label="Gitee 私人令牌"
                        class="font-mono text-[11px]"
                        oninput={() => {
                            checkResult = null;
                            gists = null;
                        }}
                        onkeydown={(event) => {
                            if (event.key === "Enter" && draftValid)
                                testConnection();
                        }}
                    />
                    <Button
                        variant="outline"
                        size="icon"
                        class="shrink-0"
                        title={keyVisible ? "隐藏" : "显示"}
                        aria-label={keyVisible ? "隐藏令牌" : "显示令牌"}
                        onclick={() => (keyVisible = !keyVisible)}
                    >
                        {#if keyVisible}
                            <IconEyeOff size={15} stroke={1.5} />
                        {:else}
                            <IconEye size={15} stroke={1.5} />
                        {/if}
                    </Button>
                </div>

                <p class="text-muted-foreground text-[11px] leading-relaxed">
                    在 <a
                        class="underline underline-offset-2"
                        href="https://gitee.com/profile/personal_access_tokens"
                        target="_blank"
                        rel="noreferrer">Gitee → 设置 → 私人令牌</a
                    >
                    生成，只勾 <code>gists</code> 即可。令牌只存在这台设备上，
                    <strong>不会上传</strong>。
                </p>

                <Button
                    variant="outline"
                    size="sm"
                    class="w-full"
                    disabled={!draftValid || busy !== ""}
                    onclick={() => testConnection()}
                >
                    <IconCloudCheck size={15} stroke={1.5} />
                    {busy === "test"
                        ? "测试中…"
                        : firstEdit
                          ? "测试连接"
                          : "测试连接并保存"}
                </Button>

                <!-- ── 选一条代码片段 ─────────────────────────────── -->
                {#if gists !== null}
                    <div
                        class="flex flex-col gap-2"
                        transition:slide={{ duration: 200, easing: cubicOut }}
                    >
                        <p class="text-xs font-medium">选择要同步的代码片段</p>

                        <!--
                            这里原来挂的是 shadcn 的 Select。它在这个面板里注定难用：
                            弹层要在 Dialog（z-[60]、overflow-hidden）里开，既要压 z-index、
                            又会被祖先的 overflow 裁；条目还是单行 nowrap，长长一条 id
                            就把弹层撑得比面板还宽，触发器里的字也被硬切掉。
                            干脆摊成一份常驻的单选列表，每条两行：一行说「选哪条」，
                            一行放时间与 id。没有浮层，也就没有层级和裁剪的问题。
                        -->
                        <div
                            role="radiogroup"
                            aria-label="选择要同步的代码片段"
                            class="border-input divide-border/60 max-h-56 divide-y overflow-y-auto rounded-lg border"
                        >
                            {@render gistOption(
                                NEW_GIST,
                                "新建一条",
                                "云端还没有，同步时新建",
                            )}
                            {#each syncGists as gist (gist.id)}
                                {@render gistOption(
                                    gist.id,
                                    `${gist.fileNames.length} 个文件`,
                                    `更新于 ${formatTime(gist.updatedAt)} · ${gist.id}`,
                                )}
                            {/each}
                        </div>
                    </div>
                {/if}

                <div class="flex items-center gap-2">
                    {#if firstEdit && gists !== null}
                        <Button
                            size="sm"
                            class="w-full"
                            disabled={busy !== ""}
                            onclick={() => save()}
                        >
                            <IconCheck size={15} stroke={1.5} />
                            保存
                        </Button>
                    {/if}
                    {#if !firstEdit}
                        <Button
                            variant="ghost"
                            size="sm"
                            disabled={busy !== ""}
                            onclick={() => cancelEditing()}
                        >
                            取消
                        </Button>
                    {/if}

                    {#if savedGistId.length > 0 && !firstEdit}
                        <ConfirmActionButton
                            variant="ghost"
                            size="sm"
                            class="text-destructive hover:text-destructive ml-auto"
                            idleLabel="清空配置"
                            confirmLabel="确认清空"
                            disabled={busy !== ""}
                            onConfirm={() => clearConfig()}
                        />
                    {/if}
                </div>
            {:else}
                <!-- ── 常规态 ─────────────────────────────────────────── -->
                <div class="flex items-center gap-2">
                    <div class="relative min-w-0 flex-1">
                        <Input
                            value={maskToken(syncConfigStore.value.token)}
                            readonly
                            tabindex={-1}
                            aria-label="已保存的 Gitee 令牌（已打码）"
                            class="cursor-default pr-8 font-mono text-[11px]"
                        />
                        <Button
                            variant="ghost"
                            size="icon-xs"
                            class="text-muted-foreground hover:text-foreground absolute end-1 top-1/2 -translate-y-1/2!"
                            title="修改配置"
                            aria-label="修改配置"
                            disabled={busy !== ""}
                            onclick={() => startEditing()}
                        >
                            <IconEdit size={13} stroke={1.5} />
                        </Button>
                    </div>
                    <Button
                        variant="outline"
                        size="icon"
                        class="shrink-0"
                        title="测试连接"
                        aria-label="测试连接"
                        disabled={busy !== ""}
                        onclick={() => testConnection()}
                    >
                        <IconCloudCheck size={15} stroke={1.5} />
                    </Button>
                </div>

                <Button
                    variant="outline"
                    size="sm"
                    class="w-full"
                    disabled={busy !== ""}
                    onclick={() => syncNow()}
                >
                    <IconCloudUp size={15} stroke={1.5} />
                    {busy === "merge" ? "同步中…" : "立即同步"}
                </Button>

                {#if !firstEdit}
                    <p
                        class={cn(
                            "text-[11px] leading-relaxed",
                            statusOk
                                ? "text-muted-foreground"
                                : "text-destructive",
                        )}
                    >
                        {statusText}
                        {#if status.at && !checkResult}· {formatTime(
                                status.at,
                            )}{/if}
                    </p>
                {/if}

                <!-- ── 冲突：同一个题库两边都改过，等用户拍板 ─────────────── -->
                {#if status.conflicts.length > 0}
                    <div
                        class="border-warning/40 bg-warning/5 flex flex-col gap-2 rounded-lg border p-2.5"
                    >
                        <p class="text-xs font-medium">
                            {status.conflicts.length} 个题库两边都改过，请选择保留哪一边：
                        </p>
                        <ul class="text-muted-foreground flex flex-col gap-0.5">
                            {#each status.conflicts.slice(0, 5) as conflict (conflict.hash)}
                                <li class="truncate text-[11px]">
                                    {conflict.name}
                                    <span class="font-mono opacity-60"
                                        >{conflict.hash.slice(0, 8)}</span
                                    >
                                </li>
                            {/each}
                            {#if status.conflicts.length > 5}
                                <li class="text-[11px]">
                                    还有 {status.conflicts.length - 5} 个…
                                </li>
                            {/if}
                        </ul>
                        <div class="flex gap-2">
                            <Button
                                size="sm"
                                class="flex-1"
                                disabled={busy !== ""}
                                onclick={() =>
                                    void withBusy("merge", () =>
                                        syncEngine.keepLocal(),
                                    )}
                            >
                                保留本地
                            </Button>
                            <Button
                                variant="outline"
                                size="sm"
                                class="flex-1"
                                disabled={busy !== ""}
                                onclick={() =>
                                    void withBusy("merge", () =>
                                        syncEngine.keepRemote(),
                                    )}
                            >
                                保留云端
                            </Button>
                        </div>
                    </div>
                {/if}

                <div>
                    <Button
                        variant="ghost"
                        size="sm"
                        class="p-0 bg-transparent! w-full justify-start"
                        onclick={() => (advancedOpen = !advancedOpen)}
                    >
                        <IconChevronDown
                            size={15}
                            stroke={1.5}
                            class={cn(
                                "transition-transform duration-200",
                                advancedOpen && "rotate-180",
                            )}
                        />
                        更多操作
                    </Button>

                    {#if advancedOpen}
                        <div
                            class="mt-2 flex flex-col gap-3"
                            transition:slide={{
                                duration: 200,
                                easing: cubicOut,
                            }}
                        >
                            <Label
                                for="sync-auto"
                                class="flex items-center gap-1.5 text-xs font-normal"
                            >
                                自动同步
                                <Switch
                                    id="sync-auto"
                                    checked={autoSync}
                                    onCheckedChange={(checked) =>
                                        setAutoSync(checked)}
                                    size="sm"
                                />
                                <Tooltip.Root>
                                    <Tooltip.Trigger>
                                        {#snippet child({ props })}
                                            <button
                                                {...props}
                                                type="button"
                                                class="text-muted-foreground hover:text-foreground inline-flex"
                                                aria-label="关于自动同步"
                                            >
                                                <IconHelpCircle
                                                    size={13}
                                                    stroke={1.5}
                                                />
                                            </button>
                                        {/snippet}
                                    </Tooltip.Trigger>
                                    <Tooltip.Content
                                        side="top"
                                        align="start"
                                        class="max-w-64"
                                    >
                                        <span class="text-xs leading-relaxed">
                                            打开 /
                                            刷新页面时先对一次账；本地改动停手
                                            20
                                            秒后自动上传；切回页面时、以及页面开着时每
                                            3
                                            分钟各检查一次云端。关掉后只有点「立即同步」才同步。
                                        </span>
                                    </Tooltip.Content>
                                </Tooltip.Root>
                            </Label>

                            <div class="flex gap-2">
                                <ConfirmActionButton
                                    variant="outline"
                                    size="sm"
                                    class="flex-1"
                                    confirmClass="ring-destructive/40 ring-2"
                                    idleLabel="用本地覆盖云端"
                                    confirmLabel="确认覆盖"
                                    disabled={busy !== ""}
                                    onConfirm={() => forceUpload()}
                                >
                                    {#snippet children({ confirming })}
                                        <IconCloudUpload
                                            size={14}
                                            stroke={1.5}
                                        />
                                        {confirming
                                            ? "确认覆盖"
                                            : "用本地覆盖云端"}
                                    {/snippet}
                                </ConfirmActionButton>
                                <ConfirmActionButton
                                    variant="outline"
                                    size="sm"
                                    class="flex-1"
                                    confirmClass="ring-destructive/40 ring-2"
                                    idleLabel="用云端覆盖本地"
                                    confirmLabel="确认覆盖"
                                    disabled={busy !== ""}
                                    onConfirm={() => forceDownload()}
                                >
                                    {#snippet children({ confirming })}
                                        <IconCloudDownload
                                            size={14}
                                            stroke={1.5}
                                        />
                                        {confirming
                                            ? "确认覆盖"
                                            : "用云端覆盖本地"}
                                    {/snippet}
                                </ConfirmActionButton>
                            </div>

                            <ConfirmActionButton
                                variant="outline"
                                size="sm"
                                class="w-full"
                                confirmClass="ring-destructive/40 ring-2"
                                idleLabel="重建云端"
                                confirmLabel="确认重建"
                                idleTitle="丢掉本地记的 Gist 与同步记账（令牌留着），新建一条并上传本地数据"
                                confirmTitle="确认后会在 Gitee 上新建一条 Gist；旧的不会被删除，需要的话自己去删"
                                disabled={busy !== ""}
                                onConfirm={() => rebuildCloud()}
                            >
                                {#snippet children({ confirming })}
                                    <IconCloudPlus size={14} stroke={1.5} />
                                    {confirming ? "确认重建" : "重建云端"}
                                {/snippet}
                            </ConfirmActionButton>

                            <!-- ── 云端代码片段 ───────────────────────────── -->
                            <div
                                class="text-muted-foreground flex flex-col gap-1 text-[11px]"
                            >
                                <div
                                    class="flex items-center justify-start gap-3"
                                >
                                    <span>同步到</span>
                                    {#if savedGistId}
                                        <a
                                            class="text-foreground inline-flex items-center gap-1 font-mono underline underline-offset-2"
                                            href={syncConfigStore.value
                                                .gistUrl ||
                                                "https://gitee.com/dashboard/gists"}
                                            target="_blank"
                                            rel="noreferrer"
                                            title="在 Gitee 上打开这条代码片段"
                                        >
                                            {savedGistId}
                                            <IconExternalLink
                                                size={12}
                                                stroke={1.5}
                                            />
                                        </a>
                                    {:else}
                                        <span>第一次同步时新建</span>
                                    {/if}
                                </div>
                                <p
                                    class="text-muted-foreground text-[11px] leading-relaxed"
                                >
                                    换一条云端：点上面的铅笔图标进编辑态，
                                    测试连接后另选一条保存即可。
                                </p>
                                <div
                                    class="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5"
                                >
                                    <span>本地 {formatBytes(localBytes)}</span>
                                    <span>
                                        云端 {remoteBankCount} 个题库
                                        {#if savedGistId}· {remoteFileCount} 个文件{/if}
                                    </span>
                                </div>
                            </div>
                        </div>
                    {/if}
                </div>
            {/if}
        </div>
    {/if}
</section>
