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
            <!-- ── 它是什么 ─────────────────────────────────────────── -->
            <section class="flex flex-col gap-2">
                <h3 class="text-sm font-medium">它是怎么工作的</h3>
                <pre
                    class="bg-muted/50 overflow-x-auto rounded-lg p-3 text-[11px] leading-relaxed"><code
                        >你的浏览器 ──► gitee.com/api/v5/gists
                  └── Authorization: Bearer &lt;你的私人令牌&gt;</code
                    ></pre>
                <p class="text-muted-foreground">
                    浏览器<strong class="text-foreground">直接</strong>和 Gitee
                    通信，中间没有任何中转服务器， 令牌也不会出现在网址里。除了
                    Gitee 的代码片段接口，它不碰你账号里的任何其它东西。
                </p>
            </section>

            <!-- ── 怎么配 ───────────────────────────────────────────── -->
            <section class="flex flex-col gap-3">
                <h3 class="text-sm font-medium">配置步骤（每台设备一次）</h3>

                <div class="flex flex-col gap-1.5">
                    <p class="font-medium">1. 在 Gitee 上生成一个私人令牌</p>
                    <ul class="text-muted-foreground list-disc pl-5">
                        <li>
                            打开 <a
                                class="text-foreground underline underline-offset-2"
                                href="https://gitee.com/profile/personal_access_tokens"
                                target="_blank"
                                rel="noreferrer">gitee.com → 设置 → 私人令牌</a
                            >
                        </li>
                        <li>
                            点「生成新令牌」，<strong class="text-foreground"
                                >只勾 <code>gists</code> 这一项</strong
                            >
                        </li>
                        <li>复制生成出来的那串字符</li>
                    </ul>
                    <p
                        class="rounded-lg border border-amber-500/40 bg-amber-500/5 p-2.5 text-[12px]"
                    >
                        <strong>只勾 <code>gists</code>。</strong>
                        勾了 <code>projects</code> / <code>pull_requests</code> 之类会让这个令牌能改你的代码仓库，
                        而同步功能完全用不到那些权限。
                    </p>
                </div>

                <div class="flex flex-col gap-1.5">
                    <p class="font-medium">2. 填进应用</p>
                    <ol class="text-muted-foreground list-decimal pl-5">
                        <li>
                            打开左侧栏左下角的<strong class="text-foreground"
                                >全局设置</strong
                            >， 打开最上面「云同步」旁边的开关
                        </li>
                        <li>把令牌粘进输入框</li>
                        <li>
                            点 <strong class="text-foreground">测试连接</strong> ——
                            通过后它会列出你账号里所有代码片段
                        </li>
                        <li>
                            <strong class="text-foreground"
                                >选一条要同步的</strong
                            >：
                            第一次用就选「新建」；在别的设备上配过就选那条已有的
                            （列在「可同步的代码片段」里）
                        </li>
                        <li>
                            点 <strong class="text-foreground">保存</strong>
                        </li>
                    </ol>
                </div>

                <div class="flex flex-col gap-1.5">
                    <p class="font-medium">3. 同步</p>
                    <p class="text-muted-foreground">
                        第一次点 <strong class="text-foreground">立即同步</strong> 建好云端。之后都是自动的：
                        每次打开 / 刷新页面先对一次账；本地改动停手 20 秒后上传；切回页面时、
                        以及页面开着时每 3 分钟，各检查一次云端。
                    </p>
                </div>
            </section>

            <!-- ── 换设备 ───────────────────────────────────────────── -->
            <section class="flex flex-col gap-2">
                <h3 class="text-sm font-medium">换设备时</h3>
                <p class="text-muted-foreground">
                    在新设备上重复上面第 1、2 步（<strong
                        class="text-foreground">同一串令牌</strong
                    >）。 关键在最后一步：<strong class="text-foreground"
                        >要选那条已有的代码片段</strong
                    >， 而不是「新建」——
                    否则数据会从这个空的新片段开始，等于什么都没同步过来。
                    选好之后点「立即同步」，云端那份会被完整拉下来。
                </p>
            </section>

            <!-- ── 同步了什么 ───────────────────────────────────────── -->
            <section class="flex flex-col gap-2">
                <h3 class="text-sm font-medium">同步了什么</h3>
                <ul class="text-muted-foreground list-disc pl-5">
                    <li>
                        <strong class="text-foreground">题库内容</strong
                        >：导入的题目本身
                    </li>
                    <li>
                        <strong class="text-foreground">题库列表与顺序</strong
                        >：侧边栏那份列表，以及当前选中哪个
                    </li>
                    <li>
                        <strong class="text-foreground">每个题库的进度</strong
                        >：掌握情况、活动池、记忆模式的复习阶梯
                    </li>
                    <li>
                        <strong class="text-foreground">各类设置</strong
                        >：按题库的设置与全局设置
                    </li>
                </ul>
                <p class="text-muted-foreground">
                    <strong class="text-foreground">不会上传</strong>的：你的
                    Gitee 令牌、以及同步自己的记账数据。
                </p>
            </section>

            <!-- ── 云端长什么样 ─────────────────────────────────────── -->
            <section class="flex flex-col gap-2">
                <h3 class="text-sm font-medium">云端长什么样</h3>
                <p class="text-muted-foreground">
                    <strong class="text-foreground"
                        >所有数据只装在一条代码片段里</strong
                    >， 固定这几个文件（Gitee 单条最多 10
                    个文件，所以是这么分的）：
                </p>
                <pre
                    class="bg-muted/50 overflow-x-auto rounded-lg p-3 text-[11px] leading-relaxed"><code
                        >_general.json     题库列表 + 全局设置
banks-0.json      ┐
…                 ├─ 题库按内容归类到这 9 个分片里
banks-8.json      ┘</code
                    ></pre>
                <p class="text-muted-foreground">
                    每个文件都是压缩过的（实测 200 张卡约 5 KB）。
                    <strong class="text-foreground"
                        >合并、冲突、删除都是按题库逐个判定的</strong
                    >，分片只是装它们的盒子：你刷哪个题库，就只会重传它所在的那一片，
                    同片的别的题库不会跟着遭殃。
                    这条代码片段的描述固定是 <code>quiz-app sync</code>，
                    设置面板就是靠它 + 有没有 <code>_general.json</code> 把可同步的片段筛出来的。
                </p>
                <p class="text-muted-foreground">
                    如果你在 Gitee
                    上看到好几条同名的片段（比如以前同步失败留下的）， 挑<strong
                        class="text-foreground">文件最多的那条</strong
                    >通常就是对的； 其余的可以自己删掉。
                </p>
            </section>

            <!-- ── 安全性 ───────────────────────────────────────────── -->
            <section class="flex flex-col gap-2">
                <h3 class="text-sm font-medium">会不会把我的数据搞丢</h3>
                <p class="text-muted-foreground">
                    设计上所有可能覆盖数据的地方都偏保守：
                </p>
                <ul class="text-muted-foreground list-disc pl-5">
                    <li>
                        <strong class="text-foreground">冲突不自动选边。</strong
                        >
                        同一个题库两边都被改过时它会停下来问你保留哪一边，绝不擅自覆盖。
                        在你做出选择之前，这一轮同步<strong class="text-foreground"
                            >什么都不做</strong
                        >——别的题库也先等着，页面也不会自己刷新。
                    </li>
                    <li>
                        <strong class="text-foreground">新设备不会清空云端。</strong
                        >
                        刚打开应用时本地那份配置是个空壳，它只用来「拉」，绝不会被推上去覆盖云端
                        的题库列表。
                    </li>
                    <li>
                        <strong class="text-foreground">删除会双向传播。</strong
                        >
                        你在一边删掉题库，另一边下次同步也会把它删掉（不想要这个行为就用
                        「用本地覆盖云端 / 用云端覆盖本地」明确指定方向）。
                    </li>
                    <li>
                        <strong class="text-foreground"
                            >不认识的文件不删。</strong
                        >
                        云端如果有不是你这份数据的东西，它不会去动。
                    </li>
                </ul>
            </section>

            <!-- ── FAQ ──────────────────────────────────────────────── -->
            <section class="flex flex-col gap-3">
                <h3 class="text-sm font-medium">常见问题</h3>

                <div class="flex flex-col gap-1">
                    <p class="font-medium">令牌会不会泄露？</p>
                    <p class="text-muted-foreground">
                        令牌只存在这台设备的浏览器本地存储里，不会上传到任何地方。但反过来说：
                        <strong class="text-foreground"
                            >任何能打开这台设备浏览器的人都能读到它</strong
                        >。 怀疑泄露就去 Gitee 撤销那个令牌，重新生成一个。
                    </p>
                </div>

                <div class="flex flex-col gap-1">
                    <p class="font-medium">为什么只能有一个云端？</p>
                    <p class="text-muted-foreground">
                        这是给一个人在多台设备之间同步用的，不是团队协作工具。一条
                        Gist 就是一份数据。
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
