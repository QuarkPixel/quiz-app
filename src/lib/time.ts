/**
 * 时间显示。
 *
 * 「上次同步」这类地方要的是**相对时间**（「20 秒前」）：绝对时间戳每次都得让人
 * 心算一下，而且放一会儿就过期了。相对时间由调用方把 `now` 传进来——它跟着页面的
 * 心跳走，显示才是实时的（见 `SyncSettings.svelte` 里那个每秒一次的 tick）。
 */

const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** 一个月以上就不再数天数了，直接给日期。 */
const RELATIVE_LIMIT_DAYS = 30;

function pad(value: number): string {
    return String(value).padStart(2, "0");
}

/** 绝对时间：`2026/09/15 11:29`——鼠标悬停时看的那种。 */
export function formatAbsoluteTime(at: number): string {
    if (!at) return "";
    const date = new Date(at);
    return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(
        date.getDate(),
    )} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** 简短日期：`09/15`。 */
export function formatShortDate(at: number): string {
    if (!at) return "";
    const date = new Date(at);
    return `${pad(date.getMonth() + 1)}/${pad(date.getDate())}`;
}

/**
 * 相对时间：`刚刚` / `20 秒前` / `3 分钟前` / `2 小时前` / `5 天前`。
 *
 * 超过一个月就退回具体日期（「45 天前」没人算得清是哪天）。
 * `at` 为 0（从没同步过）时返回空串，由调用方决定说什么。
 */
export function formatRelativeTime(at: number, now: number): string {
    if (!at) return "";

    // 时钟回拨 / 未来时间都按「刚刚」处理，别显示「-3 秒前」
    const seconds = Math.max(0, Math.floor((now - at) / 1000));
    if (seconds < 2) return "刚刚";
    if (seconds < MINUTE) return `${seconds} 秒前`;

    const minutes = Math.floor(seconds / MINUTE);
    if (minutes < 60) return `${minutes} 分钟前`;

    const hours = Math.floor(seconds / HOUR);
    if (hours < 24) return `${hours} 小时前`;

    const days = Math.floor(seconds / DAY);
    if (days < RELATIVE_LIMIT_DAYS) return `${days} 天前`;

    return formatShortDate(at);
}
