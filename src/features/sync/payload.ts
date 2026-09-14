/**
 * 同步文件的编解码：快照 ↔ 压缩后的 Gist 文件内容。
 *
 * 复用项目里已有的做法（`importExport.ts`）：`deflateRaw` + base64url。
 * 实测 200 张卡的题库 44.2 KB → 5.6 KB（去掉 87%），所以「每次传整份」其实
 * 也不大；分文件的意义在于**只传改动的那一份**，不是省流量。
 *
 * 格式（`SyncFilePayload`）：
 *
 *   { "v": 1, "d": "<base64url 的 deflateRaw 数据>" }
 *
 * 包一层版本号是为了以后改结构时还能读旧数据。
 */

import {
  SYNC_PAYLOAD_VERSION,
  type SyncFilePayload,
} from "./types";

// ── 压缩原语（与 importExport.ts 同一套做法）────────────────────────────────

async function readAllChunks(
  readable: ReadableStream<Uint8Array>,
): Promise<Uint8Array[]> {
  const reader = readable.getReader();
  const chunks: Uint8Array[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }
  return chunks;
}

function concatChunks(
  chunks: readonly Uint8Array[],
): Uint8Array<ArrayBuffer> {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

/**
 * 写入全部数据并关闭。
 *
 * **必须与读取并发**：写成「先 await writer.write() 再开始读」会在有背压的
 * 实现上永久挂住（Deno 如此，浏览器同理），表现为「点了同步没反应」。
 */
async function writeAllChunks(
  stream: WritableStream<BufferSource>,
  data: Uint8Array<ArrayBuffer>,
): Promise<void> {
  const writer = stream.getWriter();
  await writer.write(data);
  await writer.close();
}

async function deflateRaw(
  data: Uint8Array<ArrayBuffer>,
): Promise<Uint8Array<ArrayBuffer>> {
  const cs = new CompressionStream("deflate-raw");
  const [chunks] = await Promise.all([
    readAllChunks(cs.readable),
    writeAllChunks(cs.writable, data),
  ]);
  return concatChunks(chunks);
}

async function inflateRaw(
  data: Uint8Array<ArrayBuffer>,
): Promise<Uint8Array<ArrayBuffer>> {
  const ds = new DecompressionStream("deflate-raw");
  const [chunks] = await Promise.all([
    readAllChunks(ds.readable),
    writeAllChunks(ds.writable, data),
  ]);
  return concatChunks(chunks);
}

// ── Base64url（不含 padding）────────────────────────────────────────────────

function toBase64url(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

function fromBase64url(str: string): Uint8Array<ArrayBuffer> {
  const padded = str.replace(/-/g, "+").replace(/_/g, "/");
  const pad = (4 - (padded.length % 4)) % 4;
  const binary = atob(padded + "=".repeat(pad));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

// ── 公开 API ────────────────────────────────────────────────────────────────

/** 把一份快照编码成要写进 Gist 的文件内容。 */
export async function encodePayload(snapshot: unknown): Promise<string> {
  const json = JSON.stringify(snapshot);
  const bytes = new TextEncoder().encode(json) as Uint8Array<ArrayBuffer>;
  const compressed = await deflateRaw(bytes);
  const payload: SyncFilePayload = {
    v: SYNC_PAYLOAD_VERSION,
    d: toBase64url(compressed),
  };
  return JSON.stringify(payload);
}

/**
 * 把 Gist 文件内容解回快照的 JSON 文本。
 *
 * 返回 `null` 表示这个文件不是我们的格式（可能是别人手改过、或版本不认）。
 * 调用方应当跳过它而不是当成损坏数据删掉。
 */
export async function decodePayload(content: string): Promise<string | null> {
  let payload: unknown;
  try {
    payload = JSON.parse(content);
  } catch {
    return null;
  }
  if (payload === null || typeof payload !== "object") return null;

  const record = payload as Partial<SyncFilePayload>;
  if (typeof record.d !== "string") return null;
  if (typeof record.v === "number" && record.v > SYNC_PAYLOAD_VERSION) {
    // 更新的版本写出来的：宁可不动，也不要按旧规则解出错的数据
    return null;
  }

  try {
    const bytes = await inflateRaw(fromBase64url(record.d));
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}
