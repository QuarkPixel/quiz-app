<script lang="ts">
    import * as Dialog from "$lib/components/ui/dialog";
    import { Button } from "$lib/components/ui/button";

    /**
     * 「导入进度」的二次确认。
     *
     * 导入会**覆盖当前全部进度且不可撤销**，所以两个模式都要先问一次：
     * 以前只有刷题模式有（`QuizSession.importConfirmText` + QuizView 里的弹窗），
     * 记忆模式是解析完直接落盘。现在弹窗与文案只此一份，两个 session 各自持有
     * 一个 `importConfirmText` 状态即可。
     */
    interface Props {
        /** 待确认的进度文本；`null` = 不显示弹窗 */
        text: string | null;
        onCancel: () => void;
        onConfirm: () => void;
    }

    let { text, onCancel, onConfirm }: Props = $props();
</script>

<Dialog.Root
    open={text !== null}
    onOpenChange={(open) => {
        if (!open) onCancel();
    }}
>
    <Dialog.Content class="max-w-sm">
        <Dialog.Header>
            <Dialog.Title>导入进度</Dialog.Title>
            <Dialog.Description>
                导入进度将覆盖当前所有进度，无法撤销，确定继续吗？
            </Dialog.Description>
        </Dialog.Header>
        <Dialog.Footer>
            <Button variant="outline" onclick={onCancel}>取消</Button>
            <Button onclick={onConfirm}>导入</Button>
        </Dialog.Footer>
    </Dialog.Content>
</Dialog.Root>
