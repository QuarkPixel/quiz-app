#!/usr/bin/env node
/**
 * Gitee Gists 接口探针：确认「创建 / 读取单文件 / 只更新其中一个文件」到底怎么调。
 *
 * 用法：
 *   node scripts/gitee-probe.mjs <你的 Gitee 私人令牌>
 *
 * 令牌在 https://gitee.com/profile/personal_access_tokens 生成，勾选 gists 权限。
 * 探针只碰它自己创建的那条 Gist（跑完会删掉），不会动你别的数据。
 *
 * 会依次尝试 PATCH 的三种写法，报告哪种能让「A 文件不变、B 文件更新」成立：
 *   ① multipart/form-data，files 序列化成 {"名字": {"content": "..."}}
 *   ② multipart/form-data，files[B][content]=...  这种表单式写法
 *   ③ application/json（spec 里写的是 multipart，但想确认 JSON 是否也吃）
 */

const API = "https://gitee.com/api/v5";
const token = process.argv[2];
if (!token) {
  console.error("用法: node scripts/gitee-probe.mjs <你的 Gitee 私人令牌>");
  process.exit(1);
}

const q = (extra = "") => `access_token=${encodeURIComponent(token)}${extra ? `&${extra}` : ""}`;

async function call(label, path, init) {
  const res = await fetch(`${API}${path}`, init);
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  console.log(`\n── ${label}`);
  console.log(`   ${init?.method ?? "GET"} ${path.split("?")[0]} → HTTP ${res.status}`);
  return { res, body };
}

/** 从 gist 响应里安全取某个文件的内容。 */
function fileContent(gist, name) {
  const files = gist?.files;
  if (!files || typeof files !== "object") return undefined;
  const entry = files[name];
  if (entry === undefined) return undefined;
  if (typeof entry === "string") return entry;
  return entry?.content;
}

function summarize(gist) {
  const files = gist?.files;
  if (!files || typeof files !== "object") return `files 形状异常: ${JSON.stringify(files)?.slice(0, 120)}`;
  return Object.entries(files)
    .map(([name, entry]) => {
      const c = typeof entry === "string" ? entry : entry?.content;
      return `${name}=${JSON.stringify(String(c ?? "").slice(0, 40))}`;
    })
    .join("  ");
}

const stamp = Date.now();
const NAME_A = `quiz-app-probe-a-${stamp}.json`;
const NAME_B = `quiz-app-probe-b-${stamp}.json`;
const A1 = JSON.stringify({ probe: "A", round: 1 });
const B1 = JSON.stringify({ probe: "B", round: 1 });
const B2 = JSON.stringify({ probe: "B", round: 2 });

let gistId = null;
try {
  // ── 1. 创建（两个文件）──
  const created = await call("1. 创建 Gist（两个文件）", `/gists?${q()}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      description: `quiz-app-probe-${stamp}`.slice(0, 30),
      public: false,
      files: { [NAME_A]: { content: A1 }, [NAME_B]: { content: B1 } },
    }),
  });
  console.log("   返回:", JSON.stringify(created.body)?.slice(0, 300));
  gistId = created.body?.id;
  if (!gistId) {
    console.error(
      created.res.status === 401
        ? "\n❌ 令牌无效或没有 gists 权限。请到 https://gitee.com/profile/personal_access_tokens 重新生成，\n   勾选 gists 范围后重跑。"
        : `\n❌ 创建失败（HTTP ${created.res.status}），后面的测试没法做。`,
    );
    process.exitCode = 1;
    // 不走 finally 里的删除（本来也没建出来）
    gistId = null;
    throw new Error("__abort__");
  }
  console.log("   ✅ gist id =", gistId);

  // ── 2. 读单条 ──
  const got = await call("2. 读取单条", `/gists/${gistId}?${q()}`);
  console.log("   文件:", summarize(got.body));
  console.log("   updated_at =", got.body?.updated_at, "| truncated =", got.body?.truncated);
  console.log("   ✅ files 的取值路径:", got.body?.files?.[NAME_A] === undefined
    ? "取不到（形状要再研究）"
    : (typeof got.body.files[NAME_A] === "string" ? "files[名] 直接是字符串" : "files[名].content"));

  // ── 3. 尝试 PATCH 写法 ①：multipart + files 为 JSON 字符串 ──
  {
    const fd = new FormData();
    fd.set("access_token", token);
    fd.set("files", JSON.stringify({ [NAME_B]: { content: B2 } }));
    const r = await call("3a. PATCH multipart，files=JSON字符串", `/gists/${gistId}`, { method: "PATCH", body: fd });
    console.log("   返回:", JSON.stringify(r.body)?.slice(0, 200));
    const after = await fetch(`${API}/gists/${gistId}?${q()}`).then((x) => x.json());
    console.log("   B 已更新:", fileContent(after, NAME_B) === B2, "| A 还在:", fileContent(after, NAME_A) === A1);
  }

  // ── 4. 尝试 PATCH 写法 ②：multipart + files[名][content] ──
  {
    const fd = new FormData();
    fd.set("access_token", token);
    fd.set(`files[${NAME_B}][content]`, B2);
    const r = await call("3b. PATCH multipart，files[名][content]", `/gists/${gistId}`, { method: "PATCH", body: fd });
    console.log("   返回:", JSON.stringify(r.body)?.slice(0, 200));
    const after = await fetch(`${API}/gists/${gistId}?${q()}`).then((x) => x.json());
    console.log("   B 已更新:", fileContent(after, NAME_B) === B2, "| A 还在:", fileContent(after, NAME_A) === A1);
  }

  // ── 5. 尝试 PATCH 写法 ③：JSON body（spec 说 multipart，验证一下）──
  {
    const r = await call("3c. PATCH application/json", `/gists/${gistId}?${q()}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ files: { [NAME_B]: { content: B2 } } }),
    });
    console.log("   返回:", JSON.stringify(r.body)?.slice(0, 200));
  }

  // ── 6. 令牌放 header 行不行（顺手确认必须走 query）──
  {
    const r = await call("4. 令牌放 Authorization header", `/gists/${gistId}`, {
      headers: { authorization: `token ${token}` },
    });
    console.log("   返回:", JSON.stringify(r.body)?.slice(0, 160));
  }
} catch (error) {
  if (error?.message !== "__abort__") throw error;
} finally {
  if (gistId) {
    const del = await call("5. 清理：删除探针 Gist", `/gists/${gistId}?${q()}`, { method: "DELETE" });
    console.log("   → HTTP", del.res.status, "(204 = 删除成功)");
  }
}
