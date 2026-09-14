#!/usr/bin/env node
/**
 * 探针 3：Gitee Gist 的各种硬限制在哪。
 *
 * 已知：一条 Gist 最多 10 个文件（创建时 11 个会 400）。
 * 这里把边界和其它没写进 spec 的限制一次问清楚：
 *   ① 到底几个文件是上限（逐个试）
 *   ② 文件名能不能带 `_` `-` 这类字符
 *   ③ 描述的长度上限
 *   ④ 单个文件能有多大
 *   ⑤ 一条 Gist 的总大小上限
 *
 * 用法：node scripts/gitee-limits-probe.mjs <令牌>
 * 只碰它自己创建的 Gist，跑完会删掉。
 */

const API = "https://gitee.com/api/v5";
const token = process.argv[2];
if (!token) {
  console.error("用法: node scripts/gitee-limits-probe.mjs <令牌>");
  process.exit(1);
}

const H = { authorization: `Bearer ${token}`, "content-type": "application/json" };
const q = `access_token=${encodeURIComponent(token)}`;

async function create(files, description = `quiz-app-limits-${Date.now()}`.slice(0, 30)) {
  const res = await fetch(`${API}/gists?${q}`, {
    method: "POST",
    headers: H,
    body: JSON.stringify({ description, public: false, files }),
  });
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body, id: body?.id };
}

async function drop(id) {
  if (!id) return;
  await fetch(`${API}/gists/${id}?${q}`, { method: "DELETE", headers: H });
}

const filesOf = (n, name = (i) => `f${i}.json`) =>
  Object.fromEntries(Array.from({ length: n }, (_, i) => [name(i), { content: "{}" }]));

// ① 文件数上限
for (const n of [10, 11, 12]) {
  const r = await create(filesOf(n));
  console.log(`① ${n} 个文件 → HTTP ${r.status}${r.status === 201 ? "" : ` ${JSON.stringify(r.body)?.slice(0, 80)}`}`);
  await drop(r.id);
}

// ② 文件名里的特殊字符
const weird = await create({
  "_general.json": { content: "{}" },
  "a-b_c.1234.json": { content: "{}" },
});
console.log(`② 文件名带 _ - _ 和数字 → HTTP ${weird.status}`);
await drop(weird.id);

// ③ 描述长度（spec 说 1~30 字符）
for (const len of [30, 31, 60]) {
  const r = await create({ "a.json": { content: "{}" } }, "x".repeat(len));
  console.log(`③ 描述 ${len} 字符 → HTTP ${r.status}${r.status === 201 ? "" : ` ${JSON.stringify(r.body)?.slice(0, 80)}`}`);
  await drop(r.id);
}

// ④ 单文件大小 / ⑤ 总大小
for (const kb of [64, 256, 1024]) {
  const r = await create({ "big.json": { content: "x".repeat(kb * 1024) } });
  console.log(`④ 单文件 ${kb} KB → HTTP ${r.status}${r.status === 201 ? "" : ` ${JSON.stringify(r.body)?.slice(0, 80)}`}`);
  await drop(r.id);
}
