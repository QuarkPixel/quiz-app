/**
 * 全局设置对话框的开关。
 *
 * 入口有两个，而且分属不同的组件树分支：
 *   - 侧边栏左下角的「全局设置」按钮（`Sidebar.svelte`）
 *   - 页头那颗云同步指示点——**有冲突时它会变红**，点一下要直接把人送到冲突选择那里
 *     （`AppShell.svelte`）
 *
 * 所以这个开关不能留在某一个组件里，做成响应式单例两边共用。
 * 对话框本身仍然由 `Sidebar.svelte` 渲染（它是 `<GlobalSettings>` 的宿主）。
 */

class GlobalSettingsDialogStore {
    open: boolean = $state(false);

    show(): void {
        this.open = true;
    }

    close(): void {
        this.open = false;
    }
}

export const globalSettingsDialog = new GlobalSettingsDialogStore();
