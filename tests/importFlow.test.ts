import { describe, expect, it } from "vitest";
import {
  openImport,
  pendingOverwriteOf,
  promptOf,
  settleOverwrite,
  type ImportSessionPhase,
  type OverwriteImportRequest,
} from "../src/features/bankFiles";

function request(fileName: string): OverwriteImportRequest {
  return { fileName, hash: `hash-${fileName}`, stateStr: "{}", bankName: fileName };
}

const ok = (fileName: string) =>
  ({ kind: "success", fileName }) as const;

const declined = (fileName: string) =>
  ({
    kind: "failure",
    failure: {
      fileName,
      getReason: () => "题库已存在，已保留当前进度。",
    },
  }) as const;

describe("导入会话：状态与投影", () => {
  it("全部直接出结果：没有要问的，直接给汇总", () => {
    const phase = openImport([
      { kind: "done", outcome: ok("a.json") },
      { kind: "done", outcome: ok("b.json") },
    ]);

    expect(phase.kind).toBe("done");
    expect(pendingOverwriteOf(phase)).toBeNull();
    const prompt = promptOf(phase, 2);
    expect(prompt.kind).toBe("summary");
  });

  it("有待问的：问的就是队头那一个", () => {
    const phase = openImport([
      { kind: "needs-overwrite", request: request("a.json") },
      { kind: "needs-overwrite", request: request("b.json") },
    ]);

    expect(pendingOverwriteOf(phase)?.fileName).toBe("a.json");
    const prompt = promptOf(phase, 2);
    expect(prompt.kind).toBe("overwrite");
    if (prompt.kind !== "overwrite") throw new Error("expected overwrite");
    expect(prompt.request.fileName).toBe("a.json");
  });

  it("结果与待问混在一起时，结果照样按顺序留着", () => {
    const phase = openImport([
      { kind: "done", outcome: ok("a.json") },
      { kind: "needs-overwrite", request: request("b.json") },
      { kind: "done", outcome: ok("c.json") },
    ]);

    // 结算掉唯一一张待问之后，三条结果都在
    const settled = settleOverwrite(phase, declined("b.json"));
    expect(settled.kind).toBe("done");
    const prompt = promptOf(settled, 3);
    expect(prompt.kind).toBe("summary");
    if (prompt.kind !== "summary") throw new Error("expected summary");
    expect(prompt.message.text).toContain("2 个成功，1 个失败。");
  });
});

describe("导入会话：转移", () => {
  it("结算一张就前进一张，问完转 done", () => {
    const phase = openImport([
      { kind: "needs-overwrite", request: request("a.json") },
      { kind: "needs-overwrite", request: request("b.json") },
    ]);

    const second = settleOverwrite(phase, ok("a.json"));
    expect(second.kind).toBe("asking");
    expect(pendingOverwriteOf(second)?.fileName).toBe("b.json");

    const third = settleOverwrite(second, ok("b.json"));
    expect(third.kind).toBe("done");
    expect(pendingOverwriteOf(third)).toBeNull();
  });

  it("已经问完了再结算一次是空操作", () => {
    const done = settleOverwrite(
      openImport([{ kind: "needs-overwrite", request: request("a.json") }]),
      ok("a.json"),
    );
    expect(done.kind).toBe("done");

    const again = settleOverwrite(done, declined("a.json"));
    expect(again).toBe(done);
  });

  it("转移不改原状态（纯函数）", () => {
    const phase = openImport([
      { kind: "needs-overwrite", request: request("a.json") },
      { kind: "needs-overwrite", request: request("b.json") },
    ]);
    const snapshot = JSON.parse(JSON.stringify(phase)) as ImportSessionPhase;

    settleOverwrite(phase, ok("a.json"));
    expect(JSON.parse(JSON.stringify(phase))).toEqual(snapshot);
  });

  it("一次都没读进东西：直接是 done，汇总按「全部失败」之外的空结果给", () => {
    const phase = openImport([]);
    expect(phase.kind).toBe("done");
    expect(pendingOverwriteOf(phase)).toBeNull();
  });
});
