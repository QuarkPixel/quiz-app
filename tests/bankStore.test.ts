import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { STORAGE_KEY_GENERAL, STORAGE_PREFIX_STATE } from "../src/config";
import { BankStore } from "../src/source/bankStore";

function seedGeneral(raw: unknown): void {
  localStorage.setItem(STORAGE_KEY_GENERAL, JSON.stringify(raw));
}

function readGeneral(): {
  activeBank: string | null;
  library: { hash: string }[];
} {
  return JSON.parse(localStorage.getItem(STORAGE_KEY_GENERAL) ?? "{}");
}

describe("BankStore", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("ignores malformed library index instead of crashing on startup", () => {
    seedGeneral({ library: { not: "an array" }, activeBank: "c" });

    const source = new BankStore();

    expect(source.listBanks()).toEqual([]);
    expect(source.getActiveBank()).toBeNull();
  });

  it("keeps only valid unique bank summaries from a corrupted index", () => {
    seedGeneral({
      library: [
        { hash: "a", name: "A", count: 1, addedAt: 1 },
        { hash: "a", name: "Duplicate A", count: 1, addedAt: 2 },
        { hash: "", name: "Missing hash", count: 1, addedAt: 3 },
        { hash: "b", name: "B", count: 2, addedAt: 4 },
        null,
      ],
    });

    const source = new BankStore();

    expect(source.listBanks()).toEqual([
      { hash: "a", name: "A", mode: "quiz", count: 1, addedAt: 1 },
      { hash: "b", name: "B", mode: "quiz", count: 2, addedAt: 4 },
    ]);
  });

  it("moves selected banks to the top while preserving their relative order", () => {
    seedGeneral({
      activeBank: "c",
      library: [
        { hash: "a", name: "A", count: 1, addedAt: 1 },
        { hash: "b", name: "B", count: 1, addedAt: 2 },
        { hash: "c", name: "C", count: 1, addedAt: 3 },
        { hash: "d", name: "D", count: 1, addedAt: 4 },
      ],
    });

    const source = new BankStore();
    source.moveBanksToTop(["d", "b", "missing", "d"]);

    expect(source.listBanks().map((bank) => bank.hash)).toEqual([
      "b",
      "d",
      "a",
      "c",
    ]);

    const general = readGeneral();
    expect(general.activeBank).toBe("c");
    expect(general.library.map((bank) => bank.hash)).toEqual([
      "b",
      "d",
      "a",
      "c",
    ]);
  });

  it("imports a unified bank file and records its mode", async () => {
    const source = new BankStore();
    const raw = JSON.stringify({
      questions: [
        { id: "j1", type: "judgment", question: "q", answer: true },
      ],
    });

    const result = await source.importBank("测试题库", raw);

    expect(result.kind).toBe("ok");
    expect(source.listBanks()).toHaveLength(1);
    expect(source.listBanks()[0].mode).toBe("quiz");
    expect(source.listBanks()[0].count).toBe(1);
    expect(source.getActiveBank()?.mode).toBe("quiz");
  });

  it("题库文件里的 title 优先于传入的名称", async () => {
    const source = new BankStore();
    const raw = JSON.stringify({
      title: "文件里的标题",
      questions: [
        { id: "j1", type: "judgment", question: "q", answer: true },
      ],
    });

    await source.importBank("文件名", raw);

    expect(source.listBanks()[0].name).toBe("文件里的标题");
  });

  it("没有 title 时回退到传入的名称（文件名 / 剪贴板名）", async () => {
    const source = new BankStore();
    const raw = JSON.stringify({
      questions: [
        { id: "j1", type: "judgment", question: "q", answer: true },
      ],
    });

    await source.importBank("文件名", raw);

    expect(source.listBanks()[0].name).toBe("文件名");
  });

  it("导出的题库带 title，重新解析后能取回名称", async () => {
    const source = new BankStore();
    await source.importBank(
      "导出用题库",
      JSON.stringify({
        questions: [
          { id: "j1", type: "judgment", question: "q", answer: true },
        ],
      }),
    );
    const hash = source.listBanks()[0].hash;

    const exported = await source.exportBank(hash);
    expect(exported).not.toBeNull();
    const parsed = JSON.parse(exported!.content);
    expect(parsed.title).toBe("导出用题库");

    const fresh = new BankStore();
    await fresh.importBank("别的名字", exported!.content);
    expect(fresh.listBanks()[0].name).toBe("导出用题库");
  });

  it("rejects a bare array bank file", async () => {
    const source = new BankStore();
    const raw = JSON.stringify([
      { id: "j1", type: "judgment", question: "q", answer: true },
    ]);

    const result = await source.importBank("旧格式", raw);

    expect(result.kind).toBe("invalid");
    expect(source.listBanks()).toHaveLength(0);
  });
});

describe("BankStore 导出：进度编不出来也要把题库导出去", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  const memoryQuestions = Array.from({ length: 3 }, (_, i) => ({
    id: `m${i + 1}`,
    type: "memory",
    question: `题 ${i + 1}`,
    answer: `答 ${i + 1}`,
  }));

  it("盘上留着题库里已不存在的进度 id 时：导出成功并说明进度没带上", async () => {
    const source = new BankStore();
    await source.importBank(
      "记忆题库",
      JSON.stringify({ mode: "memory", questions: memoryQuestions }),
    );
    const hash = source.listBanks()[0].hash;

    // 直接往盘上塞一份带脏 id 的状态（绕过 buildRuntimeState 的清理），
    // 模拟「改过题库之后留下的旧进度」
    const stateKey = STORAGE_PREFIX_STATE + hash;
    const stored = JSON.parse(localStorage.getItem(stateKey) ?? "{}");
    localStorage.setItem(
      stateKey,
      JSON.stringify({
        ...stored,
        memory: {
          progress: {
            gone: {
              state: "reviewing",
              level: 1,
              streak: 0,
              nextDue: 1789315200000,
              lapses: 0,
            },
          },
          settings: { graduateLevel: 6, roundTarget: 5 },
        },
      }),
    );

    const exported = await source.exportBank(hash);

    expect(exported).not.toBeNull();
    expect(exported!.warning).toMatch(/进度没有一起导出/);
    // 题目照常导出；只是没有 state（进度）字段
    const parsed = JSON.parse(exported!.content);
    expect(parsed.state).toBeUndefined();
    expect(parsed.mode).toBe("memory");
    expect(parsed.questions).toHaveLength(memoryQuestions.length);
  });

  it("进度正常时导出带 state，没有 warning", async () => {
    const source = new BankStore();
    await source.importBank(
      "记忆题库",
      JSON.stringify({ mode: "memory", questions: memoryQuestions }),
    );
    const hash = source.listBanks()[0].hash;

    const stateKey = STORAGE_PREFIX_STATE + hash;
    const stored = JSON.parse(localStorage.getItem(stateKey) ?? "{}");
    localStorage.setItem(
      stateKey,
      JSON.stringify({
        ...stored,
        memory: {
          progress: {
            m1: {
              state: "reviewing",
              level: 2,
              streak: 0,
              nextDue: 1789315200000,
              lapses: 0,
            },
          },
          settings: { graduateLevel: 6, roundTarget: 5 },
        },
      }),
    );

    const exported = await source.exportBank(hash);

    expect(exported!.warning).toBeUndefined();
    expect(typeof JSON.parse(exported!.content).state).toBe("string");
  });
});
