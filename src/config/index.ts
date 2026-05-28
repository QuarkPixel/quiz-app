/**
 * 配置 barrel：保留旧的 `import ... from "../config"` 路径无痛迁移。
 * 新代码可以直接 import 子模块（如 `from "../config/ui"`）。
 */
export * from "./algorithm";
export * from "./storage";
export * from "./ui";
export * from "./progress-bar";
export * from "./matcher";
export * from "./shortcuts";
