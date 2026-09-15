/**
 * general 配置：应用里唯一的「非题库内容」存储。
 *
 * 结构：
 *   {
 *     activeBank: string | null,       当前激活题库的 hash
 *     defaultSettings: BankSettings,   新题库的按库设置默认模板
 *     library: BankSummary[],          题库列表索引
 *     globalSettings: GlobalSettings,  跨题库共享的全局偏好
 *   }
 *
 * 每个题库的题目内容与进度仍然单独存放（见 `src/store.ts` 与 `src/source/`）。
 * 所有写入都走这里，保证 general 键只有一个写入者视角、不会互相覆盖。
 */

import {
  LEGACY_STORAGE_KEY_ACTIVE_BANK,
  LEGACY_STORAGE_KEY_DEFAULT_SETTINGS,
  LEGACY_STORAGE_KEY_LIBRARY,
  STORAGE_KEY_GENERAL,
} from "./config";
import { createDefaultBankSettings, sanitizeBankSettings } from "./bankSettings";
import {
  createDefaultGlobalSettings,
  sanitizeGlobalSettings,
} from "./globalSettings";
import type { BankMode, BankSettings, GlobalSettings } from "./types";
import type { BankSummary } from "./source/types";

export interface GeneralConfig {
  activeBank: string | null;
  defaultSettings: BankSettings;
  library: BankSummary[];
  globalSettings: GlobalSettings;
}

export function createDefaultGeneralConfig(): GeneralConfig {
  return {
    activeBank: null,
    defaultSettings: createDefaultBankSettings(),
    library: [],
    globalSettings: createDefaultGlobalSettings(),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function normalizeBankSummary(value: unknown): BankSummary | null {
  if (!isRecord(value)) return null;
  if (typeof value.hash !== "string" || value.hash.length === 0) return null;
  if (typeof value.name !== "string") return null;
  if (!isFiniteNumber(value.count)) return null;
  if (!isFiniteNumber(value.addedAt)) return null;

  const mode: BankMode = value.mode === "memory" ? "memory" : "quiz";
  return {
    hash: value.hash,
    name: value.name,
    mode,
    count: value.count,
    addedAt: value.addedAt,
  };
}

function normalizeLibrary(raw: unknown): BankSummary[] {
  if (!Array.isArray(raw)) {
    if (raw !== undefined) {
      console.warn("library 不是数组，已忽略。");
    }
    return [];
  }

  const result: BankSummary[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const summary = normalizeBankSummary(item);
    if (!summary || seen.has(summary.hash)) continue;
    seen.add(summary.hash);
    result.push(summary);
  }

  if (result.length !== raw.length) {
    console.warn("已忽略非法的 library 条目。");
  }
  return result;
}

function normalizeGeneralConfig(raw: unknown): GeneralConfig {
  const defaults = createDefaultGeneralConfig();
  if (!isRecord(raw)) return defaults;

  const library = normalizeLibrary(raw.library);
  const savedActive = raw.activeBank;
  const activeBank =
    typeof savedActive === "string" &&
    library.some((bank) => bank.hash === savedActive)
      ? savedActive
      : (library[0]?.hash ?? null);

  return {
    activeBank,
    library,
    defaultSettings: sanitizeBankSettings(raw.defaultSettings),
    globalSettings: sanitizeGlobalSettings(raw.globalSettings),
  };
}

/** 从 localStorage 读取 general 配置；缺失时回落到代码默认值。 */
export function loadGeneralConfig(): GeneralConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_GENERAL);
    if (raw !== null) return normalizeGeneralConfig(JSON.parse(raw));
  } catch (e) {
    console.error("Failed to load general config:", e);
  }

  const legacy = readLegacyConfig();
  if (legacy) {
    try {
      saveGeneralConfig(legacy);
      clearLegacyConfigKeys();
    } catch (e) {
      console.warn("Failed to migrate legacy config:", e);
    }
    return legacy;
  }

  return createDefaultGeneralConfig();
}

/**
 * 写入 general 配置。可能抛出配额等异常，由调用方决定是否吞掉
 * （例如做题流里的设置保存应容错，而导入题库需要据此回滚）。
 */
export function saveGeneralConfig(config: GeneralConfig): void {
  localStorage.setItem(
    STORAGE_KEY_GENERAL,
    JSON.stringify(normalizeGeneralConfig(config)),
  );
}

/**
 * 读取 → 合并 patch → 写回。
 * 所有对 general 配置的增量修改都应走这里，避免部分字段被旧快照覆盖。
 */
export function updateGeneralConfig(
  patch: Partial<GeneralConfig>,
): GeneralConfig {
  const next = { ...loadGeneralConfig(), ...patch };
  saveGeneralConfig(next);
  return next;
}

// ── 一次性迁移：旧版把配置拆成 quiz_app_library / active_bank / default_settings ──

function readLegacyConfig(): GeneralConfig | null {
  const legacyLibraryRaw = localStorage.getItem(LEGACY_STORAGE_KEY_LIBRARY);
  const legacyActiveRaw = localStorage.getItem(LEGACY_STORAGE_KEY_ACTIVE_BANK);
  const legacyDefaultsRaw = localStorage.getItem(
    LEGACY_STORAGE_KEY_DEFAULT_SETTINGS,
  );
  if (
    legacyLibraryRaw === null &&
    legacyActiveRaw === null &&
    legacyDefaultsRaw === null
  ) {
    return null;
  }

  let library: BankSummary[] = [];
  if (legacyLibraryRaw !== null) {
    try {
      library = normalizeLibrary(JSON.parse(legacyLibraryRaw));
    } catch (e) {
      console.warn("Failed to parse legacy library index:", e);
    }
  }

  let defaultSettings = createDefaultBankSettings();
  let globalSettings = createDefaultGlobalSettings();
  if (legacyDefaultsRaw !== null) {
    try {
      const parsed = JSON.parse(legacyDefaultsRaw);
      defaultSettings = sanitizeBankSettings(parsed);
      // 旧版把全局字段和按库字段混在同一个对象里，这里一并拆出来。
      globalSettings = sanitizeGlobalSettings(parsed);
    } catch (e) {
      console.warn("Failed to parse legacy default settings:", e);
    }
  }

  const activeBank =
    legacyActiveRaw !== null &&
    library.some((bank) => bank.hash === legacyActiveRaw)
      ? legacyActiveRaw
      : (library[0]?.hash ?? null);

  return { activeBank, library, defaultSettings, globalSettings };
}

function clearLegacyConfigKeys(): void {
  for (const key of [
    LEGACY_STORAGE_KEY_LIBRARY,
    LEGACY_STORAGE_KEY_ACTIVE_BANK,
    LEGACY_STORAGE_KEY_DEFAULT_SETTINGS,
  ]) {
    try {
      localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  }
}
