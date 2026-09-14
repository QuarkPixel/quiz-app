#!/usr/bin/env node
/**
 * 探针 4：对着真 Gitee 走一遍「写入 → 读回」，验证同步到底有没有落盘。
 *
 * 前三个探针只验证了「接口返回 200」；这个验证**内容真的变了**——
 * 之前出现「覆盖来覆盖去，本地纹丝未动」，就是这一层没验过。
 *
 * 用法：node scripts/gitee-live-check.mjs <令牌>
 * 只碰它自己建的 Gist，跑完删掉。
 */

const API = "https://gitee.com/api/v5";
const token = process.argv[2];
if (!token) {
  console.error("用法: node scripts/gitee-live-check.mjs <令牌>");
  process.exit(1);
}

const H = { authorization: `Bearer ${token}`, "content-type": "application/json" };
const q = `access_token=${encodeURIComponent(token)}`;

async function req(method, path, body) {
  const res = await fetch(`${API}${path}${path.includes("?") ? "&" : "?"}${q}`, {
    method,
    headers: H,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed;
  try { parsed = JSON.parse(text); } catch { parsed = text; }
  return { status: res.status, body: parsed };
}

const filesOf = (gist) =>
  Object.fromEntries(
    Object.entries(gist?.files ?? {}).map(([k, v]) => [
      k,
      typeof v === "string" ? v : v?.content,
    ]),
  );

const stamp = Date.now();

// ① 创建
const created = await req("POST", "/gists", {
  description: `live-check-${stamp}`.slice(0, 30),
  public: false,
  files: {
    "_general.json": { content: JSON.stringify({ v: 1, d: "GEN1" }) },
    "banks-0.json": { content: JSON.stringify({ v: 1, d: "B0-v1" }) },
    "banks-3.json": { content: JSON.stringify({ v: 1, d: "B3-v1" }) },
  },
});
console.log("① 创建 →", created.status, "id =", created.body?.id);
const id = created.body?.id;
if (!id) process.exit(1);

// ② 立刻读回：创建时的内容真的存进去了吗
const afterCreate = await req("GET", `/gists/${id}`);
console.log("② 创建后读回:", JSON.stringify(filesOf(afterCreate.body)));

// ③ PATCH 单文件（JSON 体）—— 检查「只改 banks-0、其余不动」
const patched = await req("PATCH", `/gists/${id}`, {
  files: { "banks-0.json": { content: JSON.stringify({ v: 1, d: "B0-v2" }) } },
});
console.log("③ PATCH →", patched.status, "| 响应里的 files:", JSON.stringify(filesOf(patched.body)));

const afterPatch = await req("GET", `/gists/${id}`);
const f3 = filesOf(afterPatch.body);
console.log("   再读回:", JSON.stringify(f3));
console.log("   banks-0 变成 v2:", f3["banks-0.json"] === JSON.stringify({ v: 1, d: "B0-v2" }));
console.log("   banks-3 未被牵连:", f3["banks-3.json"] === JSON.stringify({ v: 1, d: "B3-v1" }));

// ④ 新建文件（本地多了一个分片）
const added = await req("PATCH", `/gists/${id}`, {
  files: { "banks-7.json": { content: JSON.stringify({ v: 1, d: "B7-new" }) } },
});
const afterAdd = filesOf((await req("GET", `/gists/${id}`)).body);
console.log("④ 新增文件 →", added.status, "| 现在有:", Object.keys(afterAdd).join(", "));

// ⑤ 删除文件（files: {name: null}）
const deleted = await req("PATCH", `/gists/${id}`, { files: { "banks-3.json": null } });
const afterDelete = filesOf((await req("GET", `/gists/${id}`)).body);
console.log("⑤ 删除文件 →", deleted.status, "| 现在有:", Object.keys(afterDelete).join(", "));
console.log("   banks-3 真的没了:", !("banks-3.json" in afterDelete));

// 清理
console.log("清理:", (await req("DELETE", `/gists/${id}`)).status);
