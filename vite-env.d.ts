/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly DEV: boolean;
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
