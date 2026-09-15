/**
 * 「这一轮同步干了什么」的文案。
 *
 * 只有上传 / 下载是说不清楚的：删题库、导新题库、单纯改设置或拖一下顺序，
 * 计数都会是 `0 · 0`，看起来像什么都没发生。所以这里按四件事分别数：
 *
 *   - 新增：某一侧新出现的题库，同步到了另一侧
 *   - 删除：某一侧删掉的题库，同步到了另一侧
 *   - 上传 / 下载：**已有**题库的内容改动，两个方向各算各的
 *   - 设置：`_general.json`（题库列表与顺序、当前题库、全局 / 默认设置）也动了
 *
 * 前四项是**互斥**的：新题库只算「新增」，不算「上传」——否则同一个题库会被数两遍。
 */

/** 计数这一层只认这些字段；`SyncOutcome` 满足这个形状。 */
export interface SyncTransferSummary {
  /** 推向云端的题库数（**含**云端新增的） */
  pushed: number;
  /** 从云端拉下来的题库数（**含**本地新增的） */
  pulled: number;
  /** 云端原来没有、这次推上去的题库数（已含在 `pushed` 里） */
  newOnCloud: number;
  /** 本地原来没有、这次拉下来的题库数（已含在 `pulled` 里） */
  newLocally: number;
  /** 任一侧删掉、传播到另一侧的题库数 */
  removed: number;
  /** `_general.json` 也变了（改设置 / 改题库名 / 调顺序这类，与题库增删无关） */
  settingsChanged: boolean;
}

/**
 * 一句话说清这一轮同步动了什么，只列**真的发生了**的那几项。
 *
 * 四件题库的事都没发生就说「题库没有改动」——但设置如果动了，仍然要提，
 * 否则「拖了一下顺序」同步完看起来像没同步。
 */
export function describeSyncResult(outcome: SyncTransferSummary): string {
  const parts: string[] = [];

  const added = outcome.newOnCloud + outcome.newLocally;
  // 新增已经从 pushed / pulled 里扣掉了，剩下的才是「改内容」那种上传 / 下载
  const uploaded = outcome.pushed - outcome.newOnCloud;
  const downloaded = outcome.pulled - outcome.newLocally;

  if (added > 0) parts.push(`新增 ${added}`);
  if (outcome.removed > 0) parts.push(`删除 ${outcome.removed}`);
  if (uploaded > 0) parts.push(`上传 ${uploaded}`);
  if (downloaded > 0) parts.push(`下载 ${downloaded}`);
  if (parts.length === 0) parts.push("题库没有改动");
  if (outcome.settingsChanged) parts.push("设置已更新");

  return parts.join(" · ");
}
