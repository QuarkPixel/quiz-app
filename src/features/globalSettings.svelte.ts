/**
 * 全局设置的响应式来源。
 *
 * 全局设置（音效 / 选中自动提交 / 答对自动下一题）跨题库共享，并且要求在
 * 没有 activeBank 时也能修改，所以它们不能只活在 QuizSession 里：
 * 这里是应用级单例，侧边栏的「全局设置」与 QuizSession 共用同一个实例。
 *
 * 变更通过 `persist()` 写回 general 配置。
 */

import { loadGeneralConfig, updateGeneralConfig } from "@/generalConfig";
import { sanitizeGlobalSettings } from "@/globalSettings";
import type { GlobalSettings } from "@/types";

export class GlobalSettingsStore {
  value: GlobalSettings = $state(
    sanitizeGlobalSettings(loadGeneralConfig().globalSettings),
  );

  /** 从 localStorage 重新读取（测试隔离 / 外部写入后刷新）。 */
  reload(): GlobalSettings {
    this.value = sanitizeGlobalSettings(loadGeneralConfig().globalSettings);
    return this.value;
  }

  /** 合并 patch 并写回 general 配置。失败仅 warn，不打断做题流。 */
  update(patch: Partial<GlobalSettings>): void {
    this.value = { ...this.value, ...patch };
    this.persist();
  }

  /** 把当前内存值写回 general 配置。 */
  persist(): void {
    try {
      updateGeneralConfig({
        globalSettings: sanitizeGlobalSettings(this.value),
      });
    } catch (e) {
      console.warn("Failed to save global settings:", e);
    }
  }
}

/** 应用级单例；测试可调用 reload() 或自建实例注入 QuizSession。 */
export const globalSettingsStore = new GlobalSettingsStore();
