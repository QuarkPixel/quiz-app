<script lang="ts">
    /**
     * `attachOverlaySound` 的最小外壳。
     *
     * 只需要一个能改的 `open` 与两个一次性判断，就能覆盖 `skipOpen` / `skipClose`
     * 这两条「不要叠音」的规则；真实的 Dialog 组件在这里只会增加噪音。
     */
    import { attachOverlaySound } from "../src/sound";

    interface Props {
        open?: boolean;
        skipOpen?: () => boolean;
        skipClose?: () => boolean;
    }

    let { open: initialOpen = false, skipOpen, skipClose }: Props = $props();

    // svelte-ignore state_referenced_locally
    let open = $state(initialOpen);

    attachOverlaySound(() => open, {
        skipOpen: () => skipOpen?.() === true,
        skipClose: () => skipClose?.() === true,
    });

    export function setOpen(value: boolean): void {
        open = value;
    }
</script>

<p>{open ? "open" : "closed"}</p>
