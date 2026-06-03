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
    import IconMessagePlus from "@tabler/icons-svelte/icons/message-plus";
    import IconCopyCheck from "@tabler/icons-svelte/icons/copy-check";
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
    let importMessage = $state<{ title: string; text: string } | null>(null);

    let renameTarget = $state<{ hash: string; name: string } | null>(null);
    let renameInput = $state("");
    let deleteTarget = $state<{ hash: string; name: string } | null>(null);
    let overwriteTarget = $state<{
        hash: string;
        stateStr: string;
        name: string;
    } | null>(null);
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
                if (result.stateError !== undefined) {
                    importMessage = {
                        title: "题目已导入，进度备份还原失败",
                        text:
                            "题库本身已经入库，但文件附带的进度备份无法解析，" +
                            "该题库将以空进度开始。\n\n原因：" +
                            result.stateError,
                    };
                }
                break;
            case "invalid":
                importMessage = {
                    title: "题库校验失败",
                    text:
                        result.errors.slice(0, 5).join("\n") +
                        (result.errors.length > 5
                            ? `\n…还有 ${result.errors.length - 5} 条问题`
                            : ""),
                };
                break;
            case "duplicate":
                if (result.stateStr !== undefined) {
                    const existing = banks.find((b) => b.hash === result.hash);
                    overwriteTarget = {
                        hash: result.hash,
                        stateStr: result.stateStr,
                        name: existing?.name ?? "该题库",
                    };
                } else {
                    importMessage = {
                        title: "题库已存在",
                        text: "这份题库已经在列表里了。",
                    };
                }
                break;
            case "quota":
                importMessage = {
                    title: "存储空间不足",
                    text:
                        "浏览器存储空间不足，无法导入。\n" +
                        "如果只需要这一份题库，建议改用 Bundled 模式打包成单文件分发。",
                };
                break;
        }
    }

    async function commitOverwrite(): Promise<void> {
        if (!overwriteTarget || !source.applyStateToBank) return;
        const target = overwriteTarget;
        overwriteTarget = null;
        const res = await source.applyStateToBank(target.hash, target.stateStr);
        if (!res.ok) {
            importMessage = {
                title: "进度替换失败",
                text:
                    "文件中的进度备份无法应用到现有题库。\n\n原因：" +
                    res.error,
            };
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

    async function handleExport(hash: string): Promise<void> {
        if (!source.exportBank) return;
        const result = await source.exportBank(hash);
        if (!result) return;

        const blob = new Blob([result.content], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = result.filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
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
                                                <IconMessagePlus />
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
    open={overwriteTarget !== null}
    onOpenChange={(open) => {
        if (!open) overwriteTarget = null;
    }}
>
    <Dialog.Content class="max-w-sm">
        <Dialog.Header>
            <Dialog.Title>题库已存在</Dialog.Title>
            <Dialog.Description>
                「{overwriteTarget?.name}」已经在列表里，导入文件附带了进度备份。是否用文件中的进度替换当前进度？替换后无法撤销。
            </Dialog.Description>
        </Dialog.Header>
        <Dialog.Footer>
            <Button variant="outline" onclick={() => (overwriteTarget = null)}
                >保留当前进度</Button
            >
            <Button variant="destructive" onclick={commitOverwrite}
                >替换进度</Button
            >
        </Dialog.Footer>
    </Dialog.Content>
</Dialog.Root>
