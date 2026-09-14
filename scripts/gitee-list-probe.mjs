#!/usr/bin/env node
/** 探针 5：列表接口返回什么？用来判断「哪个 gist 是本次同步的」。 */
const token = process.argv[2];
if (!token) { console.error("用法: node scripts/gitee-list-probe.mjs <令牌>"); process.exit(1); }
const API = "https://gitee.com/api/v5";
const H = { authorization: `Bearer ${token}`, "content-type": "application/json" };
const q = `access_token=${encodeURIComponent(token)}`;

// 先建两条：一条「我们的」（描述 + _general.json），一条干扰项
const mk = async (desc, files) =>
  (await (await fetch(`${API}/gists?${q}`, { method: "POST", headers: H,
    body: JSON.stringify({ description: desc, public: false, files }) })).json());

const ours = await mk("quiz-app sync", { "_general.json": { content: "{}" }, "banks-0.json": { content: "{}" } });
const noise = await mk("something else", { "notes.md": { content: "hello" } });
console.log("建了 ours =", ours.id, "| noise =", noise.id);

// 列表
const res = await fetch(`${API}/gists?${q}&per_page=100`, { headers: H });
const list = await res.json();
console.log("\n列表 HTTP", res.status, "共", Array.isArray(list) ? list.length : "?", "条");
if (Array.isArray(list) && list.length > 0) {
  const first = list[0];
  console.log("单条字段 =", Object.keys(first).join(", "));
  console.log("description =", JSON.stringify(first.description));
  console.log("files 是否完整 =", first.files ? Object.keys(first.files).join(",") : "（没有 files 字段）");
  console.log("html_url =", JSON.stringify(first.html_url));
  console.log("updated_at =", first.updated_at);

  console.log("\n按描述筛出我们的：");
  for (const g of list) {
    const isOurs = g.description === "quiz-app sync";
    console.log(`  ${g.id}  desc=${JSON.stringify(g.description)}  ours=${isOurs}  files=${g.files ? Object.keys(g.files).length : "-"}`);
  }
}

// 清理
for (const g of [ours, noise]) await fetch(`${API}/gists/${g.id}?${q}`, { method: "DELETE", headers: H });
console.log("\n已清理两条探针 gist");
