/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly DEV: boolean;
  /**
   * 可选：云同步指向另一个 Gitee API 地址。
   * 默认就是官方 `https://gitee.com/api/v5`；指向本地 mock 可以不改线上数据地测同步逻辑。
   */
  readonly VITE_GITEE_API_BASE?: string;
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
