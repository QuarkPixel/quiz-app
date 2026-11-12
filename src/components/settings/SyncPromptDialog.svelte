<script lang="ts">
    import * as Dialog from "$lib/components/ui/dialog";
    import { Button } from "$lib/components/ui/button";
    import { syncEngine } from "@/features/sync/engine.svelte";
    import SyncConflictPanel from "./SyncConflictPanel.svelte";

    /**
     * 同步唯一会打断用户的地方——**两支，别的都不弹**：
     *
     *   - `conflict`：题库两边都改过，要选保留哪一边；
     *   - `remote-write`：云端有本地没有的内容、要写本地，但用户正在做这个题库。
     *
     * 「云端更新、用户没在做」不在这里：引擎直接落地，不产生 prompt。
     * 「本地有改动、云端没有」也不在这里：只上传，本地只读。
     *
     * 冲突那支复用 `SyncConflictPanel`（设置面板里也是它），不另写一套按钮。
     */
    const prompt = $derived(syncEngine.prompt);

    /** 覆盖本地的三种操作各说各的话（替换 / 合并 / 云端已删）。 */
    const overwriteCopy = $derived.by(() => {
        if (prompt?.kind !== "remote-write") return null;
        switch (prompt.operation) {
            case "merge":
                return {
                    title: "云端也有新进度",
                    body: `「${prompt.name}」在云端也有你这边没有的进度。现在合并会把合并结果写回本地，屏幕上这一轮会重新载入。`,
                    confirm: "现在合并",
                };
            case "remove":
                return {
                    title: "这个题库已在云端删除",
                    body: `「${prompt.name}」在另一台设备上被删除了。现在同步会把本地这份也删掉（进度会一起消失）。`,
                    confirm: "现在删除",
                };
            default:
                return {
                    title: "云端有更新的内容",
                    body: `「${prompt.name}」在云端有比本机更新的进度。现在更新会覆盖本地，屏幕上这一轮会重新载入。`,
                    confirm: "现在更新",
                };
        }
    });
</script>

<Dialog.Root
    open={prompt !== null}
    onOpenChange={(open) => {
        if (!open) syncEngine.dismissPrompt();
    }}
>
    <Dialog.Content class="max-w-md">
        {#if prompt?.kind === "conflict"}
            <Dialog.Header>
                <Dialog.Title>题库冲突</Dialog.Title>
                <Dialog.Description>
                    这些题库本机和云端改的不是同一份内容，需要你决定保留哪一边。
                </Dialog.Description>
            </Dialog.Header>
            <SyncConflictPanel conflicts={prompt.conflicts} compact />
            <Dialog.Footer>
                <Button variant="ghost" onclick={() => syncEngine.dismissPrompt()}>
                    稍后处理
                </Button>
            </Dialog.Footer>
        {:else if prompt?.kind === "remote-write" && overwriteCopy}
            <Dialog.Header>
                <Dialog.Title>{overwriteCopy.title}</Dialog.Title>
                <Dialog.Description>{overwriteCopy.body}</Dialog.Description>
            </Dialog.Header>
            <Dialog.Footer>
                <Button variant="outline" onclick={() => syncEngine.dismissPrompt()}>
                    稍后
                </Button>
                <Button onclick={() => void syncEngine.acceptRemoteWrite()}>
                    {overwriteCopy.confirm}
                </Button>
            </Dialog.Footer>
        {/if}
    </Dialog.Content>
</Dialog.Root>
