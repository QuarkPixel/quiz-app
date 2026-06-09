import { mount } from "svelte";
import App from "$app-root";
import { installDebugConsoleCommands } from "./debug";

installDebugConsoleCommands();

const app = mount(App, {
  target: document.getElementById("app")!,
});

export default app;
