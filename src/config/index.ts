/**
 * 配置 barrel：保留旧的 `import ... from "../config"` 路径无痛迁移。
 * 新代码可以直接 import 子模块（如 `from "@/config/layout"`）。
 *
 * ── 什么该放进 `src/config/` ────────────────────────────────────────────────
 *
 * 判据只有一条：**改动它会影响多处、或者别人需要知道它的存在**。
 *
 *   放这里：跨模块的全局调参（时长、断点、层级、上限）、存储键、快捷键注册表、
 *          算法与匹配的默认值、主题以外的固定文案口径。
 *   不放这里：只服务一个模块的实现细节（如 `features/sync/types.ts` 里的
 *          Gist 文件名与分片数、虚拟列表的估算行高）——它们和实现绑得太紧，
 *          搬过来只会让人两头找。
 *
 * 判断不准时问一句：「这值改了，是不是有别的模块也要跟着改？」是 → 放这里。
 */
export * from "./algorithm";
export * from "./storage";
export * from "./ui";
export * from "./layout";
export * from "./progress-bar";
export * from "./matcher";
export * from "./shortcuts";
export * from "./sound";
export * from "./sync";
