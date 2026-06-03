<script lang="ts">
    import { onDestroy } from "svelte";
    import * as Sidebar from "$lib/components/ui/sidebar";
    import * as Dialog from "$lib/components/ui/dialog";
    import * as DropdownMenu from "$lib/components/ui/dropdown-menu";
    import * as Tooltip from "$lib/components/ui/tooltip";
    import { Button } from "$lib/components/ui/button";
    import { Input } from "$lib/components/ui/input";
    import { cn } from "$lib/utils";
    import Prompt from "../../assets/prompt.md?raw";
    import IconExport from "@tabler/icons-svelte/icons/upload";
    import IconAdd from "@tabler/icons-svelte/icons/circle-dashed-plus";
    import IconAddSquare from "@tabler/icons-svelte/icons/code-variable-plus";
    import IconPromptCopy from "@tabler/icons-svelte/icons/message-circle-share";
    import IconCopyCheck from "@tabler/icons-svelte/icons/copy-check";
    import IconDots from "@tabler/icons-svelte/icons/dots";
    import IconEdit from "@tabler/icons-svelte/icons/edit";
    import IconTrash from "@tabler/icons-svelte/icons/trash";
    import IconBooks from "@tabler/icons-svelte/icons/books";
    import {
        exportLibraryBank,
        LibraryImportSession,
        type LibraryFileMessage,
        type LibraryImportPrompt,
        type OverwriteImportRequest,
    } from "../features/libraryFiles";
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
    let isImporting = $state(false);
    let importSession = $state<LibraryImportSession | null>(null);
    let importMessage = $state<LibraryFileMessage | null>(null);
    let overwriteRequest = $state<OverwriteImportRequest | null>(null);

    let renameTarget = $state<{ hash: string; name: string } | null>(null);
    let renameInput = $state("");
    let deleteTarget = $state<{ hash: string; name: string } | null>(null);
    let promptCopyStatus = $state<"idle" | "copied" | "error">("idle");
    let promptCopyResetTimer: ReturnType<typeof setTimeout> | null = null;

    const promptCopyLabel = "给 LLM 的生成题库 Prompt";

    onDestroy(() => {
        if (promptCopyResetTimer) clearTimeout(promptCopyResetTimer);
    });

    async function copyPrompt(event: MouseEvent): Promise<void> {
        event.stopPropagation();
        if (promptCopyResetTimer) {
            clearTimeout(promptCopyResetTimer);
            promptCopyResetTimer = null;
        }

        try {
            if (!navigator.clipboard?.writeText) {
                throw new Error("Clipboard API is unavailable.");
            }
            await navigator.clipboard.writeText(Prompt);
            promptCopyStatus = "copied";
        } catch {
            promptCopyStatus = "error";
        }

        promptCopyResetTimer = setTimeout(() => {
            promptCopyStatus = "idle";
            promptCopyResetTimer = null;
        }, 1800);
    }

    function showImportPrompt(prompt: LibraryImportPrompt): void {
        if (prompt.kind === "overwrite") {
            overwriteRequest = prompt.request;
            importMessage = null;
            return;
        }

        overwriteRequest = null;
        importSession = null;
        importMessage = prompt.message;
    }

    async function onFileChosen(e: Event): Promise<void> {
        const input = e.currentTarget as HTMLInputElement;
        const files = Array.from(input.files ?? []);
        input.value = "";
        if (files.length === 0 || isImporting || importSession !== null) return;

        isImporting = true;
        try {
            const session = await LibraryImportSession.create(source, files);
            importSession = session;
            showImportPrompt(session.currentPrompt());
        } finally {
            isImporting = false;
        }
    }

    async function answerOverwrite(overwrite: boolean): Promise<void> {
        if (!importSession || !overwriteRequest || isImporting) return;

        isImporting = true;
        try {
            showImportPrompt(await importSession.resolveOverwrite(overwrite));
        } finally {
            isImporting = false;
        }
    }

    function openImport(): void {
        if (isImporting || importSession !== null) return;
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

    async function handleExport(hash: string): Promise<void> {
        const result = await exportLibraryBank(source, hash);
        if (!result.ok) importMessage = result.message;
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
                            <Tooltip.Root delayDuration={0}>
                                <Tooltip.Trigger>
                                    {#snippet child({ props })}
                                        <Button
                                            {...props}
                                            variant="ghost"
                                            size="icon-sm"
                                            class={cn(
                                                promptCopyStatus === "copied" &&
                                                    "text-success hover:text-success",
                                            )}
                                            aria-label={promptCopyLabel}
                                            onclick={copyPrompt}
                                        >
                                            {#if promptCopyStatus === "copied"}
                                                <IconCopyCheck />
                                            {:else}
                                                <IconPromptCopy />
                                            {/if}
                                        </Button>
                                    {/snippet}
                                </Tooltip.Trigger>
                                <Tooltip.Content side="bottom" align="end">
                                    <span>{promptCopyLabel}</span>
                                </Tooltip.Content>
                            </Tooltip.Root>
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
                    <IconAddSquare size={16} stroke={1.75} />
                    <span class="sr-only">导入题库</span>
                </Sidebar.GroupAction>
            {/if}
            <Sidebar.GroupContent>
                <Sidebar.Menu class="gap-1">
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
                                    <DropdownMenu.Item
                                        onSelect={() => handleExport(bank.hash)}
                                    >
                                        <IconExport size={14} stroke={1.75} />
                                        <span>导出</span>
                                    </DropdownMenu.Item>
                                    <DropdownMenu.Separator />
                                    <DropdownMenu.Label
                                        class="text-muted-foreground/60 font-mono text-[11px] font-normal"
                                    >
                                        {bank.hash}
                                    </DropdownMenu.Label>
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
                                <IconAdd size={16} stroke={1.75} />
                            </Sidebar.MenuButton>
                        </Sidebar.MenuItem>
                    {/each}
                </Sidebar.Menu>
            </Sidebar.GroupContent>
        </Sidebar.Group>
    </Sidebar.Content>

    <Sidebar.Rail />
</Sidebar.Root>

<input
    bind:this={fileInput}
    type="file"
    accept="application/json,.json"
    multiple
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
    open={importMessage !== null}
    onOpenChange={(open) => {
        if (!open) importMessage = null;
    }}
>
    <Dialog.Content class="max-w-sm">
        <Dialog.Header>
            <Dialog.Title>{importMessage?.title}</Dialog.Title>
            <Dialog.Description class="whitespace-pre-wrap">
                {importMessage?.text}
            </Dialog.Description>
        </Dialog.Header>
        <Dialog.Footer>
            <Button onclick={() => (importMessage = null)}>知道了</Button>
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

<Dialog.Root
    open={overwriteRequest !== null}
    onOpenChange={(open) => {
        if (!open) void answerOverwrite(false);
    }}
>
    <Dialog.Content class="max-w-sm">
        <Dialog.Header>
            <Dialog.Title>题库已存在</Dialog.Title>
            <Dialog.Description>
                「{overwriteRequest?.bankName}」已经在列表里，导入文件「{overwriteRequest?.fileName}」附带了进度备份。是否用文件中的进度替换当前进度？替换后无法撤销。
            </Dialog.Description>
        </Dialog.Header>
        <Dialog.Footer>
            <Button variant="outline" onclick={() => answerOverwrite(false)}
                >保留当前进度</Button
            >
            <Button variant="destructive" onclick={() => answerOverwrite(true)}
                >替换进度</Button
            >
        </Dialog.Footer>
    </Dialog.Content>
</Dialog.Root>
