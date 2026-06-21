import type { QuestionGroup } from "./types";
import {
  buildFlatItems,
  buildIdToRank,
  buildSectionLayouts,
  buildSections,
  findQuestionTop,
  type ResolveHeight,
} from "./layout";
import type { FlatItem, SectionLayout } from "./types";

const MAX_CONVERGE = 8;

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

/**
 * 虚拟滚动控制器：持有响应式滚动 / 高度状态，以及命令式跳转收敛逻辑。
 *
 * 布局数学走纯函数（./layout），这里只管 reactivity 与 DOM 操作。
 * 组件把 `grouped` 赋给实例即可触发 layouts 重算。
 */
export class VirtualScroll {
  grouped = $state<QuestionGroup[]>([]);
  listEl: HTMLDivElement | null = $state(null);
  scrollTop = $state(0);
  viewportHeight = $state(400);
  measuredHeights = $state<Record<string, number>>({});

  /** 持久化的真实高度：渲染过的题目高度缓存，切换筛选后仍可复用。 */
  actualHeights = $state<Record<string, number>>({});

  flatItems = $derived<FlatItem[]>(buildFlatItems(this.grouped));
  sections = $derived(buildSections(this.flatItems));

  /** 高度解析：真实测量值优先，回退到估算。供 layout 纯函数与跳转逻辑共用。 */
  resolveHeight: ResolveHeight = (id, fallback) =>
    this.actualHeights[id] ?? this.measuredHeights[id] ?? fallback;

  layouts = $derived<SectionLayout[]>(
    buildSectionLayouts(this.sections, this.resolveHeight),
  );
  idToRank = $derived(buildIdToRank(this.flatItems));

  constructor() {
    // 每当 measureHeight 更新了某 item，就写入 actualHeights 以备布局使用
    $effect(() => {
      for (const [id, h] of Object.entries(this.measuredHeights)) {
        this.actualHeights[id] = h;
      }
    });
  }

  /** Svelte Action：测量节点真实高度，跟随 ResizeObserver 持续更新。 */
  measureHeight(node: HTMLElement, id: string) {
    const update = () => {
      const h = node.offsetHeight;
      if (this.measuredHeights[id] !== h) {
        this.measuredHeights[id] = h;
      }
    };

    update();
    const ro = new ResizeObserver(update);
    ro.observe(node);

    return {
      destroy() {
        ro.disconnect();
      },
    };
  }

  private findMountedNode(id: string): HTMLElement | null {
    const nodes =
      this.listEl?.querySelectorAll<HTMLElement>(
        "[data-review-question-id]",
      ) ?? [];
    for (const node of nodes) {
      if (node.dataset.reviewQuestionId === id) return node;
    }
    return null;
  }

  private clampScroll(top: number): number {
    if (!this.listEl) return 0;
    const max = this.listEl.scrollHeight - this.listEl.clientHeight;
    return Math.max(0, Math.min(top, max));
  }

  /**
   * 当前挂载题目中最接近视口中心的那一个：
   * 返回其绝对 Y、序号、以及挂载题目的平均高度。
   */
  private centerAnchor(): { absY: number; rank: number; avgH: number } | null {
    if (!this.listEl) return null;
    const nodes = this.listEl.querySelectorAll<HTMLElement>(
      "[data-review-question-id]",
    );
    if (nodes.length === 0) return null;
    const containerTop = this.listEl.getBoundingClientRect().top;
    const currentScroll = this.listEl.scrollTop;
    const center = currentScroll + this.viewportHeight / 2;

    let bestAbsY = 0;
    let bestRank = -1;
    let bestDist = Infinity;
    let totalH = 0;
    for (const node of nodes) {
      const rect = node.getBoundingClientRect();
      const absY = rect.top - containerTop + currentScroll;
      totalH += rect.height;
      const dist = Math.abs(absY + rect.height / 2 - center);
      if (dist < bestDist) {
        bestDist = dist;
        bestAbsY = absY;
        bestRank =
          this.idToRank.get(node.dataset.reviewQuestionId ?? "") ?? -1;
      }
    }
    return { absY: bestAbsY, rank: bestRank, avgH: totalH / nodes.length };
  }

  /** 等目标被 ResizeObserver 测量、且 findQuestionTop 连续两帧不变后返回精准位置。 */
  private async waitForStableTop(
    id: string,
    isCurrent: () => boolean,
  ): Promise<number | null> {
    let lastTop: number | null = null;
    let stable = 0;
    for (let i = 0; i < 40; i++) {
      await nextFrame();
      if (!isCurrent()) return null;
      if (!this.findMountedNode(id) || this.actualHeights[id] == null) continue;
      const top = findQuestionTop(
        this.layouts,
        id,
        this.viewportHeight,
        this.resolveHeight,
      );
      if (top == null) continue;
      if (top === lastTop) {
        if (++stable >= 2) return top;
      } else {
        stable = 0;
        lastTop = top;
      }
    }
    return findQuestionTop(
      this.layouts,
      id,
      this.viewportHeight,
      this.resolveHeight,
    );
  }

  /** 跳转到指定题目：远距离先即时定位再平滑滑入，近距离直接平滑滚动。 */
  async performJump(id: string, isCurrent: () => boolean): Promise<void> {
    if (!this.listEl) return;
    const startScroll = this.listEl.scrollTop;

    // 已有真实高度 → 位置足够精准，整段平滑滚动，保留完整动画
    if (this.actualHeights[id] != null) {
      const top = findQuestionTop(
        this.layouts,
        id,
        this.viewportHeight,
        this.resolveHeight,
      );
      if (top != null && isCurrent()) {
        this.listEl?.scrollTo({ top: this.clampScroll(top), behavior: "smooth" });
      }
      return;
    }

    // Phase 1：目标未挂载 → 迭代即时滚动直到它进入渲染窗口
    if (!this.findMountedNode(id)) {
      let estimate = findQuestionTop(
        this.layouts,
        id,
        this.viewportHeight,
        this.resolveHeight,
      );
      if (estimate == null) return;
      for (let i = 0; i < MAX_CONVERGE; i++) {
        if (!isCurrent()) return;
        this.listEl?.scrollTo({ top: this.clampScroll(estimate), behavior: "instant" });
        await nextFrame();
        if (!isCurrent()) return;
        if (this.findMountedNode(id)) break;

        // 用真实挂载顺序修正估算：以视口中心题为锚，按序号差 × 真实平均高度平移
        const anchor = this.centerAnchor();
        const targetRank = this.idToRank.get(id);
        if (!anchor || anchor.rank < 0 || targetRank == null) break;
        const dRank = targetRank - anchor.rank;
        if (dRank === 0) break;
        estimate = anchor.absY + dRank * anchor.avgH - this.viewportHeight / 2;
      }
    }

    // Phase 2：等测量与布局稳定，拿到精准目标位置
    const targetTop = await this.waitForStableTop(id, isCurrent);
    if (targetTop == null || !isCurrent()) return;

    // 本来就近 → 直接平滑滚动（自然短动画）
    const glide = Math.max(240, Math.min(this.viewportHeight * 0.7, 560));
    if (Math.abs(targetTop - startScroll) < glide) {
      this.listEl?.scrollTo({ top: this.clampScroll(targetTop), behavior: "smooth" });
      return;
    }

    // Phase 3：远距离首次访问 → 从行进方向外 glide 处即时定位，再平滑滑入
    const goingDown = targetTop > startScroll;
    const launchTop = goingDown ? targetTop - glide : targetTop + glide;
    if (Math.abs((this.listEl?.scrollTop ?? 0) - targetTop) < glide) {
      this.listEl?.scrollTo({ top: this.clampScroll(launchTop), behavior: "instant" });
      await nextFrame();
    }
    this.listEl?.scrollTo({ top: this.clampScroll(targetTop), behavior: "smooth" });
  }
}
