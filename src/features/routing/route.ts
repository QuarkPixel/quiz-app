/**
 * URL ↔ 应用状态的**纯函数**部分（不碰 `window`，见 `router.svelte.ts` 里的壳）。
 *
 * ── 路径长什么样 ────────────────────────────────────────────────────────────
 *
 *   /                       还没选题库
 *   /<题库 hash>            题库首页（记忆模式的首页 / 刷题模式的答题区）
 *   /<题库 hash>/learn      记忆模式：学习新的题目
 *   /<题库 hash>/review     记忆模式：复习
 *
 * 题库 hash 本身就是 URL 里那一段（16 位十六进制，见 `lib/hash.ts`），
 * 所以「题库 + 子模式」两段就够了，不需要再编一层 id。
 *
 * ── 为什么要有它 ────────────────────────────────────────────────────────────
 *
 * 以前「当前题库」只活在 `quiz_app_general.activeBank` 里，URL 永远是根路径：
 * 刷新回来只能落在题库首页，记忆模式学到一半的会话（学到哪一题、这一轮复习到
 * 几道）全部退回首页；也没法把某个题库的地址发给别人 / 存成书签。
 */

/** 子模式：`home` = 题库首页（记忆模式的首页 / 刷题模式的答题区）。 */
export type RouteMode = "home" | "learn" | "review";

/** 一条路由：哪个题库、在它里面的哪一层。 */
export interface Route {
  /** 题库 hash；`null` = 还没选题库（空题库状态） */
  bank: string | null;
  /** 子模式；没有题库时恒为 `home` */
  mode: RouteMode;
}

export const HOME_ROUTE: Route = { bank: null, mode: "home" };

/**
 * `/<hash>/<mode>` 里的第二段：只有这两个词是子模式，别的都不认。
 *
 * 认不出来的段**忽略而不是报错**：老版本没有子路径，用户手上可能有别的写法，
 * 落到题库首页比落到「找不到」好。
 */
const MODE_SEGMENTS: Record<string, RouteMode> = {
  learn: "learn",
  review: "review",
};

/** 题库 hash 的形状：`hashQuestionsJson` = SHA-1 hex 前 16 位（小写）。 */
const BANK_HASH_PATTERN = /^[0-9a-f]{16}$/;

/** 去掉结尾的 `/`，只留正规化的路径；空串表示根。 */
function normalizePath(path: string): string {
  const trimmed = path.replace(/\/+$/, "");
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

/**
 * 把URL 里那段「应用自己的路径」取出来。
 *
 * 两种写法都认：
 *   - 路径式：`/abc123/learn`（`history.pushState` 写的，也是唯一会写出去的形状）
 *   - hash 式：`#/abc123/learn`（托管环境不给 SPA 回退时的退路，或别人手写的地址）
 *
 * `base` 是应用的挂载前缀（`import.meta.env.BASE_URL`）；部署在子路径下时
 * `/quiz/abc123` 要把 `/quiz` 摘掉才认得出来。
 */
export function routePathFromLocation(
  location: { pathname: string; hash: string },
  base = "/",
): string {
  const prefix = base.endsWith("/") ? base.slice(0, -1) : base;

  const fromPath = stripPrefix(location.pathname, prefix);
  if (parseRoute(fromPath).bank !== null) return fromPath;

  // 路径里没认出来（部署在子路径、或托管方直接把未知路径吐成 404）→ 看 hash 那一段
  const fragment = location.hash.startsWith("#") ? location.hash.slice(1) : location.hash;
  if (!fragment.startsWith("/")) return fromPath;
  return stripPrefix(fragment, prefix);
}

function stripPrefix(path: string, prefix: string): string {
  if (prefix === "" || prefix === "/") return normalizePath(path);
  if (path === prefix) return "/";
  return path.startsWith(`${prefix}/`) ? path.slice(prefix.length) : path;
}

/** 解析一段路径。认不出来的部分忽略（见 `MODE_SEGMENTS` 的说明）。 */
export function parseRoute(path: string): Route {
  const segments = normalizePath(path)
    .split("/")
    .filter((segment) => segment.length > 0);

  const [hash = "", mode = ""] = segments;
  if (!BANK_HASH_PATTERN.test(hash)) return HOME_ROUTE;
  return { bank: hash, mode: MODE_SEGMENTS[mode] ?? "home" };
}

/** 生成路径。`home` 模式不带第二段（`/abc123` 比 `/abc123/home` 干净）。 */
export function formatRoute(route: Route): string {
  if (route.bank === null) return "/";
  return route.mode === "home" ? `/${route.bank}` : `/${route.bank}/${route.mode}`;
}

/** 一条路由是不是「这一条」（`bank` + `mode` 都要一样）。 */
export function sameRoute(a: Route, b: Route): boolean {
  return a.bank === b.bank && a.mode === b.mode;
}

/**
 * 打开页面时该落在哪条路由上。
 *
 * 用户拍板的规则（原话：「当用户输入没有任何参数的网址时，就从本地存储读取，
 * 并自动跳转到对应的子路径」）：
 *
 *   URL 里的题库还在          → 听 URL 的，子模式也照旧
 *   URL 里的题库不在了 / 没写 → 退回本地记着的 `activeBank`（也就是现在的行为）
 *   本地记着的也不在了        → 退到题库列表第一个
 *   一个题库都没有            → 根路径，空题库首页
 *
 * 子模式跟着题库一起退：题库都换了一个，`/learn` 这种子路径没有意义。
 */
export function resolveInitialRoute(params: {
  /** URL 上写着的路由 */
  route: Route;
  /** 磁盘上记着的当前题库（`general.activeBank`） */
  storedActive: string | null;
  /** 现在有哪些题库 */
  banks: readonly string[];
}): Route {
  const { route, storedActive, banks } = params;
  if (route.bank !== null && banks.includes(route.bank)) return route;

  const fallback = storedActive !== null && banks.includes(storedActive)
    ? storedActive
    : (banks[0] ?? null);
  return { bank: fallback, mode: "home" };
}
