<script lang="ts">
    import * as Sidebar from "$lib/components/ui/sidebar";
    import * as Dialog from "$lib/components/ui/dialog";
    import * as ContextMenu from "$lib/components/ui/context-menu";
    import * as DropdownMenu from "$lib/components/ui/dropdown-menu";
    import { Button } from "$lib/components/ui/button";
    import { Input } from "$lib/components/ui/input";
    import AlertToast from "./AlertToast.svelte";
    import { writeText } from "clipboard-polyfill";
    import Prompt from "/assets/prompt.md?raw";
    import IconExport from "@tabler/icons-svelte/icons/upload";
    import IconAdd from "@tabler/icons-svelte/icons/circle-dashed-plus";
    import IconAddSquare from "@tabler/icons-svelte/icons/code-variable-plus";
    import IconClipboard from "@tabler/icons-svelte/icons/clipboard";
    import IconFileImport from "@tabler/icons-svelte/icons/file-import";
    import IconPromptCopy from "@tabler/icons-svelte/icons/message-circle-share";
    import IconDots from "@tabler/icons-svelte/icons/dots";
    import IconEdit from "@tabler/icons-svelte/icons/edit";
    import IconTrash from "@tabler/icons-svelte/icons/trash";
    import IconArrowUp from "@tabler/icons-svelte/icons/arrow-big-up-lines";
    import IconBooks from "@tabler/icons-svelte/icons/books";
    import {
        exportLibraryBank,
        LibraryImportSession,
        type LibraryFileMessage,
        type LibraryImportPrompt,
        type OverwriteImportRequest,
    } from "@/features/libraryFiles";
    import {
        reconcileSidebarSelection,
        selectSidebarItem,
        selectSidebarItemFromContextMenu,
    } from "@/features/sidebarSelection";
    import type { QuizSource } from "@/source/types";

    let { source }: { source: QuizSource } = $props();
    const sidebar = Sidebar.useSidebar();

    // 初始读取 + subscribe；source 自身是稳定引用
    // svelte-ignore state_referenced_locally
    let banks = $state(source.listBanks?.() ?? []);
    // svelte-ignore state_referenced_locally
    let activeHash = $state(source.getActiveBank()?.hash ?? null);

    $effect(() => {
        const unsubscribe = source.subscribe(() => {
            const nextBanks = source.listBanks?.() ?? [];
            banks = nextBanks;
            activeHash = source.getActiveBank()?.hash ?? null;
            applySelection(
                reconcileSidebarSelection(
                    {
                        selectedHashes,
                        anchorHash: selectionAnchorHash,
                    },
                    nextBanks.map((bank) => bank.hash),
                ),
            );
        });
        return unsubscribe;
    });

    $effect(() => {
        if (supportsMultiSelection()) return;
        if (selectedHashes.length === 0 && selectionAnchorHash === null) return;
        clearSelection();
    });

    let fileInput: HTMLInputElement | null = $state(null);
    let isImporting = $state(false);
    let importSession = $state<LibraryImportSession | null>(null);
    let importMessage = $state<LibraryFileMessage | null>(null);
    let overwriteRequest = $state<OverwriteImportRequest | null>(null);
    let toast: AlertToast;

    let selectedHashes = $state<string[]>([]);
    let selectionAnchorHash = $state<string | null>(null);
    let activeMenu = $state<{
        kind: "dropdown" | "context";
        hash: string;
    } | null>(null);
    let menuDismissGuard = $state(false);
    let menuDismissTimer: ReturnType<typeof setTimeout> | null = null;
    let renameTarget = $state<{ hash: string; name: string } | null>(null);
    let renameInput = $state("");
    let deleteTarget = $state<{ hashes: string[]; names: string[] } | null>(
        null,
    );

    function orderedHashes(): string[] {
        return banks.map((bank) => bank.hash);
    }

    function applySelection(selection: {
        selectedHashes: string[];
        anchorHash: string | null;
    }): void {
        selectedHashes = selection.selectedHashes;
        selectionAnchorHash = selection.anchorHash;
    }

    function clearSelection(): void {
        applySelection({ selectedHashes: [], anchorHash: null });
    }

    function armMenuDismissGuard(): void {
        if (menuDismissTimer !== null) {
            clearTimeout(menuDismissTimer);
        }

        menuDismissGuard = true;
        menuDismissTimer = setTimeout(() => {
            menuDismissGuard = false;
            menuDismissTimer = null;
        }, 0);
    }

    function closeMenus(useDismissGuard: boolean = false): void {
        activeMenu = null;
        if (useDismissGuard) {
            armMenuDismissGuard();
        }
    }

    function supportsMultiSelection(): boolean {
        return sidebar.state !== "collapsed";
    }

    function selectOnly(hash: string): void {
        applySelection({
            selectedHashes: [hash],
            anchorHash: hash,
        });
    }

    function isSelected(hash: string): boolean {
        return selectedHashes.includes(hash);
    }

    function selectionScopeFor(hash: string): string[] {
        return isSelected(hash) && selectedHashes.length > 0
            ? selectedHashes
            : [hash];
    }

    function namesForHashes(hashes: readonly string[]): string[] {
        const namesByHash = new Map(
            banks.map((bank) => [bank.hash, bank.name]),
        );
        return hashes
            .map((hash) => namesByHash.get(hash))
            .filter((name): name is string => name !== undefined);
    }

    function hasMultiSelection(hash: string): boolean {
        return isSelected(hash) && selectedHashes.length > 1;
    }

    function deleteActionLabel(hash: string): string {
        return hasMultiSelection(hash) ? `删除所选题库` : "删除";
    }

    function moveToTopActionLabel(hash: string): string {
        return hasMultiSelection(hash)
            ? `将所选题库移到最上方`
            : "移动到最上方";
    }

    function deleteDialogTitle(): string {
        if (!deleteTarget) return "删除题库";
        return deleteTarget.hashes.length > 1
            ? `删除 ${deleteTarget.hashes.length} 个题库`
            : "删除题库";
    }

    function deleteDialogDescription(): string {
        if (!deleteTarget) return "";
        if (deleteTarget.hashes.length === 1) {
            return `确定删除「${deleteTarget.names[0]}」？该题库的题目内容和学习进度都会被清除，无法撤销。`;
        }

        return `确定删除已选中的 ${deleteTarget.hashes.length} 个题库？这些题库的题目内容和学习进度都会被清除，无法撤销。`;
    }

    async function copyPrompt(): Promise<void> {
        try {
            await writeText(Prompt);
            toast?.show(
                "Prompt 已复制",
                "已复制到剪贴板。把它粘贴到与 AI 的对话中，再在后面附上原始题目内容，让 AI 按格式生成题库 JSON。",
                "success",
            );
        } catch {
            toast?.show(
                "复制失败",
                "浏览器未允许访问剪贴板，请检查权限后重试。",
                "destructive",
            );
        }
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

    function openFileImport(): void {
        if (isImporting || importSession !== null) return;
        fileInput?.click();
    }

    async function importFromClipboard(): Promise<void> {
        if (isImporting || importSession !== null) return;

        isImporting = true;
        try {
            const session =
                await LibraryImportSession.createFromClipboard(source);
            importSession = session;
            showImportPrompt(session.currentPrompt());
        } finally {
            isImporting = false;
        }
    }

    function startRename(hash: string, name: string): void {
        closeMenus(true);
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

    function startDelete(hashes: string[]): void {
        closeMenus(true);
        deleteTarget = {
            hashes,
            names: namesForHashes(hashes),
        };
    }

    function commitDelete(): void {
        if (!deleteTarget || !source.removeBank) return;
        const hashes = deleteTarget.hashes;
        deleteTarget = null;
        closeMenus(true);
        const deleted = new Set(hashes);
        selectedHashes = selectedHashes.filter((hash) => !deleted.has(hash));
        if (selectionAnchorHash !== null && deleted.has(selectionAnchorHash)) {
            selectionAnchorHash = null;
        }
        for (const hash of hashes) {
            source.removeBank(hash);
        }
    }

    function pickBank(hash: string): void {
        source.setActiveBank?.(hash);
    }

    function handleBankClick(event: MouseEvent, hash: string): void {
        if (!supportsMultiSelection()) {
            clearSelection();
            pickBank(hash);
            return;
        }

        applySelection(
            selectSidebarItem(
                {
                    selectedHashes,
                    anchorHash: selectionAnchorHash,
                },
                orderedHashes(),
                hash,
                {
                    shiftKey: event.shiftKey,
                    metaKey: event.metaKey,
                },
            ),
        );
        pickBank(hash);
    }

    function prepareContextMenu(hash: string): void {
        if (!supportsMultiSelection()) {
            selectOnly(hash);
        } else {
            applySelection(
                selectSidebarItemFromContextMenu(
                    {
                        selectedHashes,
                        anchorHash: selectionAnchorHash,
                    },
                    orderedHashes(),
                    hash,
                ),
            );
        }
    }

    function prepareDropdownMenu(hash: string): void {
        prepareContextMenu(hash);
    }

    function isMenuOpen(kind: "dropdown" | "context", hash: string): boolean {
        return activeMenu?.kind === kind && activeMenu.hash === hash;
    }

    function handleMenuOpenChange(
        kind: "dropdown" | "context",
        hash: string,
        open: boolean,
    ): void {
        if (open) {
            if (menuDismissTimer !== null) {
                clearTimeout(menuDismissTimer);
                menuDismissTimer = null;
            }
            menuDismissGuard = false;
        }
        activeMenu = open ? { kind, hash } : null;
    }

    function moveSelectionToTop(hash: string): void {
        closeMenus(true);
        source.moveBanksToTop?.(selectionScopeFor(hash));
    }

    async function handleExport(hash: string): Promise<void> {
        closeMenus(true);
        const result = await exportLibraryBank(source, hash);
        if (!result.ok) importMessage = result.message;
    }

    function shouldShowSelectionLabel(hash: string): boolean {
        return hasMultiSelection(hash);
    }

    function shouldShowSingleBankDetails(hash: string): boolean {
        return !hasMultiSelection(hash);
    }
</script>

{#snippet bankActionItems(
    bank: (typeof banks)[number],
    kind: "dropdown" | "context",
)}
    {#if shouldShowSelectionLabel(bank.hash)}
        {#if kind === "dropdown"}
            <DropdownMenu.Label>
                已选 {selectedHashes.length} 个题库
            </DropdownMenu.Label>
            <DropdownMenu.Separator />
        {:else}
            <ContextMenu.Label>
                已选 {selectedHashes.length} 个题库
            </ContextMenu.Label>
            <ContextMenu.Separator />
        {/if}
    {/if}

    {#if shouldShowSingleBankDetails(bank.hash)}
        {#if kind === "dropdown"}
            <DropdownMenu.Item
                onSelect={() => startRename(bank.hash, bank.name)}
            >
                <IconEdit size={14} stroke={1.75} />
                <span>重命名</span>
            </DropdownMenu.Item>
            <DropdownMenu.Item onSelect={() => handleExport(bank.hash)}>
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
        {:else}
            <ContextMenu.Item
                onSelect={() => startRename(bank.hash, bank.name)}
            >
                <IconEdit size={14} stroke={1.75} />
                <span>重命名</span>
            </ContextMenu.Item>
            <ContextMenu.Item onSelect={() => handleExport(bank.hash)}>
                <IconExport size={14} stroke={1.75} />
                <span>导出</span>
            </ContextMenu.Item>
            <ContextMenu.Separator />
            <ContextMenu.Label
                class="text-muted-foreground/60 font-mono text-[11px] font-normal"
            >
                {bank.hash}
            </ContextMenu.Label>
            <ContextMenu.Separator />
        {/if}
    {/if}

    {#if kind === "dropdown"}
        <DropdownMenu.Item onSelect={() => moveSelectionToTop(bank.hash)}>
            <IconArrowUp size={14} stroke={1.75} />
            <span>{moveToTopActionLabel(bank.hash)}</span>
        </DropdownMenu.Item>
        <DropdownMenu.Item
            variant="destructive"
            onSelect={() => startDelete(selectionScopeFor(bank.hash))}
        >
            <IconTrash size={14} stroke={1.75} />
            <span>{deleteActionLabel(bank.hash)}</span>
        </DropdownMenu.Item>
    {:else}
        <ContextMenu.Item onSelect={() => moveSelectionToTop(bank.hash)}>
            <IconArrowUp size={14} stroke={1.75} />
            <span>{moveToTopActionLabel(bank.hash)}</span>
        </ContextMenu.Item>
        <ContextMenu.Item
            variant="destructive"
            onSelect={() => startDelete(selectionScopeFor(bank.hash))}
        >
            <IconTrash size={14} stroke={1.75} />
            <span>{deleteActionLabel(bank.hash)}</span>
        </ContextMenu.Item>
    {/if}
{/snippet}

{#snippet importMenuContent()}
    <DropdownMenu.Content side="right" align="start" class="w-60">
        <DropdownMenu.Item
            disabled={isImporting || importSession !== null}
            onSelect={() => openFileImport()}
        >
            <IconFileImport size={14} stroke={1.75} />
            <span>从文件导入</span>
        </DropdownMenu.Item>
        <DropdownMenu.Item
            disabled={isImporting || importSession !== null}
            onSelect={() => void importFromClipboard()}
        >
            <IconClipboard size={14} stroke={1.75} />
            <span>从剪贴板导入</span>
        </DropdownMenu.Item>
        <DropdownMenu.Separator />
        <DropdownMenu.Item
            class="text-muted-foreground justify-end text-right text-xs"
            onSelect={() => void copyPrompt()}
        >
            <span>复制「给 LLM 的生成题库 Prompt」</span>
            <IconPromptCopy size={12} stroke={1.75} />
        </DropdownMenu.Item>
    </DropdownMenu.Content>
{/snippet}

<Sidebar.Root collapsible="icon">
    {#if activeMenu !== null || menuDismissGuard}
        <button
            type="button"
            class="fixed inset-0 z-40 cursor-default bg-transparent"
            aria-label="关闭菜单"
            onclick={() => closeMenus()}
        ></button>
    {/if}

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

    <Sidebar.Content class="select-none">
        <Sidebar.Group>
            <Sidebar.GroupLabel>题库</Sidebar.GroupLabel>
            {#if banks.length != 0}
                <DropdownMenu.Root>
                    <DropdownMenu.Trigger
                        disabled={isImporting || importSession !== null}
                    >
                        {#snippet child({ props })}
                            <Sidebar.GroupAction {...props} title="导入题库">
                                <IconAddSquare size={16} stroke={1.75} />
                                <span class="sr-only">导入题库</span>
                            </Sidebar.GroupAction>
                        {/snippet}
                    </DropdownMenu.Trigger>
                    {@render importMenuContent()}
                </DropdownMenu.Root>
            {/if}
            <Sidebar.GroupContent>
                <Sidebar.Menu class="gap-1">
                    {#each banks as bank (bank.hash)}
                        <ContextMenu.Root
                            open={isMenuOpen("context", bank.hash)}
                            onOpenChange={(open) =>
                                handleMenuOpenChange(
                                    "context",
                                    bank.hash,
                                    open,
                                )}
                        >
                            <ContextMenu.Trigger>
                                {#snippet child({ props })}
                                    <Sidebar.MenuItem
                                        {...props}
                                        oncontextmenucapture={() =>
                                            prepareContextMenu(bank.hash)}
                                    >
                                        <Sidebar.MenuButton
                                            isActive={bank.hash === activeHash}
                                            class={isSelected(bank.hash)
                                                ? "ring-sidebar-ring/50 bg-sidebar-accent/60 text-sidebar-accent-foreground ring-1"
                                                : undefined}
                                            onclick={(event) =>
                                                handleBankClick(
                                                    event,
                                                    bank.hash,
                                                )}
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

                                        <DropdownMenu.Root
                                            open={isMenuOpen(
                                                "dropdown",
                                                bank.hash,
                                            )}
                                            onOpenChange={(open) =>
                                                handleMenuOpenChange(
                                                    "dropdown",
                                                    bank.hash,
                                                    open,
                                                )}
                                        >
                                            <DropdownMenu.Trigger>
                                                {#snippet child({ props })}
                                                    <Sidebar.MenuAction
                                                        {...props}
                                                        onclick={() =>
                                                            prepareDropdownMenu(
                                                                bank.hash,
                                                            )}
                                                        showOnHover
                                                    >
                                                        <IconDots
                                                            size={14}
                                                            stroke={1.75}
                                                        />
                                                        <span class="sr-only"
                                                            >操作</span
                                                        >
                                                    </Sidebar.MenuAction>
                                                {/snippet}
                                            </DropdownMenu.Trigger>
                                            <DropdownMenu.Content
                                                side="right"
                                                align="start"
                                                class="w-52"
                                            >
                                                {@render bankActionItems(
                                                    bank,
                                                    "dropdown",
                                                )}
                                            </DropdownMenu.Content>
                                        </DropdownMenu.Root>
                                    </Sidebar.MenuItem>
                                {/snippet}
                            </ContextMenu.Trigger>
                            <ContextMenu.Content
                                side="right"
                                align="start"
                                class="w-48"
                            >
                                {@render bankActionItems(bank, "context")}
                            </ContextMenu.Content>
                        </ContextMenu.Root>
                    {:else}
                        <Sidebar.MenuItem>
                            <DropdownMenu.Root>
                                <DropdownMenu.Trigger
                                    disabled={isImporting ||
                                        importSession !== null}
                                >
                                    {#snippet child({ props })}
                                        <Sidebar.MenuButton
                                            {...props}
                                            class="text-sidebar-foreground/70 justify-center"
                                        >
                                            <IconAdd size={16} stroke={1.75} />
                                            <span class="sr-only">导入题库</span
                                            >
                                        </Sidebar.MenuButton>
                                    {/snippet}
                                </DropdownMenu.Trigger>
                                {@render importMenuContent()}
                            </DropdownMenu.Root>
                        </Sidebar.MenuItem>
                    {/each}
                </Sidebar.Menu>
            </Sidebar.GroupContent>
        </Sidebar.Group>
    </Sidebar.Content>

    <Sidebar.Rail />
</Sidebar.Root>

<AlertToast bind:this={toast} />

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
            <Dialog.Title>{deleteDialogTitle()}</Dialog.Title>
            <Dialog.Description>
                {@html deleteDialogDescription()}
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
