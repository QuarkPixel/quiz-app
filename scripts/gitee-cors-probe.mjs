#!/usr/bin/env node
/**
 * 探针 2：Gitee 的 CORS 策略 —— 决定浏览器能不能直连 Gitee。
 *
 * 如果 Gitee 返回了放行我们源的 CORS 头，那么**连 Vercel 中转层都不需要**，
 * 浏览器可以带着 Authorization 头直接读写 Gist（令牌不进 URL、不经过第三方）。
 *
 * 用法：node scripts/gitee-cors-probe.mjs <令牌>
 */
const token = process.argv[2];
if (!token) {
  console.error("用法: node scripts/gitee-cors-probe.mjs <令牌>");
  process.exit(1);
}
const API = "https://gitee.com/api/v5";
const ORIGIN = "https://quiz-app.example.com"; // 冒充一个第三方网页的源

const show = (label, res) => {
  const h = (n) => res.headers.get(n);
  console.log(`\n── ${label}`);
  console.log("   HTTP", res.status);
  console.log("   access-control-allow-origin :", h("access-control-allow-origin") ?? "（无）");
  console.log("   access-control-allow-headers:", h("access-control-allow-headers") ?? "（无）");
  console.log("   access-control-allow-methods:", h("access-control-allow-methods") ?? "（无）");
  return h("access-control-allow-origin");
};

// ① 预检：浏览器在发带 Authorization 的跨域请求前一定会先问这个
const preflight = await fetch(`${API}/gists/whatever`, {
  method: "OPTIONS",
  headers: {
    origin: ORIGIN,
    "access-control-request-method": "PATCH",
    "access-control-request-headers": "authorization, content-type",
  },
});
const allowOrigin = show("① 预检 OPTIONS", preflight);
console.log("   → 浏览器直连可行:", allowOrigin ? `是（放行 ${allowOrigin}）` : "否（没有 CORS 头，会被浏览器拦下）");

// ② 真正的 GET，带 Origin
const got = await fetch(`${API}/gists?per_page=1`, {
  headers: { origin: ORIGIN, authorization: `Bearer ${token}` },
});
show("② 带 Origin 的 GET", got);
console.log("   → Authorization 头对读取有效:", got.status === 200 ? "是" : `否（HTTP ${got.status}）`);

// ③ 带 Origin 的 POST（创建）——验证 Authorization 头对写操作也有效
const post = await fetch(`${API}/gists`, {
  method: "POST",
  headers: { origin: ORIGIN, authorization: `Bearer ${token}`, "content-type": "application/json" },
  body: JSON.stringify({ description: `cors-probe-${Date.now()}`.slice(0, 30), public: false, files: { "a.txt": { content: "hi" } } }),
});
show("③ 带 Origin 的 POST（创建）", post);
const created = await post.json().catch(() => null);
console.log("   → Authorization 头对写入有效:", created?.id ? "是" : `否（${JSON.stringify(created)?.slice(0, 100)}）`);
if (created?.id) {
  const del = await fetch(`${API}/gists/${created.id}`, { method: "DELETE", headers: { authorization: `Bearer ${token}` } });
  console.log("   清理:", del.status);
}
