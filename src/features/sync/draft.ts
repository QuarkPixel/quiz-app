/**
 * 云同步面板里「令牌那一块」——一个显式状态机。
 *
 * 以前这块是六个互不相干的字段拼出来的：
 *
 *   `editing` / `draftToken` / `testState` / `gists` / `pickedId`
 *   （外加 `firstEdit`，见下）
 *
 * 其中 `testState` 与 `gists` 是一对平行字段：`testState === "ok"` 时 `gists`
 * 必然非空，`testState === null` 时必然为 null——这条不变式此前靠一个
 * `verified` 派生 getter 兜着，而不是靠类型。`pickedId` 更是只在「验过」之后
 * 才有意义，却常驻在组件里，随时能被别处的代码改。字段能拼出的组合远多于
 * 真实画面，而真实画面只有五种：
 *
 * ```
 *   idle      没在编辑 —— 已存令牌（打码）+ 展示页那个自检按钮
 *   editing   编辑中，还没验 —— 输入框 + 测试按钮，没有列表、不能保存
 *   testing   编辑中，正在验 —— 同上，按钮说「测试中…」
 *   verified  验过了 —— 列出账号里的片段，能选、能保存
 *   failed    验失败了 —— 按钮变红，原因交给全局提示
 * ```
 *
 * 收成一个判别联合之后：
 *   1. 「验过却没有列表」「有列表却不算验过」在类型上不存在；
 *   2. 选中的片段长在 `verified` 这一支上，「没验过却选了一条」不成立；
 *   3. 常规态那个自检结果（`probe`）也收进来——它和编辑态的自检原来共用
 *      同一个 `testState`，两处互相覆盖（退出编辑态会把展示页的绿勾一起清掉）。
 *
 * 三条约定：
 *   1. 转移函数全是纯函数，组件只负责把结果写回 `$state`；
 *   2. 请求在飞时**不锁**这台机器：结果回来时先比 `kind` 与 `text`，对不上
 *      就整份丢掉（用户改了令牌、退出了编辑态，这次结果就不算数）；
 *   3. `firstEdit` 不在这里——它恒等于「本地还没存过令牌」，是派生值，
 *      不该作为一个能和令牌打架的字段存在（见 `SyncSettings` 里的 `firstTime`）。
 */

import type { GistSummary } from "@/features/sync/gitee";
import { looksLikeSyncGist } from "@/features/sync/types";

/**
 * 「新建一条云端片段」那一行在列表里的值。
 *
 * 空字符串另有所指：`verified` 之外的态没有选中项，`testing` 的 `pick`
 * 用它表示「上一次没选过」。
 */
export const NEW_GIST = "__new__";

/** 常规态那个自检按钮的结果；`testing` 是请求在飞（按钮保持常态，只变灰）。 */
export type Probe = "idle" | "testing" | "ok" | "error";

/** 令牌那一块的整块状态。 */
export type TokenDraft =
  /** 没在编辑：屏上是已存令牌（打码）+ 展示页的自检按钮。 */
  | { kind: "idle"; probe: Probe }
  /** 编辑中，这份草稿还没验过（或者改了字，上一次的验证已经作废）。 */
  | { kind: "editing"; text: string }
  /**
   * 正在验这份草稿。
   *
   * `pick` 是重验前选中的那条：结果回来要是它还在列表里，就接着选它，
   * 别让列表一刷新就把用户的选择顶掉。
   */
  | { kind: "testing"; text: string; pick: string }
  /**
   * 验过了：令牌有效，账号里的片段也拿到了。
   *
   * `gists` 允许为空——新账号一条片段都没有时，列表里只剩「新建」那一行。
   * 这里要保证的是「验过就一定有列表」，不是「列表一定非空」：删掉最后一条
   * 片段是合法操作，写成非空元组会逼着它退回 `editing`（保存跟着变灰）。
   */
  | {
      kind: "verified";
      text: string;
      gists: readonly GistSummary[];
      pickedId: string;
    }
  /** 验失败了：草稿留着让用户改，`reason` 由调用方拿去弹提示。 */
  | { kind: "failed"; text: string; reason: string };

/** 常规态、也还没测过：面板一进来就是这个。 */
export const IDLE_DRAFT: TokenDraft = { kind: "idle", probe: "idle" };

// ── 读 ────────────────────────────────────────────────────────────────────

/** 输入框里的草稿（常规态没有草稿）。 */
export function draftText(draft: TokenDraft): string {
  return draft.kind === "idle" ? "" : draft.text;
}

/** 正在验令牌：编辑态那次，或者常规态那次。 */
export function isTesting(draft: TokenDraft): boolean {
  return (
    draft.kind === "testing" ||
    (draft.kind === "idle" && draft.probe === "testing")
  );
}

/**
 * 编辑态「测试连接」按钮上的 `data-state`。
 *
 * 只有 `verified` / `failed` 会变色——`testing` 保持常态（按钮文字自己会说
 * 「测试中…」），这样「有没有结果」只由 `idle` 与否回答。
 */
export function draftState(draft: TokenDraft): "idle" | "ok" | "error" {
  if (draft.kind === "verified") return "ok";
  if (draft.kind === "failed") return "error";
  return "idle";
}

/** 常规态那个按钮上的 `data-state`；`testing` 不外露（请求在飞时保持常态）。 */
export function savedState(draft: TokenDraft): "idle" | "ok" | "error" {
  if (draft.kind !== "idle" || draft.probe === "testing") return "idle";
  return draft.probe;
}

// ── 转移：编辑态进出 ──────────────────────────────────────────────────────

/**
 * 打开面板 / 打开总开关时该在哪个态。
 *
 * **没有已存令牌就直接进编辑态**：首次配置的用户下一步只能填令牌，让他再点
 * 一次铅笔是多余的。
 */
export function initialDraft(token: string): TokenDraft {
  return token.length > 0 ? IDLE_DRAFT : { kind: "editing", text: "" };
}

/** 进编辑态：草稿从已存令牌起（首次配置时是空串），上一次的自检一律作废。 */
export function beginEditing(token: string): TokenDraft {
  return { kind: "editing", text: token };
}

/**
 * 改草稿。
 *
 * 动一个字，上一次的验证与列表就都不算数了——「验过」说的是**这一串字符**
 * 能通，不是「这个输入框验过一次」。
 */
export function editText(text: string): TokenDraft {
  return { kind: "editing", text };
}

// ── 转移：常规态的自检（验的是已存的配置）───────────────────────────────

/** 点「测试连接」（常规态）。编辑态调不动它。 */
export function beginProbe(draft: TokenDraft): TokenDraft {
  return draft.kind === "idle" ? { kind: "idle", probe: "testing" } : draft;
}

/** 常规态自检的结果落地。中途进了编辑态（`kind` 变了）就整份丢掉。 */
export function settleProbe(draft: TokenDraft, ok: boolean): TokenDraft {
  return draft.kind === "idle"
    ? { kind: "idle", probe: ok ? "ok" : "error" }
    : draft;
}

/**
 * 同步成功：常规态那个结果说的是「上一次点测试时的配置」，已经过期了。
 *
 * 编辑态那份草稿不动——它验的是另一个令牌，与这次同步无关；顺手清掉的话，
 * 用户正在填的配置会在一次后台同步之后突然不能保存。
 */
export function clearProbe(draft: TokenDraft): TokenDraft {
  return draft.kind === "idle" ? IDLE_DRAFT : draft;
}

// ── 转移：编辑态的验证（验的是草稿）─────────────────────────────────────

/** 开始验这份草稿。已经在验、或者没有草稿（`idle`）时是空操作。 */
export function beginTest(draft: TokenDraft): TokenDraft {
  switch (draft.kind) {
    case "editing":
    case "failed":
      return { kind: "testing", text: draft.text, pick: "" };
    case "verified":
      return { kind: "testing", text: draft.text, pick: draft.pickedId };
    default:
      return draft;
  }
}

/**
 * 验通了：令牌有效 + 列表到手，合成 `verified`。
 *
 * 默认选中：重验前选的那条 > 当前正在用的那条 > 最近更新的一条 > 新建。
 */
export function settleTest(
  draft: TokenDraft,
  gists: readonly GistSummary[],
  savedGistId: string,
): TokenDraft {
  if (draft.kind !== "testing") return draft;
  return {
    kind: "verified",
    text: draft.text,
    gists,
    pickedId: defaultPick(gists, draft.pick, savedGistId),
  };
}

/** 验失败了：草稿留着（用户改一个字符再试），原因交给调用方去弹提示。 */
export function failTest(draft: TokenDraft, reason: string): TokenDraft {
  if (draft.kind !== "testing") return draft;
  return { kind: "failed", text: draft.text, reason };
}

function defaultPick(
  gists: readonly GistSummary[],
  keep: string,
  savedGistId: string,
): string {
  const ids = new Set(gists.map((gist) => gist.id));
  if (keep !== "" && ids.has(keep)) return keep;
  if (ids.has(savedGistId)) return savedGistId;
  return gists.find((gist) => looksLikeSyncGist(gist))?.id ?? NEW_GIST;
}

// ── 转移：选 / 删片段 ─────────────────────────────────────────────────────

/** 选中列表里的一条（`NEW_GIST` = 新建）。没验过时是空操作。 */
export function pickGist(draft: TokenDraft, id: string): TokenDraft {
  return draft.kind === "verified" ? { ...draft, pickedId: id } : draft;
}

/** 云端删掉一条之后同步列表；删掉的正好是选中的那条就退回「新建」。 */
export function dropGist(draft: TokenDraft, id: string): TokenDraft {
  if (draft.kind !== "verified") return draft;
  return {
    ...draft,
    gists: draft.gists.filter((gist) => gist.id !== id),
    pickedId: draft.pickedId === id ? NEW_GIST : draft.pickedId,
  };
}
