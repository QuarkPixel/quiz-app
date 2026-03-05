<script lang="ts">
    import type { RuntimeState } from "../types";

    // @ts-ignore
    import settingsRaw from "../../icons/MaterialSymbolsSettingsOutlineRounded.svg?raw";

    interface Props {
        appState: RuntimeState;
        onReset: () => void;
        onSettingsChange: () => void;
    }

    let { appState, onReset, onSettingsChange }: Props = $props();

    let showMenu = $state(false);

    // 更新设置并保存
    function updateSettings() {
        onSettingsChange();
    }

    // 点击外部关闭菜单
    function handleClickOutside(event: MouseEvent) {
        const target = event.target as HTMLElement;
        if (!target.closest(".settings-menu")) {
            showMenu = false;
        }
    }
</script>

<svelte:window onclick={handleClickOutside} />

<div class="settings-menu">
    <button
        class="settings-toggle"
        aria-label="设置"
        onclick={() => (showMenu = !showMenu)}
    >
        {@html settingsRaw}
    </button>
    {#if showMenu}
        <div class="settings-dropdown">
            <div class="settings-section">
                <h3>界面设置</h3>
                <div class="settings-option">
                    <label for="auto-next">答题正确时自动下一题</label>
                    <input
                        type="checkbox"
                        id="auto-next"
                        bind:checked={appState.settings.autoNextOnCorrect}
                        onchange={updateSettings}
                    />
                </div>
            </div>

            <div class="settings-section">
                <h3>学习算法</h3>
                <div class="settings-option">
                    <label for="pool-size">活动题目池大小</label>
                    <input
                        type="number"
                        id="pool-size"
                        min="5"
                        max="100"
                        bind:value={appState.settings.activePoolSize}
                        onchange={updateSettings}
                    />
                </div>
                <div class="settings-option">
                    <label for="streak-master">首次掌握所需连续正确次数</label>
                    <input
                        type="number"
                        id="streak-master"
                        min="1"
                        max="10"
                        bind:value={appState.settings.correctStreakToMaster}
                        onchange={updateSettings}
                    />
                </div>
                <div class="settings-option">
                    <label for="streak-mistake">答错后掌握所需连续正确次数</label>
                    <input
                        type="number"
                        id="streak-mistake"
                        min="1"
                        max="20"
                        bind:value={appState.settings.correctStreakAfterMistake}
                        onchange={updateSettings}
                    />
                </div>
            </div>

            <div class="settings-section">
                <button class="btn-reset" onclick={onReset}>
                    重置所有进度
                </button>
            </div>
        </div>
    {/if}
</div>

<style>
    .settings-menu {
        position: fixed;
        left: 20px;
        bottom: 20px;
    }

    .settings-toggle {
        width: 40px;
        height: 40px;
        padding: 8px;
        border: none;
        background: unset;
        border-radius: 50%;
        cursor: pointer;
        color: #0003;
        transition: all 0.2s;
        display: flex;
        align-items: center;
        justify-content: center;
    }

    @media (prefers-color-scheme: dark) {
        .settings-toggle {
            color: #fff3;
        }
    }

    .settings-toggle:hover {
        color: #007bff;
        transform: rotate(30deg);
    }

    .settings-dropdown {
        position: absolute;
        left: 0;
        bottom: 100%;
        margin-bottom: 8px;
        padding: 16px;
        background: white;
        border: 1px solid #ddd;
        border-radius: 12px;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
        min-width: 280px;
        max-width: 320px;
        z-index: 10;
    }

    @media (prefers-color-scheme: dark) {
        .settings-dropdown {
            background: #333;
            border-color: #444;
        }
    }

    .settings-section {
        margin-bottom: 16px;
    }

    .settings-section:last-child {
        margin-bottom: 0;
    }

    .settings-section h3 {
        margin: 0 0 12px 0;
        font-size: 14px;
        font-weight: 600;
        color: #666;
        text-transform: uppercase;
        letter-spacing: 0.5px;
    }

    @media (prefers-color-scheme: dark) {
        .settings-section h3 {
            color: #aaa;
        }
    }

    .settings-option {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 8px 0;
        gap: 12px;
        font-size: 14px;
        color: #333;
    }

    @media (prefers-color-scheme: dark) {
        .settings-option {
            color: #e0e0e0;
        }
    }

    .settings-option label {
        cursor: pointer;
        user-select: none;
        flex: 1;
    }

    .settings-option input[type="checkbox"] {
        cursor: pointer;
        width: 18px;
        height: 18px;
    }

    .settings-option input[type="number"] {
        width: 60px;
        padding: 4px 8px;
        border: 1px solid #ddd;
        border-radius: 4px;
        background: white;
        color: #333;
        font-size: 14px;
        text-align: center;
    }

    @media (prefers-color-scheme: dark) {
        .settings-option input[type="number"] {
            background: #2a2a2a;
            border-color: #555;
            color: #e0e0e0;
        }
    }

    .btn-reset {
        width: 100%;
        padding: 10px 16px;
        background: transparent;
        color: #dc3545;
        border: 1px solid #dc3545;
        border-radius: 6px;
        cursor: pointer;
        font-size: 14px;
        transition: all 0.2s;
        font-weight: 500;
    }

    .btn-reset:hover {
        background: #dc3545;
        color: white;
    }
</style>
