/**
 * 时间显示：相对时间（「上次同步：20 秒前」）与绝对时间（悬停看的那种）。
 */

import { describe, expect, test } from "vitest";

import {
  formatAbsoluteTime,
  formatRelativeTime,
  formatShortDate,
} from "$lib/time";

const NOW = Date.parse("2026-09-15T10:41:00");
const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe("相对时间", () => {
  test("刚同步完说「刚刚」", () => {
    expect(formatRelativeTime(NOW, NOW)).toBe("刚刚");
    expect(formatRelativeTime(NOW - 1 * SECOND, NOW)).toBe("刚刚");
  });

  test("一分钟以内按秒", () => {
    expect(formatRelativeTime(NOW - 5 * SECOND, NOW)).toBe("5 秒前");
    expect(formatRelativeTime(NOW - 20 * SECOND, NOW)).toBe("20 秒前");
    expect(formatRelativeTime(NOW - 59 * SECOND, NOW)).toBe("59 秒前");
  });

  test("一小时以内按分钟", () => {
    expect(formatRelativeTime(NOW - MINUTE, NOW)).toBe("1 分钟前");
    expect(formatRelativeTime(NOW - 3 * MINUTE, NOW)).toBe("3 分钟前");
    expect(formatRelativeTime(NOW - (59 * MINUTE + 59 * SECOND), NOW)).toBe(
      "59 分钟前",
    );
  });

  test("一天以内按小时", () => {
    expect(formatRelativeTime(NOW - HOUR, NOW)).toBe("1 小时前");
    expect(formatRelativeTime(NOW - 23 * HOUR, NOW)).toBe("23 小时前");
  });

  test("一个月以内按天，再久就退回日期（「45 天前」没人算得清）", () => {
    expect(formatRelativeTime(NOW - DAY, NOW)).toBe("1 天前");
    expect(formatRelativeTime(NOW - 29 * DAY, NOW)).toBe("29 天前");
    expect(formatRelativeTime(NOW - 45 * DAY, NOW)).toBe("08/01");
  });

  test("时钟回拨（时间戳在未来）也说「刚刚」，不显示负数", () => {
    expect(formatRelativeTime(NOW + 5 * SECOND, NOW)).toBe("刚刚");
  });

  test("从没同步过（0）返回空串，由调用方决定说什么", () => {
    expect(formatRelativeTime(0, NOW)).toBe("");
  });
});

describe("绝对时间", () => {
  test("完整到分钟，给 title 用", () => {
    expect(formatAbsoluteTime(Date.parse("2026-09-15T10:41:32"))).toBe(
      "2026/09/15 10:41",
    );
  });

  test("0 返回空串", () => {
    expect(formatAbsoluteTime(0)).toBe("");
  });

  test("简短日期补零", () => {
    expect(formatShortDate(Date.parse("2026-01-05T09:00:00"))).toBe("01/05");
    expect(formatShortDate(0)).toBe("");
  });
});
