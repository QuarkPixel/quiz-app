/**
 * 云同步的全局调参。
 *
 * **只放「调参」**：间隔、防抖、节流这类可以拍脑袋改、改了也不影响正确性的值。
 * 同步的**协议细节**（Gist 文件名、分片数、payload 版本）留在
 * `@/features/sync/types.ts`——它们和实现绑得太紧，搬过来只会让人两头找。
 */

/**
 * 本地改动后，等这么久没有新改动就自动上传（毫秒）。
 *
 * 是**防抖**不是节流：连续答题时定时器会一直被推后，所以真正兜底的是
 * `SYNC_POLL_INTERVAL_MS`（3 分钟）与切回页面时那次检查。
 * 20 秒是刻意的：做题时每次保存进度都写 localStorage，2 秒一传太吵。
 */
export const SYNC_PUSH_DEBOUNCE_MS = 20_000;

/** 空闲时轮询云端的间隔（毫秒）。 */
export const SYNC_POLL_INTERVAL_MS = 3 * 60 * 1000;

/**
 * `localStorage` 钩子不生效时的兜底检查间隔（毫秒）。
 *
 * 正常情况下用不着：写入会直接通知引擎「本地脏了」。这条只在探针发现
 * 「写得进去但钩子不通知」时启用（iOS 上踩过），代价是定期比一遍内容哈希。
 */
export const SYNC_LOCAL_POLL_MS = 5000;

/** 窗口重新获得焦点时，两次检查之间至少间隔这么久（毫秒）。 */
export const SYNC_FOCUS_THROTTLE_MS = 30 * 1000;

/**
 * 「测试连接」成功后，绿勾在展示页停留多久（毫秒）。
 * 编辑态不受它影响（那边一直留着，直到改令牌 / 保存 / 取消）。
 */
export const SYNC_VERIFIED_FLASH_MS = 2000;
