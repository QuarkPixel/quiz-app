/**
 * 设置面板里的三类交互音。
 *
 * 只在设置项上调用：开关、单选 / 分段选择、数值档位。
 * **不要**拿它给普通按钮配音——按钮有自己的结果音（复制、删除、成功 / 失败），
 * 两套混在一起就会出现「点一下响两声」。
 */

import { appSound } from "./app";

/** switch：按**结果状态**选开 / 关，不去猜用户点了哪边。 */
export function playSettingToggle(next: boolean): void {
  appSound.play(next ? "setting-toggle-on" : "setting-toggle-off");
}

/** 单选 / 分段选择（学习顺序、题型筛选、云端片段…）。 */
export function playSettingChoice(): void {
  appSound.play("setting-choice");
}

/**
 * 数值滑杆 / 数字输入落定一档（掌握阈值、池大小、连对次数）。
 *
 * `step` 是**相对值域下限的档位**（0, 1, 2…）。传了它就按半音上行变调：
 * 掌握阈值 3→10 会从原音高一路升到高五度，每档一个音，越高越亮。不传就是
 * 原音高（池大小 / 连对次数这种跨度大的数字，变调只会变成随机噪声）。
 */
export function playSettingStep(step?: number): void {
  if (step === undefined) {
    appSound.play("setting-step");
    return;
  }
  const semitones = Math.max(0, Math.min(12, Math.round(step)));
  appSound.play("setting-step", {
    playbackRate: 2 ** (semitones / 12),
  });
}
