import { getRequiredStreak } from "@/algorithm";
import type { ActivePoolItem, Question, RuntimeState } from "@/types";

/** 学习中进度条中的一段：level 是稳定身份，width 可为 0 用于平滑过渡 */
export interface LearningSegment {
  level: number;
  color: string;
  widthPercent: number;
}

function mixLearningColor(
  t: number,
  from: string = "var(--learning-color-high)",
  to: string = "var(--learning-color-low)",
): string {
  const highPercent = Math.max(0, Math.min(100, t * 100));
  const lowPercent = 100 - highPercent;
  return `color-mix(in oklch, ${to} ${lowPercent.toFixed(2)}%, ${from} ${highPercent.toFixed(2)}%)`;
}

/**
 * `--learning-color-low` / `--learning-color-high` 在 app.css 里的字面值。
 *
 * CSS 变量只有在样式表里才解析得开，canvas、SVG 属性这类地方要的是真色值，
 * 所以这里把两个端点抄了一份；改 app.css 时记得一起改（有测试盯着一致性）。
 */
export const LEARNING_COLOR_HEX = {
  light: { low: "#81912f", high: "#e59f41" },
  dark: { low: "#9bab3d", high: "#f8c463" },
} as const;

export type LearningColorScheme = keyof typeof LEARNING_COLOR_HEX;

interface Oklch {
  l: number;
  c: number;
  h: number;
}

function channelToLinear(channel: number): number {
  return channel <= 0.04045
    ? channel / 12.92
    : ((channel + 0.055) / 1.055) ** 2.4;
}

function linearToChannel(linear: number): number {
  return linear <= 0.0031308
    ? 12.92 * linear
    : 1.055 * linear ** (1 / 2.4) - 0.055;
}

/** `"#81912f"` / `"81912f"` → `[r, g, b]`（0..255），认不出来返回 null。 */
function parseHexColor(hex: string): [number, number, number] | null {
  const raw = hex.trim().replace(/^#/, "");
  if (!/^[0-9a-f]{6}$/i.test(raw)) return null;
  return [
    Number.parseInt(raw.slice(0, 2), 16),
    Number.parseInt(raw.slice(2, 4), 16),
    Number.parseInt(raw.slice(4, 6), 16),
  ];
}

/** sRGB 十六进制 → OKLCH（L 0..1，C 大概 0..0.4，H 0..360）。 */
function hexToOklch(hex: string): Oklch | null {
  const rgb = parseHexColor(hex);
  if (!rgb) return null;

  const [r, g, b] = rgb.map((channel) => channelToLinear(channel / 255));
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);

  const lightness = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const axisA = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const axisB = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;

  const hue = (Math.atan2(axisB, axisA) * 180) / Math.PI;

  return {
    l: lightness,
    c: Math.hypot(axisA, axisB),
    h: ((hue % 360) + 360) % 360,
  };
}

function oklchToHex({ l, c, h }: Oklch): string {
  const radians = (h * Math.PI) / 180;
  const axisA = c * Math.cos(radians);
  const axisB = c * Math.sin(radians);

  const l3 = (l + 0.3963377774 * axisA + 0.2158037573 * axisB) ** 3;
  const m3 = (l - 0.1055613458 * axisA - 0.0638541728 * axisB) ** 3;
  const s3 = (l - 0.0894841775 * axisA - 1.291485548 * axisB) ** 3;

  // 越界说明这个色不在 sRGB 里，按 CSS 的做法截断到 0..1
  const channels = [
    4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3,
    -1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3,
    -0.0041960863 * l3 - 0.7034186147 * m3 + 1.707614701 * s3,
  ];

  return `#${channels
    .map((channel) =>
      Math.round(Math.max(0, Math.min(1, linearToChannel(channel))) * 255)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

/**
 * {@link mixLearningColor} 的十六进制版本：同样在 OKLCH 里线性插值（短弧走色相），
 * 只是直接算出 `#rrggbb`，给 canvas / SVG 这类拿不到 CSS 变量的地方用。
 *
 * `from` 拿 t 的权重、`to` 拿 1 - t，和上面那个函数一致：t = 0 得到 `to`。
 */
export function mixLearningColorHex(
  t: number,
  from: string = LEARNING_COLOR_HEX.light.high,
  to: string = LEARNING_COLOR_HEX.light.low,
): string {
  const weight = Math.max(0, Math.min(1, t));
  const fromOklch = hexToOklch(from);
  const toOklch = hexToOklch(to);
  // 色值写错时不要抛，退回更重的那一端
  if (!fromOklch || !toOklch) return weight >= 0.5 ? from : to;

  // 色相走短弧，和 color-mix 的默认插值方式一致
  const hueDelta = ((fromOklch.h - toOklch.h + 540) % 360) - 180;

  return oklchToHex({
    l: toOklch.l + (fromOklch.l - toOklch.l) * weight,
    c: toOklch.c + (fromOklch.c - toOklch.c) * weight,
    h: (toOklch.h + hueDelta * weight + 360) % 360,
  });
}

/**
 * 学习色带上的 `count` 个十六进制色值，t 从 0（已掌握）到 1（还需努力）均匀取样。
 *
 * 用于给 identicon 之类"要一整排颜色、但只有真色值可用"的地方当调色板。
 */
export function getLearningColorPaletteHex(
  count: number = 16,
  scheme: LearningColorScheme = "light",
): string[] {
  const size = Math.max(1, Math.round(count));
  const { low, high } = LEARNING_COLOR_HEX[scheme];

  return Array.from({ length: size }, (_, index) =>
    mixLearningColorHex(size === 1 ? 0 : index / (size - 1), high, low),
  );
}

function toBoundedInteger(
  value: unknown,
  fallback: number,
  min: number,
): number {
  const numberValue = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numberValue)) return fallback;
  return Math.max(min, Math.round(numberValue));
}

export function getMaxLearningLevel(state: RuntimeState): number {
  return Math.max(
    toBoundedInteger(state.settings.correctStreakToMaster, 1, 1),
    toBoundedInteger(state.settings.correctStreakAfterMistake, 1, 1),
  );
}

export function getRemainingCorrectLevel(
  item: ActivePoolItem,
  state: RuntimeState,
): number {
  const maxLevel = getMaxLearningLevel(state);
  const requiredStreak = toBoundedInteger(
    getRequiredStreak(item, state),
    maxLevel,
    1,
  );
  const consecutiveCorrect = toBoundedInteger(item.consecutiveCorrect, 0, 0);
  return Math.min(maxLevel, Math.max(1, requiredStreak - consecutiveCorrect));
}

export function getLearningLevelColor(
  level: number,
  maxLevel: number,
  mistake: boolean = false,
): string {
  const normalizedMaxLevel = Math.max(
    0,
    Number.isFinite(maxLevel) ? Math.round(maxLevel) : 0,
  );
  const normalizedLevel = Math.min(
    normalizedMaxLevel,
    Math.max(0, Number.isFinite(level) ? Math.round(level) : 0),
  );
  const t =
    normalizedMaxLevel <= 0 ? 0.5 : normalizedLevel / normalizedMaxLevel;
  return mixLearningColor(
    t,
    undefined,
    mistake ? "var(--destructive)" : undefined,
  );
}

/**
 * 计算学习中进度条的颜色分段。
 *
 * 每道学习中的题目按"还需答对次数"（level = requiredStreak - consecutiveCorrect）
 * 归类，level 越小越接近掌握。按 level 升序排列，相同 level 合并成一段。
 *
 * 颜色规则：
 *   - maxLevel = 1：所有题目共享两端点中点色
 *   - maxLevel > 1：level 在 [1, maxLevel] 间用 OKLCH 线性插值
 */
export function computeLearningSegments(
  questions: Question[],
  state: RuntimeState,
): LearningSegment[] {
  const questionIds = new Set(questions.map((q) => q.id));
  const items = state.activePool.filter((item) => questionIds.has(item.id));

  if (items.length === 0) return [];

  const maxLevel = Math.max(1, getMaxLearningLevel(state));

  const counts = new Map<number, number>();
  for (const item of items) {
    const level = getRemainingCorrectLevel(item, state);
    counts.set(level, (counts.get(level) ?? 0) + 1);
  }

  const total = items.length;

  return Array.from({ length: maxLevel }, (_, index) => {
    const level = index + 1;
    return {
      level,
      color: getLearningLevelColor(level, maxLevel),
      widthPercent: ((counts.get(level) ?? 0) / total) * 100,
    };
  });
}
