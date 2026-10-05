/**
 * 路由的纯函数部分：路径怎么解析、怎么生成、打开页面时该落在哪。
 *
 * 这一层没有 DOM，所以「题库不存在怎么办」「子路径认不出来怎么办」这些判断
 * 可以逐条钉死；`router.svelte.ts` 那一层只负责把它接到 `window` 和仓库上。
 */

import { describe, expect, it } from "vitest";

import {
  HOME_ROUTE,
  formatRoute,
  parseRoute,
  resolveInitialRoute,
  routePathFromLocation,
  sameRoute,
} from "@/features/routing/route";

const HASH_A = "aaaabbbbccccdddd";
const HASH_B = "eeeeffff00001111";

describe("解析路径", () => {
  it("根路径 = 还没选题库", () => {
    expect(parseRoute("/")).toEqual(HOME_ROUTE);
    expect(parseRoute("")).toEqual(HOME_ROUTE);
    expect(parseRoute("///")).toEqual(HOME_ROUTE);
  });

  it("一个 hash = 题库首页", () => {
    expect(parseRoute(`/${HASH_A}`)).toEqual({ bank: HASH_A, mode: "home" });
    // 结尾多写一个斜杠照样认
    expect(parseRoute(`/${HASH_A}/`)).toEqual({ bank: HASH_A, mode: "home" });
  });

  it("第二个词是记忆模式的子模式", () => {
    expect(parseRoute(`/${HASH_A}/learn`)).toEqual({ bank: HASH_A, mode: "learn" });
    expect(parseRoute(`/${HASH_A}/review`)).toEqual({ bank: HASH_A, mode: "review" });
  });

  it("认不出来的段按首页处理，不报错", () => {
    // 老版本没有子路径，别人手上可能有各种写法：落到题库首页比落到「找不到」好
    expect(parseRoute(`/${HASH_A}/typo`)).toEqual({ bank: HASH_A, mode: "home" });
    expect(parseRoute(`/${HASH_A}/learn/extra`)).toEqual({
      bank: HASH_A,
      mode: "learn",
    });
    expect(parseRoute("/not-a-hash")).toEqual(HOME_ROUTE);
    expect(parseRoute("/equiz")).toEqual(HOME_ROUTE);
  });
});

describe("生成路径", () => {
  it("首页不带第二段", () => {
    expect(formatRoute({ bank: HASH_A, mode: "home" })).toBe(`/${HASH_A}`);
    expect(formatRoute({ bank: HASH_A, mode: "learn" })).toBe(`/${HASH_A}/learn`);
    expect(formatRoute({ bank: HASH_A, mode: "review" })).toBe(`/${HASH_A}/review`);
    expect(formatRoute(HOME_ROUTE)).toBe("/");
  });

  it("生成再解析回到同一条路由", () => {
    for (const mode of ["home", "learn", "review"] as const) {
      expect(parseRoute(formatRoute({ bank: HASH_A, mode }))).toEqual({
        bank: HASH_A,
        mode,
      });
    }
  });
});

describe("从浏览器地址里取出应用路径", () => {
  it("路径式（我们自己写出去的那种）", () => {
    expect(
      routePathFromLocation({ pathname: `/${HASH_A}/learn`, hash: "" }),
    ).toBe(`/${HASH_A}/learn`);
  });

  it("hash 式也认（托管环境不给 SPA 回退时的退路）", () => {
    // 路径是服务器的 404 页 / 根路径，真正的路由写在 # 后面
    expect(
      routePathFromLocation({ pathname: "/", hash: `#/${HASH_A}/review` }),
    ).toBe(`/${HASH_A}/review`);
  });

  it("普通的锚点不当路由", () => {
    expect(routePathFromLocation({ pathname: "/", hash: "#top" })).toBe("/");
  });

  it("部署在子路径下时先摘掉挂载前缀", () => {
    expect(
      routePathFromLocation(
        { pathname: `/quiz/${HASH_A}`, hash: "" },
        "/quiz/",
      ),
    ).toBe(`/${HASH_A}`);
    // 前缀本身不算一个题库
    expect(routePathFromLocation({ pathname: "/quiz", hash: "" }, "/quiz/")).toBe("/");
  });
});

describe("打开页面时落在哪条路由", () => {
  const banks = [HASH_A, HASH_B];

  it("URL 里指名了题库：听 URL 的，子模式也照旧", () => {
    expect(
      resolveInitialRoute({
        route: { bank: HASH_B, mode: "review" },
        storedActive: HASH_A,
        banks,
      }),
    ).toEqual({ bank: HASH_B, mode: "review" });
  });

  it("没写参数（根路径）：退回本地记着的那个题库", () => {
    expect(
      resolveInitialRoute({ route: HOME_ROUTE, storedActive: HASH_B, banks }),
    ).toEqual({ bank: HASH_B, mode: "home" });
  });

  it("URL 里那个题库已经删了：退回本地记着的那个", () => {
    expect(
      resolveInitialRoute({
        route: { bank: "0123456789abcdef", mode: "learn" },
        storedActive: HASH_A,
        banks,
      }),
    ).toEqual({ bank: HASH_A, mode: "home" });
  });

  it("本地记着的那个也没了：退到列表第一个", () => {
    expect(
      resolveInitialRoute({
        route: HOME_ROUTE,
        storedActive: "0123456789abcdef",
        banks,
      }),
    ).toEqual({ bank: HASH_A, mode: "home" });
  });

  it("一个题库都没有：留在根路径（空题库首页）", () => {
    expect(
      resolveInitialRoute({ route: HOME_ROUTE, storedActive: null, banks: [] }),
    ).toEqual(HOME_ROUTE);
    expect(
      resolveInitialRoute({
        route: { bank: HASH_A, mode: "learn" },
        storedActive: HASH_A,
        banks: [],
      }),
    ).toEqual(HOME_ROUTE);
  });
});

describe("比较路由", () => {
  it("题库与子模式都要一样", () => {
    expect(
      sameRoute({ bank: HASH_A, mode: "home" }, { bank: HASH_A, mode: "home" }),
    ).toBe(true);
    expect(
      sameRoute({ bank: HASH_A, mode: "home" }, { bank: HASH_A, mode: "learn" }),
    ).toBe(false);
    expect(sameRoute(HOME_ROUTE, { bank: HASH_A, mode: "home" })).toBe(false);
  });
});
