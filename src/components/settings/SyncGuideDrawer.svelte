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
        z-index 要盖住设置面板（Dialog 用 z-(--z-dialog)），但留在 Toast（z-(--z-tooltip)）之下 ——
        这个抽屉是从设置面板里打开的，层级低了就会被压在下面。
    -->
    <Drawer.Content class="z-(--z-drawer) max-h-[85vh] overflow-hidden">
        <Drawer.Header class="border-b px-5 py-3.5 text-start">
            <Drawer.Title class="text-base font-semibold"
                >云同步说明</Drawer.Title
            >
            <Drawer.Description class="text-xs leading-relaxed">
                题库与进度同步到自己的 Gitee 私有 Gist。
            </Drawer.Description>
        </Drawer.Header>

        <div
            class="text-muted-foreground flex flex-col gap-8 leading-10 overflow-y-auto px-5 py-4 text-base max-w-160 m-auto"
        >
            <section class="flex flex-col gap-2">
                <h3 class="text-foreground text-lg font-bold">它是做什么的</h3>
                <p>
                    把题库和进度同步到你自己 Gitee 账号下的一条私有
                    Gist（代码片段）。 浏览器直接与 Gitee
                    通信，没有中转服务器；换设备、换浏览器、清理过浏览器数据之后，
                    配上同一个令牌和同一条片段，就能把数据恢复回来。
                </p>
            </section>

            <section class="flex flex-col gap-2">
                <h3 class="text-foreground text-lg font-bold">
                    配置（每台设备一次）
                </h3>
                <ol class="flex list-decimal flex-col gap-1.5 pl-5">
                    <li>
                        在 <a
                            class="text-foreground underline underline-offset-2"
                            href="https://gitee.com/profile/personal_access_tokens"
                            target="_blank"
                            rel="noreferrer">Gitee → 设置 → 私人令牌</a
                        >
                        生成一个令牌。权限只勾 <code>gists</code>
                        ——同步功能只用得到代码片段接口，不碰你账号里的其他东西。
                    </li>
                    <li>
                        打开「云同步」开关，把令牌粘进输入框，点「测试连接」确认令牌可用，
                        然后在候选列表里选择目标片段，点「保存」。
                    </li>
                    <li>
                        <strong class="text-foreground"
                            >第一次使用选「新建」</strong
                        >，同步时会在你的 Gitee 账号下创建一条新的私有 Gist；
                        如果之前已经在别的设备上配过，就
                        <strong class="text-foreground">选中已有的那一条</strong
                        >——选错等于从零开始，两边的内容不会自动合并。
                    </li>
                </ol>
                <p>
                    令牌只保存在这台设备的浏览器里，不会上传到云端，也不会写进网址。
                    但它以明文存在本地，能打开这台设备浏览器的人就能读到；
                    怀疑泄露时，去 Gitee 撤销并重新生成一个。
                </p>
            </section>

            <section class="flex flex-col gap-2">
                <h3 class="text-foreground text-lg font-bold">
                    同步的内容包括：
                </h3>
                <p>
                    题库本身、题库列表与顺序、每个题库的做题进度，
                    以及全局设置与按题库的默认设置。
                    <strong class="text-foreground">不上传</strong>
                    的是 Gitee 令牌和同步自己的记账（哪天同步过、每个题库同步到哪一版），
                    这两样只对当前设备有意义。
                </p>
                <p>
                    云端是一条 Gist，文件数上限 10 个：一个
                    <code>_general.json</code> 保存题库列表与设置，另外 9
                    个分片文件
                    <code>banks-0..8.json</code>
                    按题库哈希分散存放题库内容。分片只是绕开文件数上限的容器，
                    <strong class="text-foreground"
                        >合并、冲突、删除都按题库逐个判定</strong
                    >，所以同一个分片里的题库不会互相牵连。
                </p>
            </section>

            <section class="flex flex-col gap-2">
                <h3 class="text-foreground text-lg font-bold">什么时候同步</h3>
                <p>
                    打开或刷新页面时会先与云端对一次账；本地改动停止 20
                    秒后自动上传（连续答题时会一直往后推，不会每写一次就传一次）；
                    页面开着时每 3 分钟检查一次，切回页面时也会立刻检查。
                    关掉「更多设置」里的自动同步之后，只有点「立即同步」才会同步。
                </p>
                <p>
                    页头右上角那颗点是状态：绿色表示与云端一致，黄色表示还有没上传的改动，
                    红色表示需要你处理（有冲突或同步出错，点一下会打开设置）。
                </p>
            </section>

            <section class="flex flex-col gap-2">
                <h3 class="text-foreground text-lg font-bold">冲突与覆盖</h3>
                <p>
                    如果同一个题库在两台设备上都改过，同步会在这个题库上停下来，
                    在设置面板里问你保留哪一边，你选择之前它不会动这个题库，
                    页面的其他部分也不会自己刷新。
                    <strong class="text-foreground">它不会替你猜</strong>。
                </p>
                <p>
                    「更多设置」里的「用本地覆盖云端」和「用云端覆盖本地」是两把蛮力：
                    它们不区分冲突，直接让指定的一边成为最终结果。只在数据确实乱了、
                    你清楚哪一边才是对的时候用。
                </p>
            </section>

            <section class="flex flex-col gap-2">
                <h3 class="text-foreground text-lg font-bold">换一条云端</h3>
                <p>
                    点令牌右边的铅笔图标进入编辑态，测试连接之后重新选择或新建一条片段，
                    保存即可。换了目标之后，本地的同步记账会被清空——旧记录对新目标没有意义，
                    留着反而会让两边内容被判成冲突。
                </p>
                <p>
                    候选列表里每一行右边的垃圾桶会把那条片段
                    <strong class="text-foreground">从 Gitee 上删掉</strong>
                    ，需要点两下确认，删掉之后找不回来。如果删的正好是当前正在用的那一条，
                    本地的连接会一起断开。
                </p>
            </section>

            <section class="flex flex-col gap-2">
                <h3 class="text-foreground text-lg font-bold">清空配置</h3>
                <p>
                    编辑态里的「清空配置」会删除本地保存的令牌、Gist
                    记录和同步记账，并关闭云同步，等于这台设备从没配过。
                    <strong class="text-foreground"
                        >它不影响本地题库与进度</strong
                    >， 也不会删除 Gitee
                    上已有的片段——要清云端请用候选列表里的垃圾桶。
                </p>
            </section>

            <section class="flex flex-col gap-2">
                <h3 class="text-foreground text-lg font-bold">常见疑问</h3>
                <p>
                    <strong class="text-foreground"
                        >目标仓库被删了怎么办？</strong
                    >
                    面板上那条 id 会被划掉并标注「已被删除」。点铅笔图标进编辑态，
                    重新选一条已有的片段，或者选「新建」让本地数据重新传上去即可。
                </p>
                <p>
                    <strong class="text-foreground"
                        >同步会不会把我的数据搞丢？</strong
                    >
                    冲突不自动选边；新设备刚打开时本地配置是空壳，只会从云端拉取，
                    不会把云端列表覆盖成空的；一边删掉的题库会在另一边跟着删； 云端里不属于本应用的文件一律不碰。
                </p>
                <p>
                    <strong class="text-foreground">需要经常手动同步吗？</strong
                    >
                    不需要。自动同步会处理日常改动，只有在刚配好、换了目标， 或者想立刻确认云端状态时才需要点「立即同步」。
                </p>
            </section>
        </div>
        <Drawer.Footer class="border-t pt-3">
            <div
                class="flex items-center justify-end max-w-160 gap-2 w-full mx-auto"
            >
                <!-- <div class="flex items-center gap-2"> -->
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
            <!-- </div> -->
        </Drawer.Footer>
    </Drawer.Content>
</Drawer.Root>
