<script lang="ts">
    // 云同步的说明抽屉。
    //
    // 内容与「怎么配置」集中放在这里，设置面板里只留一个入口按钮——
    // 面板本身要短，说明要长，两者不该挤在同一个滚动区里。
    import * as Drawer from "$lib/components/ui/drawer";
    import { Button } from "$lib/components/ui/button";
    import IconExternalLink from "@tabler/icons-svelte/icons/external-link";

    interface Props {
        open?: boolean;
    }

    let { open = $bindable(false) }: Props = $props();
</script>

<Drawer.Root bind:open>
    <!--
        z-index 要盖住设置面板（Dialog 用 z-[60]），但留在 Toast（z-[80]）之下 ——
        这个抽屉是从设置面板里打开的，层级低了就会被压在下面。
    -->
    <Drawer.Content class="z-[70] max-h-[85vh] overflow-hidden">
        <Drawer.Header class="border-b px-5 py-3.5 text-start">
            <Drawer.Title class="text-base font-semibold"
                >云同步说明</Drawer.Title
            >
            <Drawer.Description class="text-xs leading-relaxed">
                把题库与进度同步到你自己 Gitee 账号上的一条私有
                Gist，换设备时点一下就能恢复。
            </Drawer.Description>
        </Drawer.Header>

        <div
            class="flex flex-col gap-5 overflow-y-auto px-5 py-4 text-[13px] leading-relaxed"
        >
            <!-- ── 配置 ─────────────────────────────────────────────── -->
            <section class="flex flex-col gap-3">
                <h3 class="text-sm font-medium">配置（每台设备一次）</h3>
                <ol class="text-muted-foreground flex list-decimal flex-col gap-1.5 pl-5">
                    <li>
                        在 <a
                            class="text-foreground underline underline-offset-2"
                            href="https://gitee.com/profile/personal_access_tokens"
                            target="_blank"
                            rel="noreferrer">Gitee → 设置 → 私人令牌</a
                        >
                        生成一个令牌，<strong class="text-foreground"
                            >只勾 <code>gists</code></strong
                        >（勾了仓库权限也用不上，还更危险）。
                    </li>
                    <li>
                        打开侧边栏左下角<strong class="text-foreground"
                            >全局设置</strong
                        >，打开「云同步」开关，把令牌粘进去。
                    </li>
                    <li>
                        点<strong class="text-foreground">测试连接</strong>，
                        它会列出你账号里可用的代码片段（Gist）：
                        <strong class="text-foreground">第一次用选「新建一条」</strong
                        >；在别的设备上配过，就
                        <strong class="text-foreground">选那条已有的</strong>——选错了等于从零开始。
                    </li>
                    <li>
                        点<strong class="text-foreground">保存</strong>，它会立刻同步一次。
                    </li>
                </ol>
                <p class="text-muted-foreground">
                    浏览器<strong class="text-foreground">直接</strong>和 Gitee
                    通信，没有中转服务器，令牌也不进网址。除了代码片段接口，它不碰你账号里的其它东西。
                </p>
            </section>

            <!-- ── 平时怎么用 ───────────────────────────────────────── -->
            <section class="flex flex-col gap-2">
                <h3 class="text-sm font-medium">平时怎么用</h3>
                <p class="text-muted-foreground">
                    页头右上角那颗点就是状态：
                    <strong class="text-foreground">绿</strong>=已同步、
                    <strong class="text-foreground">黄</strong>=还有没传上去的改动、
                    <strong class="text-foreground">红</strong>=要你处理（点它打开设置）。
                    <strong class="text-foreground">绿和黄都能点</strong>，点了就是手动同步一次
                    ——绿的时候点，是主动把云端的改动拉下来。
                </p>
                <p class="text-muted-foreground">
                    自动同步的时机：打开 / 刷新页面时对一次账，本地改动<strong
                        class="text-foreground">停手 20 秒</strong
                    >后上传，切回页面时与页面开着时每 3 分钟各检查一次云端。
                    关掉「更多操作」里的自动同步，就只有点那颗点或「立即同步」才同步。
                </p>
            </section>

            <!-- ── 同步了什么 ───────────────────────────────────────── -->
            <section class="flex flex-col gap-2">
                <h3 class="text-sm font-medium">同步了什么</h3>
                <p class="text-muted-foreground">
                    题库内容、题库列表与顺序、每个题库的进度、按库与全局设置。<strong
                        class="text-foreground">不上传</strong
                    >：Gitee 令牌和同步自己的记账。
                </p>
                <p class="text-muted-foreground">
                    云端是一条私有 Gist，最多 10 个文件：<code>_general.json</code>（列表 +
                    全局设置）+ 9 个分片 <code>banks-0..8.json</code>（题库按 hash
                    归类，压缩存储）。<strong class="text-foreground"
                        >合并、冲突、删除都按题库逐个判定</strong
                    >，所以同片的题库不会互相牵连。片段描述固定是
                    <code>quiz-app sync</code>，设置面板靠它认出可同步的片段。
                </p>
            </section>

            <!-- ── 更多操作 ─────────────────────────────────────────── -->
            <section class="flex flex-col gap-2">
                <h3 class="text-sm font-medium">「更多操作」里那几个按钮</h3>
                <ul class="text-muted-foreground list-disc pl-5">
                    <li>
                        <strong class="text-foreground">用本地覆盖云端</strong> /
                        <strong class="text-foreground">用云端覆盖本地</strong
                        >：不管冲突，直接让一边盖掉另一边。只在数据确实乱掉时用。
                    </li>
                    <li>
                        <strong class="text-foreground">重建云端</strong
                        >：丢掉本地记住的那条 Gist 和同步记账（<strong
                            class="text-foreground">令牌留着</strong
                        >），随后新建一条 Gist 并把本地数据推上去。用在「云端那条被删了 / 令牌换了账号」，
                        也就是一直报「Gist 不见了」的时候。<strong class="text-foreground"
                            >它不会删掉 Gitee 上旧的那条</strong
                        >，需要的话自己去删。
                    </li>
                    <li>
                        <strong class="text-foreground">清空配置</strong
                        >：把令牌、Gist
                        和同步记账一起清掉并关掉同步，等于从没配过。换账号、不想同步了、怀疑令牌泄露时用；
                        之后再配置要重新填令牌。
                    </li>
                </ul>
                <p class="text-muted-foreground">
                    共同点：这三个都<strong class="text-foreground"
                        >只动同步配置</strong
                    >，本地题库与进度一概不动。
                </p>
            </section>

            <!-- ── 会不会丢数据 ─────────────────────────────────────── -->
            <section class="flex flex-col gap-2">
                <h3 class="text-sm font-medium">会不会把我的数据搞丢</h3>
                <ul class="text-muted-foreground list-disc pl-5">
                    <li>
                        <strong class="text-foreground">冲突不自动选边。</strong
                        >同一个题库两边都改过就停下来问你保留哪一边；在你选择之前，
                        这一轮同步<strong class="text-foreground">什么都不做</strong
                        >（别的题库也等着，页面也不会自己刷新）。
                    </li>
                    <li>
                        <strong class="text-foreground">新设备不会清空云端。</strong
                        >刚打开应用时本地配置是个空壳，它只用来「拉」，不会被推上去覆盖云端的题库列表。
                    </li>
                    <li>
                        <strong class="text-foreground">删除会双向传播。</strong
                        >一边删了题库，另一边下次同步也会删（不想要就用上面那两个「覆盖」按钮指定方向）。
                    </li>
                    <li>
                        <strong class="text-foreground">不认识的文件不删。</strong
                        >云端如果有不是你这份数据的东西，它不碰。
                    </li>
                </ul>
            </section>

            <!-- ── FAQ ──────────────────────────────────────────────── -->
            <section class="flex flex-col gap-3">
                <h3 class="text-sm font-medium">常见问题</h3>

                <div class="flex flex-col gap-1">
                    <p class="font-medium">令牌会不会泄露？</p>
                    <p class="text-muted-foreground">
                        令牌只存在这台设备的浏览器里，不上传。但能打开这台设备浏览器的人就能读到它；
                        怀疑泄露就去 Gitee 撤销并重新生成一个。
                    </p>
                </div>

                <div class="flex flex-col gap-1">
                    <p class="font-medium">在 Gitee 上看到好几条同名片段？</p>
                    <p class="text-muted-foreground">
                        挑<strong class="text-foreground">文件最多的那条</strong
                        >通常就是你在用的；其余的可以自己删掉（正在用的那条别删）。
                    </p>
                </div>

                <div class="flex flex-col gap-1">
                    <p class="font-medium">为什么只能有一个云端？</p>
                    <p class="text-muted-foreground">
                        这是给一个人在多台设备之间同步用的，不是团队协作工具。一条 Gist 就是一份数据。
                    </p>
                </div>
            </section>
        </div>

        <Drawer.Footer class="flex-row items-center justify-end border-t pt-3">
            <div class="flex items-center gap-2">
                <Button
                    variant="outline"
                    size="sm"
                    href="https://gitee.com/profile/personal_access_tokens"
                    target="_blank"
                    rel="noreferrer"
                >
                    <IconExternalLink size={14} stroke={1.5} />
                    去生成令牌
                </Button>
                <Drawer.Close>
                    {#snippet child({ props })}
                        <Button {...props} size="sm">知道了</Button>
                    {/snippet}
                </Drawer.Close>
            </div>
        </Drawer.Footer>
    </Drawer.Content>
</Drawer.Root>
