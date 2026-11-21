/**
 * 音效偏好默认值（全局设置的一部分）。
 *
 * 默认关着：这是一个以阅读 / 答题为主的产品，声音是可选增强，不该在用户
 * 第一次打开时自作主张地响。音量是 0–1 的线性增益，默认 0.7——所有音效
 * 都经同一个主音量，单个事件不再各自调音量。
 */
export const SOUND_ENABLED_BY_DEFAULT = false;
export const SOUND_VOLUME_DEFAULT = 0.7;

/** 音量滑块的取值范围与步长（设置面板与净化共用）。 */
export const SOUND_VOLUME_MIN = 0;
export const SOUND_VOLUME_MAX = 1;
export const SOUND_VOLUME_STEP = 0.05;
