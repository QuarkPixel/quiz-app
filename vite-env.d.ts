/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly DEV: boolean;
  /**
   * 可选：把云同步指向另一个兼容后端。默认是**同源** `/api/sync`
   * （本地开发时由 `vite.config.ts` 的 server.proxy 转发到线上部署）。
   */
  readonly VITE_SYNC_RELAY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module "*?raw" {
  const content: string;
  export default content;
}

declare module "*.css";

declare module "*.webm" {
  const src: string;
  export default src;
}
