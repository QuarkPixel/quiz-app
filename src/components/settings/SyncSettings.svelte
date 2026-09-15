<script lang="ts">
    import { onMount, onDestroy, type Component } from "svelte";
    import { slide } from "svelte/transition";
    import { cubicOut } from "svelte/easing";
    import { Button } from "$lib/components/ui/button";
    import { Input } from "$lib/components/ui/input";
    import { Label } from "$lib/components/ui/label";
    import { Switch } from "$lib/components/ui/switch";
    import * as Tooltip from "$lib/components/ui/tooltip";
    import ConfirmActionButton from "$lib/components/ConfirmActionButton.svelte";
    import Identicon from "../Identicon.svelte";
    import { preloadIdenticon } from "$lib/identicon";
    import { cn } from "$lib/utils";
    import { formatAbsoluteTime, formatRelativeTime } from "$lib/time";
    import IconCloud from "@tabler/icons-svelte/icons/cloud";
    import IconCloudOff from "@tabler/icons-svelte/icons/cloud-off";
    import IconCloudCheck from "@tabler/icons-svelte/icons/cloud-check";
    import IconCloudUp from "@tabler/icons-svelte/icons/cloud-up";
    import IconCloudUpload from "@tabler/icons-svelte/icons/cloud-upload";
    import IconCloudDownload from "@tabler/icons-svelte/icons/cloud-download";
    import IconTrashX from "@tabler/icons-svelte/icons/trash-x";
    import IconDatabasePlus from "@tabler/icons-svelte/icons/database-plus";
    import IconEdit from "@tabler/icons-svelte/icons/edit";
    import IconEye from "@tabler/icons-svelte/icons/eye";
    import IconEyeOff from "@tabler/icons-svelte/icons/eye-off";
    import IconChevronDown from "@tabler/icons-svelte/icons/chevron-down";
    import IconCheck from "@tabler/icons-svelte/icons/check";
    import { SYNC_VERIFIED_FLASH_MS } from "@/config";
    import { toastStore } from "@/features/toast.svelte";
    import { syncConfigStore } from "@/features/sync/config.svelte";
    import { syncEngine } from "@/features/sync/engine.svelte";
    import { collectLocalState, filesOfState } from "@/features/sync/collect";
    import { maskToken } from "@/features/sync/target";
    import { describeSyncResult } from "@/features/sync/summary";
    import { mtimeOf } from "@/features/sync/storage";
    import { looksLikeSyncGist } from "@/features/sync/types";
    import type { GistSummary } from "@/features/sync/gitee";
    import {
        IconArrowUpRight,
        IconHelp,
        IconRosetteDiscountCheckFilled,
    } from "@tabler/icons-svelte";

    /** 总开关：关掉只是不显示、不自动跑，令牌仍留着。 */
    let enabled = $state(syncConfigStore.value.enabled);
    /** 编辑态：首次没配置时直接进；保存后退出。 */
    let editing = $state(false);
    /** 这次编辑是不是「第一次」（本地从没存过令牌）。首次编辑不显示状态行、取消。 */
    let firstEdit = $state(false);

    let draftToken = $state("");
    let keyVisible = $state(false);
    let autoSync = $state(syncConfigStore.value.autoSync);
    let busy = $state<"" | "test" | "delete" | "merge" | "push" | "pull">("");
    /**
     * 最近一次「测试连接」的结果：只用来给那个按钮上色（绿 / 红）。
     *
     * **不再在面板里写一行字**——成了就变绿、并列出片段；失败就变红，
     * 具体原因交给全局提示（toast）说。`null` = 还没测过（按钮保持常态）。
     */
    let testState = $state<"ok" | "error" | null>(null);

    let guideOpen = $state(false);

    /**
     * 说明抽屉是**按需加载**的。
     *
     * 它写着一份很长的说明，还带着 `vaul-svelte`（抽屉组件，约 26 kB + 5 kB CSS）
     * ——而这些只有真的点开「说明」才用得上，没必要跟着面板一起进主包。
     * 第一次点开时拉一次，之后一直复用。
     */
    let GuideDrawer = $state<Component<{ open: boolean }> | null>(null);

    $effect(() => {
        if (!guideOpen || GuideDrawer !== null) return;
        void import("./SyncGuideDrawer.svelte").then((module) => {
            GuideDrawer = module.default;
        });
    });
    /**
     * 相对时间的「心跳」。
     *
     * 面板只在弹窗打开时挂载，所以这一个每秒一次的定时器代价可以忽略；
     * 它只是让「20 秒前」真的会往前走，而不是打开时算一次就冻住。
     */
    let now = $state(Date.now());

    /** 「更多设置」展开：自动同步 + 两个覆盖按钮收在里面。 */
    let detailsOpen = $state(false);

    // ── 云端代码片段的选择 ──
    /** 测试连接拉回来的列表；null = 还没测过 */
    let gists = $state<GistSummary[] | null>(null);
    /** 选中的 id；空字符串表示「新建」 */
    let pickedId = $state("");
    const NEW_GIST = "__new__";

    /**
     * 代码片段列表每行行首的图标边长（px）。
     *
     * 就是个死数：identicon 和「新建」的数据库图标取同一个值，两种行的文字
     * 左边缘才对得齐。（"撑满行高"那套 CSS 在浏览器里会把图标整个弄没，不折腾了。）
     */
    const ICON_SIZE = 30;

    /** 顶部「目标仓库」卡片里那张 identicon 的边长（px），比列表里的稍大一点。 */
    const CARD_ICON_SIZE = 40;

    const status = $derived(syncEngine.status);
    const savedGistId = $derived(syncConfigStore.value.gistId);
    const hasSavedToken = $derived(syncConfigStore.value.token.length > 0);
    const draftValid = $derived(draftToken.trim().length > 0);

    /**
     * 这份草稿「验过了吗」——只有测试连接成功（拿到列表）才算。
     *
     * 保存按钮靠它：**改一下令牌就先作废**（列表一起收起来），验过才给点。
     * 首次配置时它还是「保存按钮要不要出现」的开关：没验过连按钮都不显示。
     */
    const verified = $derived(testState === "ok" && gists !== null);

    /**
     * 云端的题库数量。
     *
     * 直接读引擎状态，**不要**在挂载时拷一份到本地 `$state`——那样这份数字
     * 只在打开面板那一刻是对的，后台同步完也不会更新（线上表现：永远显示 0）。
     */
    const remoteBankCount = $derived(status.remoteBanks);

    /** 列表里看起来是本应用建的那些。 */
    const syncGists = $derived(
        (gists ?? []).filter((g) => looksLikeSyncGist(g)),
    );

    /**
     * 目标仓库那张卡片里，状态是不是正常的。
     *
     * 只看引擎状态，**不掺编辑态的自检结果**——两条信息各自一个 DOM，
     * 否则「令牌有效 · 账号里共 2 条…」会跟着退出编辑态一起漏到卡片上来。
     */
    const statusOk = $derived(
        status.phase !== "error" && status.phase !== "offline",
    );

    /**
     * 卡片第二行：平时是「上次同步 …」，出错 / 离线时换成引擎那句话。
     *
     * 面板底下原来还有一行状态小字，已经取消了——「需要你知道的事」只剩这里一处，
     * 所以出错必须让它说，不能只留个时间。
     */
    /**
     * 卡片第二行：**只有**「上次同步 …」。
     *
     * 刻意不显示 `status.message`：出错交给**通知**（全局 toast）和页头那颗红点，
     * 卡片只放结构化的事实（目标是谁、上次同步什么时候、两边多少题库）。
     * 把一句解释写进这行，看着就像贴了张狗皮膏药。
     */
    const cardNote = $derived(
        status.lastSyncAt
            ? `上次同步：${formatRelativeTime(status.lastSyncAt, now)}`
            : "还没同步过",
    );

    /** 悬停时给绝对时间（相对时间适合扫一眼，真要对时间点还得看它）。 */
    const cardNoteTitle = $derived(
        status.lastSyncAt ? formatAbsoluteTime(status.lastSyncAt) : undefined,
    );

    /**
     * 展示页那个小按钮的「刚刚验过」：成功时图标换成绿勾，两秒后自己变回去。
     *
     * 编辑态那个按钮不走这套——它的绿勾要一直留着，直到改令牌或者保存。
     */
    let justVerified = $state(false);
    let revertTimer: ReturnType<typeof setTimeout> | null = null;

    function flashVerified(): void {
        justVerified = true;
        if (revertTimer !== null) clearTimeout(revertTimer);
        revertTimer = setTimeout(() => {
            justVerified = false;
            revertTimer = null;
        }, SYNC_VERIFIED_FLASH_MS);
    }

    onDestroy(() => {
        if (revertTimer !== null) clearTimeout(revertTimer);
    });

    // 本地的规模（题库数 + 大概多大）：操作完成后算一次就够，不必跟随每次写入重算
    let localBytes = $state(0);
    let localBankCount = $state(0);
    function refreshLocalBytes(): void {
        const state = collectLocalState(mtimeOf);
        localBankCount = state.banks.size;
        localBytes = filesOfState(state).reduce(
            (sum, file) => sum + JSON.stringify(file.snapshot).length,
            0,
        );
    }
    let unsubscribe: (() => void) | null = null;

    /**
     * 「打开云同步」= 头像引擎的加载触发点。
     *
     * `@dicebear/core` + 样式约 190 kB（gzip 28 kB），只有这一块会用到它；
     * 所以等这一块真的露出来（开关打开 / 面板打开且同步开着）再拉，首页和刷题
     * 界面一点都不用背。这里只预热，画不画由 `<Identicon>` 自己决定。
     */
    $effect(() => {
        if (enabled) void preloadIdenticon();
    });

    onMount(() => {
        refreshLocalBytes();
        const ticker = setInterval(() => (now = Date.now()), 1000);
        const neverConfigured = syncConfigStore.value.token.length === 0;
        editing = neverConfigured;
        firstEdit = neverConfigured;
        draftToken = syncConfigStore.value.token;
        pickedId = syncConfigStore.value.gistId;

        unsubscribe = syncEngine.subscribe((event) => {
            if (event.kind === "synced") {
                testState = null;
                refreshLocalBytes();
            } else if (event.kind === "conflict") {
                toastStore.show("发现同步冲突", event.message, "destructive");
            } else if (event.kind === "error") {
                toastStore.show("同步失败", event.message, "destructive");
            }
        });
        return () => {
            clearInterval(ticker);
            unsubscribe?.();
        };
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
            testState = null;
            gists = null;
        }
    }

    // ── 编辑态 ──────────────────────────────────────────────────────────────

    /**
     * 进编辑态（点铅笔图标「修改配置」）。
     *
     * 从这里开始**什么都不会落盘**：令牌、选中的片段都只活在 `draftToken` /
     * `pickedId` 里，直到点「保存」。以前「测试连接」会顺手把令牌写进配置，
     * 于是不点保存直接刷新页面，改动照样生效了。
     *
     * 进来就**自动验一次**：既省掉一次点击，也顺手把片段列表拉出来——
     * 「换一条云端」现在就走这条路（不再有单独的「切换目标 Gists」）。
     */
    function startEditing(): void {
        draftToken = syncConfigStore.value.token;
        pickedId = syncConfigStore.value.gistId;
        keyVisible = false;
        firstEdit = false;
        editing = true;
        testState = null;
        gists = null;
        if (draftValid) testConnection();
    }

    function cancelEditing(): void {
        draftToken = syncConfigStore.value.token;
        pickedId = syncConfigStore.value.gistId;
        editing = false;
        testState = null;
        gists = null;
    }

    /**
     * 清空配置：令牌、Gist、同步记账全清掉（`localStorage` 的键也一并删），
     * 并把总开关关掉。
     *
     * 顺序要紧：`clearSyncState()` 要读配置里的 key 来清记账，配置先删就没得清了。
     */
    function clearConfig(): void {
        syncEngine.clearSyncState("云同步配置已清空");
        syncConfigStore.clear();
        enabled = false;
        draftToken = "";
        pickedId = "";
        gists = null;
        editing = false;
        firstEdit = true;
        keyVisible = false;
        testState = null;
        refreshLocalBytes();
        toastStore.show("已清空云同步配置", "Gitee 上存储的代码片段仍被保留");
    }

    /** 保存：把草稿里的令牌 + 选中的代码片段写进配置，然后退出编辑态。 */
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
        // 自检结果只属于编辑态：带着它退出，下面那行状态文字会一直显示
        // 「令牌有效 · 账号里共 2 条…」（线上看到过）
        testState = null;
        toastStore.show(
            "云同步已保存",
            selectedId ? "正在同步…" : "正在新建云端片段…",
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
     * 拉一份账号里的代码片段列表，顺手定下默认选中项。
     *
     * 列表是这一步的关键——新设备没有本地记的 Gist ID，不列出来就只能闷头新建一条，
     * 于是「同一个令牌在别处同步」永远拿不到已有数据。
     *
     * `attempted` 是这次请求用的令牌：回来时如果草稿已经变了，这份结果就作废
     * （否则「进编辑态自动验一次」的响应会追着用户刚改的令牌，把列表又摆回来）。
     */
    async function loadGists(attempted: string): Promise<void> {
        try {
            const list = await syncEngine.listGists(attempted);
            if (attempted !== draftToken.trim()) return;
            gists = list;

            const ours = list.filter((g) => looksLikeSyncGist(g));
            // 默认选中：已经选着的 > 当前正在用的 > 最近更新的那条 > 新建
            if (!list.some((g) => g.id === pickedId)) {
                pickedId = list.some((g) => g.id === savedGistId)
                    ? savedGistId
                    : (ours[0]?.id ?? NEW_GIST);
            }
            if (pickedId === "") pickedId = NEW_GIST;

            testState = "ok";
        } catch (error) {
            if (attempted !== draftToken.trim()) return;
            testState = "error";
            gists = null;
            toastStore.show(
                "测试连接失败",
                error instanceof Error ? error.message : String(error),
                "destructive",
            );
        }
    }

    /**
     * 测试连接：验令牌，然后（编辑态里）**把账号里的代码片段列出来**让用户挑。
     *
     * 编辑态里用草稿令牌试（`testConnection(draftToken)`），成功与否都**不落盘**；
     * 常规态那一下试的是已经保存的配置。
     *
     * 反馈只有两处：**按钮自己变色**（成了绿、错了红）+ **失败时一条全局提示**。
     * 成功不弹提示——按钮变绿、列表出来，本身就是回执。
     */
    function testConnection(): void {
        void withBusy("test", async () => {
            if (!editing) {
                const result = await syncEngine.testConnection();
                testState = result.ok ? "ok" : "error";
                if (!result.ok) {
                    toastStore.show(
                        "测试连接失败",
                        result.message,
                        "destructive",
                    );
                } else {
                    // 展示页只要「亮一下」：两秒后回到原样（编辑态才一直留着绿勾）
                    flashVerified();
                }
                return;
            }

            const attempted = draftToken.trim();
            const result = await syncEngine.testConnection(attempted);
            // 期间又改了令牌 → 这次结果作废，列表与「已验过」都不算数
            if (attempted !== draftToken.trim()) return;
            if (!result.ok) {
                testState = "error";
                gists = null;
                toastStore.show("测试连接失败", result.message, "destructive");
                return;
            }
            await loadGists(attempted);
        });
    }

    /**
     * 删掉云端某条代码片段（列表里那个垃圾桶，点两下才走到这里）。
     *
     * 删掉的正好是当前正在同步的那条时，顺手断开连接：本地记的 id 与记账
     * 对一条已经不存在的 Gist 没有任何意义，留着只会一直报「Gist 不见了」。
     */
    function removeGist(gistId: string): void {
        void withBusy("delete", async () => {
            try {
                await syncEngine.deleteGist(gistId, draftToken);
            } catch (error) {
                toastStore.show(
                    "删除失败",
                    error instanceof Error ? error.message : String(error),
                    "destructive",
                );
                return;
            }

            gists = (gists ?? []).filter((g) => g.id !== gistId);
            if (pickedId === gistId) pickedId = NEW_GIST;

            if (savedGistId === gistId) {
                syncEngine.forgetGist();
                toastStore.show("当前目标已删除", "连接已断开", "destructive");
                return;
            }
            toastStore.show("已删除", gistId, "success");
        });
    }

    function syncNow(): void {
        void withBusy("merge", async () => {
            const outcome = await syncEngine.sync();
            if (outcome.conflicts.length > 0) {
                // 冲突时给出明确指引：上面会出现「保留本地 / 保留云端」的选择
                toastStore.show(
                    "存在题库冲突",
                    `${outcome.conflicts.length} 个题库冲突`,
                    "destructive",
                );
                return;
            }
            toastStore.show("同步完成", describeSyncResult(outcome), "success");
        });
    }

    function forceUpload(): void {
        void withBusy("push", async () => {
            const outcome = await syncEngine.pushLocal();
            toastStore.show(
                "已用本地覆盖云端",
                describeSyncResult(outcome),
                "success",
            );
        });
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

{#if GuideDrawer}
    <GuideDrawer bind:open={guideOpen} />
{/if}

{#snippet gistOption(value: string, primary: string, secondary: string)}
    <!--
        行是 div、里面才是 label：垃圾桶必须待在 label **外面**。
        在 label 里点任何东西都可能顺带选中这一行（HTML 的 label 激活规则在
        各实现里并不一致），删一条片段不该顺手改「同步到哪条」。
    -->
    <div
        data-slot="gist-option"
        data-value={value}
        class={cn(
            "flex items-center gap-2 px-2.5 py-2 transition-colors",
            pickedId === value
                ? "bg-accent"
                : "hover:bg-accent/60 focus-within:bg-accent/60",
        )}
    >
        <label class="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
            <input
                type="radio"
                name="sync-gist"
                class="sr-only"
                {value}
                checked={pickedId === value}
                onchange={() => (pickedId = value)}
            />
            {#if value === NEW_GIST}
                <!-- 还没建出来的那条：一眼看出是「新建」，不假装成一条已有片段 -->
                <IconDatabasePlus
                    size={ICON_SIZE}
                    stroke={1.5}
                    class="text-muted-foreground shrink-0"
                    aria-hidden="true"
                />
            {:else}
                <!-- 每条代码片段一张 identicon：seed 用 id，换条目就换一张脸 -->
                <Identicon seed={value} size={ICON_SIZE} />
            {/if}
            <!-- 主信息是 id（代码片段的名字就是这串 id，别的都是次要的） -->
            <span class="flex min-w-0 flex-1 flex-col gap-0.5">
                <span
                    class={cn(
                        "truncate text-xs font-medium",
                        value !== NEW_GIST && "font-mono",
                    )}
                    data-slot="gist-option-id">{primary}</span
                >
                <span
                    class="text-muted-foreground truncate text-[11px]"
                    data-slot="gist-option-meta">{secondary}</span
                >
            </span>
        </label>
        {#if pickedId === value}
            <IconCheck size={14} stroke={2} class="shrink-0" />
        {/if}
        {#if value !== NEW_GIST}
            <!--
                「新建」那一行没有东西可删，所以垃圾桶只出现在真片段上。
                点两下才真删（`ConfirmActionButton`）：第一下只是变成红圈确认态。
            -->
            <span class="flex shrink-0 items-center" data-slot="gist-delete">
                <ConfirmActionButton
                    unstyled
                    class="text-muted-foreground hover:text-destructive flex size-7 items-center justify-center rounded-full transition-colors"
                    confirmClass="text-destructive ring-destructive/40 ring-2"
                    idleTitle="删除此云端片段"
                    confirmTitle="再次点击以删除（不可恢复）"
                    aria-label={`删除代码片段 ${value}`}
                    disabled={busy !== ""}
                    onConfirm={() => removeGist(value)}
                >
                    {#snippet children()}
                        <IconTrashX size={14} stroke={1.5} />
                    {/snippet}
                </ConfirmActionButton>
            </span>
        {/if}
    </div>
{/snippet}

<section class="flex flex-col gap-3">
    <!-- ── 标题行：标签 + 说明 + 开关 ─────────────────────────────────── -->
    <div class="flex items-center justify-between gap-3">
        <div class="flex min-w-0 items-center">
            <Label class="flex shrink-0 items-center gap-2 text-sm font-bold">
                {#if enabled && !statusOk}
                    <IconCloudOff
                        size={15}
                        stroke={2}
                        class="text-destructive"
                    />
                {:else if enabled}
                    <IconCloud size={15} stroke={2} />
                {:else}
                    <IconCloudOff size={15} stroke={2} />
                {/if}
                云同步
            </Label>
            <Button
                variant="ghost"
                size="icon"
                class="rounded-full"
                title="云同步说明"
                aria-label="云同步说明"
                onclick={() => (guideOpen = true)}
            >
                <IconHelp size={14} stroke={1.5} />
            </Button>
        </div>

        <div class="flex shrink-0 items-center gap-1.5">
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
                    class="border-destructive/40 bg-destructive/5 text-destructive rounded-lg border p-2.5 text-[11px]"
                >
                    本地存储<strong>不可写</strong>（隐私模式？），进度无法保存
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
                            // 令牌一变，之前那次自检就不算数了：列表收起来、保存变灰
                            testState = null;
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
                    <a
                        class="underline underline-offset-2"
                        href="https://gitee.com/profile/personal_access_tokens"
                        target="_blank"
                        rel="noreferrer">Gitee → 设置 → 私人令牌</a
                    >，权限仅需 <code>gists</code>。令牌仅存储于本机，不会上传。
                </p>

                <!-- 反馈只有按钮自己：验过变绿、错了变红（具体原因走全局提示） -->
                <Button
                    variant={testState === "error" ? "destructive" : "outline"}
                    data-state={testState ?? "idle"}
                    size="sm"
                    class="w-full"
                    disabled={!draftValid || busy !== ""}
                    onclick={() => testConnection()}
                >
                    <IconCloudCheck size={15} stroke={1.5} />
                    {busy === "test" ? "测试中…" : "测试连接"}
                    {#if testState == "ok"}
                        <IconRosetteDiscountCheckFilled class="text-success" />
                    {/if}
                </Button>

                <!-- ── 选一条代码片段 ─────────────────────────────── -->
                {#if gists !== null}
                    <div
                        class="flex flex-col gap-2"
                        transition:slide={{ duration: 200, easing: cubicOut }}
                    >
                        <p class="text-xs font-medium">选择代码片段</p>

                        <!--
                            这里原来挂的是 shadcn 的 Select。它在这个面板里注定难用：
                            弹层要在 Dialog（z-(--z-dialog)、overflow-hidden）里开，既要压 z-index、
                            又会被祖先的 overflow 裁；条目还是单行 nowrap，长长一条 id
                            就把弹层撑得比面板还宽，触发器里的字也被硬切掉。
                            干脆摊成一份常驻的单选列表，每条两行：一行说「选哪条」，
                            一行放时间与 id。没有浮层，也就没有层级和裁剪的问题。
                        -->
                        <div
                            role="radiogroup"
                            aria-label="选择代码片段"
                            class="border-input divide-border/60 max-h-56 divide-y overflow-y-auto rounded-lg border"
                        >
                            {@render gistOption(
                                NEW_GIST,
                                "新建",
                                "新建代码片段",
                            )}
                            {#each syncGists as gist (gist.id)}
                                <!--
                                    每条只报「id + 更新时间」。云端题库数只有**当前用的
                                    那条**是现成的（上次自检 / 同步数出来的）；别的条目
                                    要数就得逐条拉内容，打开一次列表就是十几个请求，
                                    不值当——所以不报。
                                -->
                                {@render gistOption(
                                    gist.id,
                                    gist.id,
                                    gist.id === savedGistId
                                        ? `更新于 ${formatTime(gist.updatedAt)} · 云端 ${remoteBankCount} 个题库`
                                        : `更新于 ${formatTime(gist.updatedAt)}`,
                                )}
                            {/each}
                        </div>
                    </div>
                {/if}

                <div class="flex items-center gap-2">
                    <!--
                        保存是**唯一**落盘的地方：上面填的令牌、选的片段都只是草稿，
                        取消或直接刷新页面都不会生效（以前「测试连接」会顺手写进去）。

                        能点它的前提是「这次测试连接过了」（`verified`）：
                          - 第一次配置：没验过连按钮都不出现（列表也还没出来，没什么可保存的）；
                          - 再次编辑：按钮一直在，但验过之前是灰的；改了令牌立刻又变灰。
                    -->
                    {#if !firstEdit || verified}
                        <Button
                            size="sm"
                            class="flex-1"
                            disabled={!verified || busy !== ""}
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
                            class="text-destructive hover:text-destructive"
                            idleLabel="清空配置"
                            confirmLabel="确认清空"
                            idleTitle="清空本地同步配置"
                            confirmTitle="确认清空？本地题库与进度不受影响"
                            disabled={busy !== ""}
                            onConfirm={() => clearConfig()}
                        />
                    {/if}
                </div>
            {:else}
                <!--
                    ── 常规态：上面「信息展示」，下面「操作」────────────────
                    底下原来还有一行状态小字（「题库没有改动 · 09/15 10:41」+ 数据量），
                    已经并进上面那张卡片：需要知道的都在这儿，别处不再重复。
                -->
                <div class="flex flex-col gap-2" data-slot="sync-overview">
                    <p class="text-muted-foreground text-xs font-medium">
                        目标仓库
                    </p>

                    <div class="flex items-center gap-3">
                        {#if savedGistId}
                            <!-- 每条云端片段一张 identicon（seed 用 id） -->
                            <Identicon
                                seed={savedGistId}
                                size={CARD_ICON_SIZE}
                            />
                        {:else}
                            <span
                                class="border-input text-muted-foreground flex size-10 shrink-0 items-center justify-center rounded-full border border-dashed"
                                aria-hidden="true"
                            >
                                <IconDatabasePlus size={18} stroke={1.5} />
                            </span>
                        {/if}

                        <div class="flex min-w-0 flex-col gap-0.5">
                            {#if savedGistId}
                                <Button
                                    variant="link"
                                    class={cn(
                                        "text-foreground min-w-0 truncate font-mono text-sm underline-offset-2 hover:underline group p-0 gap-0 h-4",
                                        syncEngine.targetMissing &&
                                            "no-underline!",
                                    )}
                                    href={syncEngine.targetMissing
                                        ? null
                                        : syncConfigStore.value.gistUrl ||
                                          "https://gitee.com/dashboard/gists"}
                                    target="_blank"
                                    rel="noreferrer"
                                    title="在 Gitee 中打开"
                                >
                                    <span
                                        class={cn(
                                            syncEngine.targetMissing &&
                                                "line-through",
                                        )}>{savedGistId}</span
                                    >
                                    {#if syncEngine.targetMissing}
                                        <span
                                            class="text-destructive shrink-0 text-[11px]"
                                            >（已被删除）</span
                                        >
                                    {:else}
                                        <IconArrowUpRight
                                            class="group-hover:block hidden"
                                        />
                                    {/if}
                                </Button>
                            {:else}
                                <span class="text-sm">第一次同步时新建</span>
                            {/if}
                            <span
                                data-slot="sync-card-note"
                                title={cardNoteTitle}
                                class="text-muted-foreground text-[11px] leading-relaxed"
                            >
                                {cardNote}
                            </span>
                            <span
                                data-slot="sync-card-stats"
                                class="text-muted-foreground text-[11px]"
                            >
                                <!-- 整句写在一行里：中间换行会让 textContent 里多出空白 -->
                                {#if syncEngine.targetMissing}
                                    {formatBytes(localBytes)} · 本地 {localBankCount}
                                    个题库
                                {:else if localBankCount === remoteBankCount}
                                    {formatBytes(localBytes)} · {localBankCount} 个题库
                                {:else}
                                    {formatBytes(localBytes)} · 本地 {localBankCount}
                                    个题库 · 云端 {remoteBankCount} 个题库
                                {/if}
                            </span>
                        </div>
                    </div>
                </div>

                <!-- 信息 / 操作 两段之间的细线 -->
                <div class="bg-border/40 h-px my-1" aria-hidden="true"></div>

                <!-- ── 操作：令牌（展示 / 测试 / 编辑）→ 立即同步 → 更多设置 ── -->
                <div class="flex items-center gap-2">
                    <Input
                        value={maskToken(syncConfigStore.value.token)}
                        readonly
                        tabindex={-1}
                        aria-label="已保存的 Gitee 令牌（已打码）"
                        class="min-w-0 flex-1 cursor-default font-mono text-[11px]"
                    />
                    <Button
                        variant={testState === "error"
                            ? "destructive"
                            : "outline"}
                        data-state={justVerified
                            ? "verified"
                            : (testState ?? "idle")}
                        size="icon"
                        class="shrink-0"
                        title="测试连接"
                        aria-label="测试连接"
                        disabled={busy !== ""}
                        onclick={() => testConnection()}
                    >
                        {#if justVerified}
                            <IconRosetteDiscountCheckFilled
                                size={15}
                                class="text-success"
                            />
                        {:else}
                            <IconCloudCheck size={15} stroke={1.5} />
                        {/if}
                    </Button>
                    <Button
                        size="icon"
                        class="shrink-0"
                        title="修改配置"
                        aria-label="修改配置"
                        disabled={busy !== ""}
                        onclick={() => startEditing()}
                    >
                        <IconEdit size={15} stroke={1.5} />
                    </Button>
                </div>

                <Button
                    size="sm"
                    class="w-full"
                    disabled={busy !== ""}
                    onclick={() => syncNow()}
                >
                    <IconCloudUp size={15} stroke={1.5} />
                    {busy === "merge" ? "同步中…" : "立即同步"}
                </Button>

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

                <!--
                    ── 更多设置 ────────────────────────────────────────
                    自动同步 + 两个覆盖按钮都收在这儿：它们不是日常动作，
                    全摊在外面会让面板看上去一堆按钮。
                -->
                <div>
                    <Button
                        variant="ghost"
                        size="sm"
                        class="p-0 bg-transparent! w-full justify-start"
                        aria-expanded={detailsOpen}
                        onclick={() => (detailsOpen = !detailsOpen)}
                    >
                        <IconChevronDown
                            size={15}
                            stroke={1.5}
                            class={cn(
                                "transition-transform duration-200",
                                detailsOpen && "rotate-180",
                            )}
                        />
                        更多设置
                    </Button>

                    {#if detailsOpen}
                        <div
                            class="mt-2 flex items-center gap-2"
                            transition:slide={{
                                duration: 200,
                                easing: cubicOut,
                            }}
                        >
                            <!-- 提示直接挂在这个 label 上：不用再多一个小问号按钮 -->
                            <Tooltip.Root>
                                <Tooltip.Trigger>
                                    {#snippet child({ props })}
                                        <Label
                                            {...props}
                                            for="sync-auto"
                                            class="flex shrink-0 items-center gap-1.5 text-xs font-normal"
                                        >
                                            自动同步
                                            <Switch
                                                id="sync-auto"
                                                checked={autoSync}
                                                onCheckedChange={(checked) =>
                                                    setAutoSync(checked)}
                                                size="sm"
                                            />
                                        </Label>
                                    {/snippet}
                                </Tooltip.Trigger>
                                <Tooltip.Content
                                    side="top"
                                    align="start"
                                    class="max-w-64"
                                >
                                    <span class="text-xs">
                                        停止编辑 20 秒后自动上传；每 3
                                        分钟同步一次。关闭后仅支持手动同步。
                                    </span>
                                </Tooltip.Content>
                            </Tooltip.Root>

                            <span
                                class="bg-border h-4 w-px shrink-0"
                                aria-hidden="true"
                            ></span>

                            <div class="flex min-w-0 flex-1 gap-1.5">
                                <ConfirmActionButton
                                    variant="secondary"
                                    size="xs"
                                    class="min-w-0 flex-1"
                                    confirmClass="ring-destructive/40 ring-2"
                                    idleLabel="用本地覆盖云端"
                                    confirmLabel="确认覆盖"
                                    disabled={busy !== ""}
                                    onConfirm={() => forceUpload()}
                                >
                                    {#snippet children({ confirming })}
                                        <IconCloudUpload
                                            size={13}
                                            stroke={1.5}
                                        />
                                        <span class="truncate">
                                            {confirming
                                                ? "确认覆盖"
                                                : "用本地覆盖云端"}
                                        </span>
                                    {/snippet}
                                </ConfirmActionButton>
                                <ConfirmActionButton
                                    variant="secondary"
                                    size="xs"
                                    class="min-w-0 flex-1"
                                    confirmClass="ring-destructive/40 ring-2"
                                    idleLabel="用云端覆盖本地"
                                    confirmLabel="确认覆盖"
                                    disabled={busy !== ""}
                                    onConfirm={() => forceDownload()}
                                >
                                    {#snippet children({ confirming })}
                                        <IconCloudDownload
                                            size={13}
                                            stroke={1.5}
                                        />
                                        <span class="truncate">
                                            {confirming
                                                ? "确认覆盖"
                                                : "用云端覆盖本地"}
                                        </span>
                                    {/snippet}
                                </ConfirmActionButton>
                            </div>
                        </div>
                    {/if}
                </div>
            {/if}
        </div>
    {/if}
</section>
