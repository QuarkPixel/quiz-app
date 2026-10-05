/**
 * 路由器：把「当前题库 + 子模式」这件事从 URL 一路接到视图上。
 *
 * 三方各管一段，方向都是单向的（见 `route.ts` 头部那张路径表）：
 *
 *   URL ──(打开页面 / 前进后退)──► router.route ──► BankStore.setActiveBank
 *   侧边栏点题库 ──────────────► router.setActiveBank ──► URL
 *   会话进出学习 / 复习 ────────► router.setMode ──────► URL
 *
 * 刻意不引第三方路由库：这里只有「一段 hash + 一个词」两件事，`route.ts` 里
 * 那几个纯函数就够了；引一个库进来反而要跟它解释「题库不是组件」。
 */

import type { QuizSource } from "@/source/types";
import {
  formatRoute,
  parseRoute,
  resolveInitialRoute,
  routePathFromLocation,
  sameRoute,
  type Route,
  type RouteMode,
} from "./route";

/** 子模式 → 路径段（`home` 不带段，见 `formatRoute`）。 */
export type { Route, RouteMode };

/**
 * 写 URL 的方式。
 *
 * **题库之间的切换是 `push`**（历史里留一步，后退能回上一个题库——那是用户
 * 真的换了个地方）；**同一个题库里进出学习 / 复习是 `replace`**（不是两个地方，
 * 只是同一页换了个状态，否则后退键会在题库里绕圈）。
 */
export type NavigateKind = "push" | "replace";

/**
 * 壳。默认绑在真实的 `window` 上，测试可以塞一个假的进来。
 *
 * 注入项只有两类：去哪读（`source` / `mountPath` / `env`）和去哪写
 * （`env.history` / `env.location`），所以整套路由逻辑不需要 DOM 也能跑。
 */
export class Router {
  /** 当前题库 hash；`null` = 空题库状态 */
  activeBank: string | null = $state(null);
  /** 题库里的子模式 */
  mode: RouteMode = $state("home");

  private source: QuizSource | null = null;
  private mountPath = "/";
  /** 写 URL 时要加回去的挂载前缀（`/quiz/` → `/quiz`，根路径下是空串）。 */
  private mountPrefix = "";
  private env: RouterEnv | null = null;
  private detach: (() => void) | null = null;
  /** 启动过程中 `source.setActiveBank()` 会回emit，那一下不该走 `syncFromSource`。 */
  private ready = false;

  /** 当前路由（视图与 URL 都以它为准）。 */
  get route(): Route {
    return { bank: this.activeBank, mode: this.activeBank === null ? "home" : this.mode };
  }

  /**
   * 启动：把 URL 和本地记录对上一次，然后开始听前进 / 后退。
   *
   * 幂等，可重复调用（`stop()` 之后也能再起）。
   */
  start(source: QuizSource, options: { mountPath?: string; env?: RouterEnv } = {}): void {
    this.source = source;
    this.mountPath = options.mountPath ?? this.defaultMountPath();
    this.mountPrefix = this.mountPath.replace(/\/+$/, "");
    this.env = options.env ?? browserEnv();

    const storedActive = source.getActiveBank()?.hash ?? null;
    const banks = source.listBanks().map((bank) => bank.hash);
    const wanted = resolveInitialRoute({
      route: parseRoute(this.currentPath()),
      storedActive,
      banks,
    });

    this.activeBank = wanted.bank;
    this.mode = wanted.mode;
    this.write(wanted, { kind: this.bootstrapPath(banks), force: true });
    this.applyActiveBank(wanted.bank);
    this.ready = true;

    this.detach?.();
    const onPopState = (): void => this.applyLocation();
    this.env.window.addEventListener("popstate", onPopState);
    this.detach = () => this.env?.window.removeEventListener("popstate", onPopState);
  }

  /** 摘掉前进 / 后退的监听（测试用；应用里活到页面结束）。 */
  stop(): void {
    this.detach?.();
    this.detach = null;
  }

  /**
   * 外部把当前题库换掉了（侧边栏点了一下）。
   *
   * 与 URL 里写的那一个相同时**什么都不做**：`setActiveBank` 会让 `App.svelte`
   * 用 `{#key}` 重建会话，白重建一次就够把「答到一半」丢掉。
   */
  setActiveBank(hash: string | null): void {
    if (hash === this.activeBank) return;
    this.activeBank = hash;
    this.mode = "home";
    this.applyActiveBank(hash);
    this.write(this.route, { kind: "push" });
  }

  /** 进出记忆模式的子模式（同一题库内，走 `replace`）。 */
  setMode(mode: RouteMode): void {
    if (this.activeBank === null || mode === this.mode) return;
    this.mode = mode;
    this.write(this.route, { kind: "replace" });
  }

  /**
   * 题库仓库自己变了（导入 / 删除 / 云端同步写盘之后）。
   *
   * 只管一件事：**现在显示的那个题库还在不在**。还在就什么都不做——这里要是
   * 顺手把 URL 重写一遍，`#/abc` 与 `#/abc/learn` 之间的差异就会被自己抹平。
   */
  syncFromSource(): void {
    const source = this.source;
    if (source === null || !this.ready) return;
    const next = source.getActiveBank()?.hash ?? null;
    if (next === this.activeBank) return;
    this.activeBank = next;
    this.mode = "home";
    this.write(this.route, { kind: "replace" });
  }

  // ── 内部 ────────────────────────────────────────────────────────────────

  /** 用户按了后退 / 前进：URL 说了算，重新落一次。 */
  private applyLocation(): void {
    const wanted = this.resolve(parseRoute(this.currentPath()));
    const changed = !sameRoute(wanted, this.route);
    this.activeBank = wanted.bank;
    this.mode = wanted.mode;
    this.applyActiveBank(wanted.bank);
    // 地址栏里那段（比如 `/abc/typo`）跟解析结果对不上时，顺手写回规范形状；
    // 对得上就一个字都不写——`replaceState` 会打断浏览器自己的前进后退栈。
    if (changed || this.currentPath() !== formatRoute(wanted)) {
      this.write(wanted, { kind: "replace" });
    }
  }

  /** URL 里那个题库已经不在列表里时退回一个还能用的（见 `resolveInitialRoute`）。 */
  private resolve(route: Route): Route {
    const source = this.source;
    if (source === null) return route;
    return resolveInitialRoute({
      route,
      storedActive: source.getActiveBank()?.hash ?? null,
      banks: source.listBanks().map((bank) => bank.hash),
    });
  }

  /**
   * 把当前题库落到仓库里。
   *
   * 仓库已经是这个题库时**不写**：`setActiveBank` 会让 `App.svelte` 用 `{#key}`
   * 重建整个会话（答到一半的题跟着没了），而且盘上那份 general 会被无谓地改写。
   * 启动那一次也走这条判断——仓库的初始值本来就是从盘上读的，URL 指名了另一个
   * 题库时它才会真的写。
   */
  private applyActiveBank(hash: string | null): void {
    const source = this.source;
    if (source === null || hash === null) return;
    if (source.getActiveBank()?.hash === hash) return;
    source.setActiveBank(hash);
  }

  private currentPath(): string {
    const env = this.env ?? browserEnv();
    return routePathFromLocation(env.location, this.mountPath);
  }

  /**
   * 启动时该不该留一条历史记录。
   *
   * 「输入没有任何参数的网址 → 自动跳到 /<hash>」这一次跳转**不算用户走了一步**，
   * 所以只有当地址栏里本来就写着另一个题库（用户是冲着它来的）才 `pushState`；
   * 其余（空地址、旧题库、`/abc/typo`）都是 `replaceState`，免得用户按后退
   * 反而退进一个「立刻又被弹走」的地址。
   */
  private bootstrapPath(banks: readonly string[]): NavigateKind {
    const written = parseRoute(this.currentPath());
    return written.bank !== null && banks.includes(written.bank) ? "push" : "replace";
  }

  private write(
    route: Route,
    options: { kind?: NavigateKind; force?: boolean } = {},
  ): void {
    const env = this.env;
    if (env === null) return;
    const target = `${this.mountPrefix}${formatRoute(route)}${env.location.search}`;
    const current = `${env.location.pathname}${env.location.search}`;
    // 已经在这个地址上就什么都不做：写一次会平白多一条历史记录
    // （`force` 只有启动那一次用：地址栏本来就对时也要按规范形状写一遍）
    if (!options.force && current === target) return;
    if (options.kind === "push") env.history.pushState(null, "", target);
    else env.history.replaceState(null, "", target);
  }

  private defaultMountPath(): string {
    const base = import.meta.env?.BASE_URL;
    return typeof base === "string" && base.length > 0 ? base : "/";
  }
}

/** 路由要用的那几个浏览器对象（测试里换成假的）。 */
export interface RouterEnv {
  history: Pick<History, "pushState" | "replaceState">;
  location: { pathname: string; hash: string; search: string };
  window: Pick<Window, "addEventListener" | "removeEventListener">;
}

function browserEnv(): RouterEnv {
  return {
    history: window.history,
    location: window.location,
    window,
  };
}
