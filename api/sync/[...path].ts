/**
 * 云同步的哑管道。
 *
 *   GET  /api/sync/_ping                 自检：这台函数活着吗
 *   ANY  /api/sync/quiz_app_sync?url=... 转发到 {url}/rest/v1/quiz_app_sync...
 *
 * ── 设计要点 ────────────────────────────────────────────────────────────────
 * 这台函数**不持有任何密钥，也没有任何环境变量**。
 *
 * Supabase 的地址与 key 由浏览器在每次请求里带上（`?url=` 与 `apikey` 头），
 * 这里只做三件事：补 CORS、注入 apikey、把请求转发出去。
 *
 * 于是：
 *   - 换 Supabase 项目、换 key，都不用改这里、也不用重新部署；
 *   - 这个函数被别人发现也无所谓——它是一个没有秘密的管道，
 *     谁能提供凭据，谁就操作谁的库（这正是「各带各的库」想要的形状）。
 *
 * 为什么还要有这一层：Supabase 的域名在国内直连不稳，而 Vercel 稳定。
 * 浏览器只访问自己的域名，由这台函数替它去够 Supabase。
 *
 * ⚠️ 这里**不要**打印请求头、不要收集错误上下文里的 header：
 *    浏览器带来的 key 会出现在那些地方，而它不该落在任何日志里。
 */

export const config = { runtime: "edge" };

const CORS_HEADERS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,PATCH,PUT,DELETE,OPTIONS",
  "access-control-allow-headers":
    "apikey,authorization,content-type,prefer,accept,accept-profile,content-profile,range,x-client-info",
  "access-control-max-age": "86400",
};

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...CORS_HEADERS,
    },
  });
}

function normalizeBaseUrl(raw: string): string {
  return raw.trim().replace(/\/+$/, "");
}

/** 只接受 Supabase 项目域名：避免被当成任意站点的开放代理（SSRF）。 */
function isSupabaseUrl(value: string): boolean {
  return /^https:\/\/[a-z0-9-]+\.supabase\.(co|in)$/.test(value);
}

/** 自检：不需要任何凭据，只确认这台函数在跑。 */
function handlePing(): Response {
  return json({ ok: true, service: "quiz-app-sync-relay" }, 200);
}

async function proxy(request: Request, url: URL): Promise<Response> {
  const base = normalizeBaseUrl(url.searchParams.get("url") ?? "");
  if (!base) {
    return json(
      {
        error: "缺少 url 参数",
        hint: "请求应当形如 /api/sync/quiz_app_sync?url=https://xxxx.supabase.co&select=...",
      },
      400,
    );
  }
  if (!isSupabaseUrl(base)) {
    return json({ error: "url 不是合法的 Supabase 项目地址" }, 400);
  }

  const apikey = (request.headers.get("apikey") ?? "").trim();
  if (!apikey) {
    return json({ error: "缺少 apikey：请在应用里填入 Supabase 密钥" }, 401);
  }

  // /api/sync/quiz_app_sync?... → quiz_app_sync?...
  const upstreamPath = url.pathname.replace(/^\/api\/sync\/?/, "");
  if (!upstreamPath) {
    return json({ error: "缺少目标路径", hint: "用法：/api/sync/quiz_app_sync" }, 400);
  }

  const target = `${base}/rest/v1/${upstreamPath}${url.search}`;

  const headers = new Headers();
  for (const name of ["content-type", "prefer", "accept", "range"]) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  if (!headers.has("accept")) headers.set("accept", "application/json");

  // 凭据只在这里被搬运一次，不落盘、不打印
  headers.set("apikey", apikey);
  headers.set("authorization", `Bearer ${apikey}`);

  const hasBody = request.method !== "GET" && request.method !== "HEAD";

  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method: request.method,
      headers,
      body: hasBody ? await request.text() : undefined,
      redirect: "follow",
    });
  } catch {
    // 刻意不回显原始错误对象：它可能带上包含 key 的请求上下文
    return json(
      { error: "转发失败：这台函数连不上 Supabase" },
      502,
    );
  }

  const responseHeaders = new Headers(CORS_HEADERS);
  responseHeaders.set(
    "content-type",
    upstream.headers.get("content-type") ?? "application/json",
  );
  for (const name of ["content-range", "range-unit"]) {
    const value = upstream.headers.get(name);
    if (value) responseHeaders.set(name, value);
  }
  // 同步结果是个人数据，任何一层缓存都不该留
  responseHeaders.set("cache-control", "no-store, max-age=0");

  return new Response(upstream.body, {
    status: upstream.status,
    headers: responseHeaders,
  });
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname.replace(/\/+$/, "").endsWith("/_ping")) return handlePing();
  return await proxy(request, url);
}

export async function OPTIONS(): Promise<Response> {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

/** 其余方法一律走转发。 */
export default function handler(request: Request): Promise<Response> {
  return proxy(request, new URL(request.url));
}

export const POST = handler;
export const PATCH = handler;
export const PUT = handler;
export const DELETE = handler;
export const HEAD = handler;
