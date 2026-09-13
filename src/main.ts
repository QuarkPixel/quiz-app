import { mount } from "svelte";
import App from "./App.svelte";
import { installDebugConsoleCommands } from "./debug";

installDebugConsoleCommands();

const app = mount(App, {
  target: document.getElementById("app")!,
});

export default app;
