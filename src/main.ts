import { mount } from "svelte";
import App from "./App.svelte";
import { installDebugConsoleCommands } from "./debug";
import { installStorageHook } from "./features/sync/storage";
import { syncEngine } from "./features/sync/engine.svelte";

installDebugConsoleCommands();

// 先装 localStorage 钩子再挂载：挂载过程里发生的写入（例如旧版配置迁移）
// 也要被计进「本地改动」，否则它们得等到下一次写入才会被同步。
installStorageHook();

const app = mount(App, {
  target: document.getElementById("app")!,
});

// 云同步：没配置时是空转（只会在设置面板里显示「未配置」）
syncEngine.init();

export default app;
