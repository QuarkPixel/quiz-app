<script lang="ts">
    import * as Sidebar from "$lib/components/ui/sidebar";
    import * as Dialog from "$lib/components/ui/dialog";
    import * as DropdownMenu from "$lib/components/ui/dropdown-menu";
    import { Button } from "$lib/components/ui/button";
    import { Input } from "$lib/components/ui/input";
    import IconUpload from "@tabler/icons-svelte/icons/upload";
    import IconDots from "@tabler/icons-svelte/icons/dots";
    import IconEdit from "@tabler/icons-svelte/icons/edit";
    import IconTrash from "@tabler/icons-svelte/icons/trash";
    import IconBooks from "@tabler/icons-svelte/icons/books";
    import type { QuizSource } from "../source/types";

    let { source }: { source: QuizSource } = $props();

    // 初始读取 + subscribe；source 自身是稳定引用
    // svelte-ignore state_referenced_locally
    let banks = $state(source.listBanks?.() ?? []);
    // svelte-ignore state_referenced_locally
    let activeHash = $state(source.getActiveBank()?.hash ?? null);

    $effect(() => {
        const unsubscribe = source.subscribe(() => {
            banks = source.listBanks?.() ?? [];
            activeHash = source.getActiveBank()?.hash ?? null;
        });
        return unsubscribe;
    });

    let fileInput: HTMLInputElement | null = $state(null);
    let importMessage = $state<{ kind: "info" | "error"; text: string } | null>(
        null,
    );

    let renameTarget = $state<{ hash: string; name: string } | null>(null);
    let renameInput = $state("");
    let deleteTarget = $state<{ hash: string; name: string } | null>(null);

    async function onFileChosen(e: Event): Promise<void> {
        const input = e.currentTarget as HTMLInputElement;
        const file = input.files?.[0];
        input.value = "";
        if (!file || !source.importBank) return;

        const text = await file.text();
        const baseName = file.name.replace(/\.json$/i, "");
        const result = await source.importBank(baseName, text);

        switch (result.kind) {
            case "ok":
                importMessage = null;
                break;
            case "invalid":
                importMessage = {
                    kind: "error",
                    text:
                        `题库校验失败：\n` +
                        result.errors.slice(0, 5).join("\n") +
                        (result.errors.length > 5
                            ? `\n…还有 ${result.errors.length - 5} 条问题`
                            : ""),
                };
                break;
            case "duplicate":
                importMessage = {
                    kind: "info",
                    text: "这份题库已经在列表里了。",
                };
                break;
            case "quota":
                importMessage = {
                    kind: "error",
                    text:
                        "浏览器存储空间不足，无法导入。\n" +
                        "如果只需要这一份题库，建议改用 Bundled 模式打包成单文件分发。",
                };
                break;
        }
    }

    function openImport(): void {
        fileInput?.click();
    }

    function startRename(hash: string, name: string): void {
        renameTarget = { hash, name };
        renameInput = name;
    }

    function commitRename(): void {
        if (!renameTarget || !source.renameBank) return;
        const trimmed = renameInput.trim();
        if (trimmed && trimmed !== renameTarget.name) {
            source.renameBank(renameTarget.hash, trimmed);
        }
        renameTarget = null;
    }

    function startDelete(hash: string, name: string): void {
        deleteTarget = { hash, name };
    }

    function commitDelete(): void {
        if (!deleteTarget || !source.removeBank) return;
        source.removeBank(deleteTarget.hash);
        deleteTarget = null;
    }

    function pickBank(hash: string): void {
        source.setActiveBank?.(hash);
    }
</script>

<Sidebar.Root collapsible="icon">
    <Sidebar.Header>
        <Sidebar.Menu>
            <Sidebar.MenuItem>
                <Sidebar.MenuButton
                    size="lg"
                    class="cursor-default data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
                >
                    {#snippet child({ props })}
                        <div {...props}>
                            <div
                                class="bg-sidebar-primary text-sidebar-primary-foreground flex aspect-square size-8 items-center justify-center rounded-lg"
                            >
                                <IconBooks size={18} stroke={1.75} />
                            </div>
                            <div
                                class="grid flex-1 text-left text-sm leading-tight"
                            >
                                <span class="truncate font-semibold"
                                    >Quiz! bANK.</span
                                >
                                <span class="truncate text-xs opacity-70"
                                    >题库</span
                                >
                            </div>
                        </div>
                    {/snippet}
                </Sidebar.MenuButton>
            </Sidebar.MenuItem>
        </Sidebar.Menu>
    </Sidebar.Header>

    <Sidebar.Content>
        <Sidebar.Group>
            <Sidebar.GroupLabel>题库</Sidebar.GroupLabel>
            {#if banks.length != 0}
                <Sidebar.GroupAction title="导入题库" onclick={openImport}>
                    <IconUpload size={16} stroke={1.75} />
                    <span class="sr-only">导入题库</span>
                </Sidebar.GroupAction>
            {/if}
            <Sidebar.GroupContent>
                <Sidebar.Menu>
                    {#each banks as bank (bank.hash)}
                        <Sidebar.MenuItem>
                            <Sidebar.MenuButton
                                isActive={bank.hash === activeHash}
                                onclick={() => pickBank(bank.hash)}
                                tooltipContent={bank.name}
                            >
                                <span
                                    class="hidden w-full text-center text-sm font-medium group-data-[collapsible=icon]:inline-block"
                                    aria-hidden="true"
                                >
                                    {bank.name.charAt(0)}
                                </span>
                                <span
                                    class="flex-1 truncate text-left group-data-[collapsible=icon]:hidden"
                                >
                                    {bank.name}
                                    <span
                                        class="text-sidebar-foreground/50 ml-1 text-[11px] font-normal tabular-nums"
                                    >
                                        {bank.count}
                                    </span>
                                </span>
                            </Sidebar.MenuButton>

                            <DropdownMenu.Root>
                                <DropdownMenu.Trigger>
                                    {#snippet child({ props })}
                                        <Sidebar.MenuAction
                                            {...props}
                                            showOnHover
                                        >
                                            <IconDots size={14} stroke={1.75} />
                                            <span class="sr-only">操作</span>
                                        </Sidebar.MenuAction>
                                    {/snippet}
                                </DropdownMenu.Trigger>
                                <DropdownMenu.Content
                                    side="right"
                                    align="start"
                                    class="w-40"
                                >
                                    <DropdownMenu.Item
                                        onSelect={() =>
                                            startRename(bank.hash, bank.name)}
                                    >
                                        <IconEdit size={14} stroke={1.75} />
                                        <span>重命名</span>
                                    </DropdownMenu.Item>
                                    <DropdownMenu.Separator />
                                    <DropdownMenu.Item
                                        variant="destructive"
                                        onSelect={() =>
                                            startDelete(bank.hash, bank.name)}
                                    >
                                        <IconTrash size={14} stroke={1.75} />
                                        <span>删除</span>
                                    </DropdownMenu.Item>
                                </DropdownMenu.Content>
                            </DropdownMenu.Root>
                        </Sidebar.MenuItem>
                    {:else}
                        <Sidebar.MenuItem>
                            <Sidebar.MenuButton
                                onclick={openImport}
                                tooltipContent="导入题库"
                                class="text-sidebar-foreground/70 justify-center"
                            >
                                <IconUpload size={16} stroke={1.75} />
                            </Sidebar.MenuButton>
                        </Sidebar.MenuItem>
                    {/each}
                </Sidebar.Menu>
            </Sidebar.GroupContent>
        </Sidebar.Group>
    </Sidebar.Content>

    <Sidebar.Footer>
        {#if importMessage}
            <div
                class={[
                    "rounded-md px-3 py-2 text-xs leading-relaxed whitespace-pre-wrap",
                    importMessage.kind === "error"
                        ? "bg-destructive/10 text-destructive"
                        : "bg-sidebar-accent text-sidebar-accent-foreground",
                ]}
            >
                {importMessage.text}
            </div>
        {/if}
    </Sidebar.Footer>
    <Sidebar.Rail />
</Sidebar.Root>

<input
    bind:this={fileInput}
    type="file"
    accept="application/json,.json"
    class="hidden"
    onchange={onFileChosen}
/>

<Dialog.Root
    open={renameTarget !== null}
    onOpenChange={(open) => {
        if (!open) renameTarget = null;
    }}
>
    <Dialog.Content class="max-w-sm">
        <Dialog.Header>
            <Dialog.Title>重命名题库</Dialog.Title>
        </Dialog.Header>
        <Input
            bind:value={renameInput}
            placeholder="题库名称"
            onkeydown={(e) => {
                if (e.key === "Enter") {
                    e.preventDefault();
                    commitRename();
                }
            }}
        />
        <Dialog.Footer>
            <Button variant="outline" onclick={() => (renameTarget = null)}
                >取消</Button
            >
            <Button onclick={commitRename}>保存</Button>
        </Dialog.Footer>
    </Dialog.Content>
</Dialog.Root>

<Dialog.Root
    open={deleteTarget !== null}
    onOpenChange={(open) => {
        if (!open) deleteTarget = null;
    }}
>
    <Dialog.Content class="max-w-sm">
        <Dialog.Header>
            <Dialog.Title>删除题库</Dialog.Title>
            <Dialog.Description>
                确定删除「{deleteTarget?.name}」？该题库的题目内容和学习进度都会被清除，无法撤销。
            </Dialog.Description>
        </Dialog.Header>
        <Dialog.Footer>
            <Button variant="outline" onclick={() => (deleteTarget = null)}
                >取消</Button
            >
            <Button variant="destructive" onclick={commitDelete}>删除</Button>
        </Dialog.Footer>
    </Dialog.Content>
</Dialog.Root>
