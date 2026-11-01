/**
 * 侧边栏「导入题库」的界面状态机。
 *
 * 以前这一块是四个互不相干的字段拼出来的：
 *
 *   `isImporting`（布尔）/ `importSession` / `overwriteRequest` / `importMessage`
 *
 * 四个字段能拼出十几种组合，而真实存在的画面只有四个：
 *
 * ```
 *   idle     什么都没发生
 *   reading  文件正在读，屏上还没有任何反馈
 *   asking   读到一个「题库已存在、备份里带进度」的文件，停下来问要不要覆盖
 *   report   这一轮结束了（或导出失败），摊一张汇总对话框
 * ```
 *
 * 拼不出来的那些组合此前全靠 `showImportPrompt` 里那两句
 * `importMessage = null` / `overwriteRequest = null` 手动互斥——「会话已经没了、
 * 询问还挂着」「汇总和覆盖询问同时存在」在类型上一直是合法的。现在收进一个
 * 判别联合：`asking` 自带它要问的那张 request，`report` 自带那张 message，
 * 互斥不再需要谁记得去清另一个字段。
 *
 * 三条约定：
 *   1. 转移函数全是纯函数，组件只负责把结果写回 `$state`；
 *   2. `promptState` 是唯一入口——会话每算出一张新提示，都只能经过它落进状态，
 *      走到哪一支由提示自己的 `kind` 决定，不由调用方决定；
 *   3. 汇总一出来，会话就再也不会问出新东西（`promptOf` 在 `done` 上只会再给
 *      一次同样的汇总），所以 `report` 不带 session。
 */

import type {
  BankFileMessage,
  BankImportPrompt,
  BankImportSession,
  OverwriteImportRequest,
} from "@/features/bankFiles";

export type ImportUiState =
  /** 空闲：没有导入在进行。 */
  | { kind: "idle" }
  /** 文件正在读（`BankImportSession.create` 还没回来），屏上没有任何反馈。 */
  | { kind: "reading" }
  /**
   * 停在覆盖询问上：这一份文件带的进度要不要替换当前进度。
   *
   * `busy` 是「用户已经答了、写盘还没回来」。它没有单独成 `reading`，是因为
   * 覆盖对话框必须一直挂在屏上：它的 `open` 一旦变 false，关闭回调会把这次
   * 关闭当成「保留当前进度」，等于替用户又答了一遍。所以「答了」只能记在
   * `asking` 内部，用它挡重复提交，不改变对话框的去留。
   */
  | {
      kind: "asking";
      session: BankImportSession;
      request: OverwriteImportRequest;
      busy: boolean;
    }
  /** 这一轮结束了：摊一张汇总（或导出失败 / 警告）的对话框。 */
  | { kind: "report"; message: BankFileMessage };

/** 空闲。每次给新对象，免得两处共用同一份被谁改掉。 */
export function importIdle(): ImportUiState {
  return { kind: "idle" };
}

/** 开始读文件。 */
export function importReading(): ImportUiState {
  return { kind: "reading" };
}

/**
 * 不走导入、直接摊一张提示（导出失败 / 导出告警走这条）。
 *
 * 它和「导入汇总」落在同一支上：对用户是同一张对话框，区别只在文案。
 */
export function importReport(message: BankFileMessage): ImportUiState {
  return { kind: "report", message };
}

/**
 * 把会话刚算出来的提示落进状态——这就是原来 `showImportPrompt` 的全部职责。
 *
 * 两个分支各自只写自己那一支的字段，所以「既在问覆盖、又有汇总」这种组合
 * 连构造的机会都没有。
 */
export function promptState(
  session: BankImportSession,
  prompt: BankImportPrompt,
): ImportUiState {
  return prompt.kind === "overwrite"
    ? { kind: "asking", session, request: prompt.request, busy: false }
    : { kind: "report", message: prompt.message };
}

/** 用户答了覆盖询问，写盘还没回来。 */
export function startAnswering(state: ImportUiState): ImportUiState {
  if (state.kind !== "asking") return state;
  return { ...state, busy: true };
}

/**
 * 写盘收尾：成功时状态已经被换掉了，这里什么都不做；抛错时把 `busy` 放回去，
 * 对话框还开着，用户可以重答一次。
 */
export function stopAnswering(state: ImportUiState): ImportUiState {
  if (state.kind !== "asking" || !state.busy) return state;
  return { ...state, busy: false };
}

/**
 * 这一轮导入还没收尾（`reading` / `asking`）。
 *
 * 菜单里的导入项靠它禁用——半路开第二个会话会把第一个的会话对象冲掉；
 * 拖拽提示也靠它压着，读文件读到一半再叠一层「松开以导入」没有意义。
 * `report` 不算在内：对话框一关就该能再导一次。
 */
export function isImportInFlight(state: ImportUiState): boolean {
  return state.kind === "reading" || state.kind === "asking";
}

/** 此刻该问的那张覆盖请求；没在问就是 `null`。 */
export function overwriteRequestOf(
  state: ImportUiState,
): OverwriteImportRequest | null {
  return state.kind === "asking" ? state.request : null;
}

/** 此刻该摊的那张提示；没有就是 `null`。 */
export function reportMessageOf(state: ImportUiState): BankFileMessage | null {
  return state.kind === "report" ? state.message : null;
}
