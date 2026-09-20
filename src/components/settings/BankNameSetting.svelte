<script lang="ts">
    import { useQuizSource } from "@/source/context";
    import { Input } from "$lib/components/ui/input";
    import { Label } from "$lib/components/ui/label";
    import { Separator } from "$lib/components/ui/separator";
    import SettingsSection from "./SettingsSection.svelte";

    // 两个模式的设置面板共用这一段：修改侧边栏里展示的题库名称。
    // 名称来源是 App 的 activeBank（重命名后会自动更新），所以这里只接
    // hash + name 两个 prop，不依赖具体是哪种 session。
    interface Props {
        /** 当前题库 hash */
        hash: string;
        /** 当前题库名称 */
        name: string;
    }

    let { hash, name }: Props = $props();

    const source = useQuizSource();

    let draft = $state("");

    // 名称被其它入口（侧边栏菜单）改掉后同步输入框；pre 保证首帧就有值
    $effect.pre(() => {
        draft = name;
    });

    function commit(): void {
        const trimmed = draft.trim();
        if (!trimmed || trimmed === name) {
            draft = name;
            return;
        }
        source.renameBank(hash, trimmed);
    }
</script>

<SettingsSection title="题库">
    <div class="flex items-center justify-between gap-3">
        <Label for="bank-name" class="text-sm font-normal">名称</Label>
        <Input
            id="bank-name"
            bind:value={draft}
            onchange={commit}
            onkeydown={(e) => {
                if (e.key === "Enter") {
                    e.preventDefault();
                    commit();
                    (e.currentTarget as HTMLInputElement).blur();
                }
            }}
            placeholder="题库名称"
            class="h-7 w-44"
        />
    </div>
    <div class="flex items-center text-xs opacity-60 -mt-2">
        Hash ID：<span class="font-mono">{hash}</span>
    </div>
</SettingsSection>

<Separator />
