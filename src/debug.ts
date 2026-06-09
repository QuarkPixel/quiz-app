let debugModeEnabled = import.meta.env.DEV;

export function isDebugModeEnabled(): boolean {
  return debugModeEnabled;
}

export function setDebugModeEnabled(enabled: boolean): boolean {
  debugModeEnabled = enabled;
  return debugModeEnabled;
}

export function debug(enabled?: boolean): boolean {
  if (typeof enabled === "boolean") {
    setDebugModeEnabled(enabled);
  }

  return isDebugModeEnabled();
}

export function installDebugConsoleCommands(): void {
  if (typeof window === "undefined") return;

  window.quizDebug = debug;

  const enabled = isDebugModeEnabled();

  console.log(
    `%c Debug %c ${enabled ? "ON" : "OFF"} %c Run: quizDebug( true | false | null )`,
    "background: #222; color: #fff; padding: 2px 5px; border-radius: 3px 0 0 3px; font-weight: bold;",
    `background: ${enabled ? "#2e7d32" : "#757575"}; color: #fff; padding: 2px 5px; border-radius: 0 3px 3px 0; font-weight: bold;`,
    "color: #666; font-family: monospace; margin-left: 8px;",
  );
}

declare global {
  interface Window {
    quizDebug?: typeof debug;
  }
}
