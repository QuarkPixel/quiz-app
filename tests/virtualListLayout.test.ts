import { describe, it, expect } from "vitest";
import {
  buildFlatItems,
  buildIdToRank,
  buildSectionLayouts,
  buildSections,
  estimateQuestionHeight,
  ESTIMATED_HEADER_HEIGHT,
  findQuestionTop,
  getVisibleRange,
  type ResolveHeight,
} from "../src/components/review/virtualList/layout";
import type {
  QuestionGroup,
  Section,
  SectionLayout,
} from "../src/components/review/virtualList/types";
import type { Question } from "../src/types";

function q(id: string, type: Question["type"] = "judgment"): Question {
  return { id, type, question: `q-${id}`, answer: true };
}

function groups(): QuestionGroup[] {
  return [
    {
      type: "judgment",
      items: [
        { question: q("j1"), indicator: null },
        { question: q("j2"), indicator: null },
      ],
    },
    {
      type: "single",
      items: [{ question: q("s1"), indicator: null }],
    },
  ];
}

function resolveFromMap(map: Record<string, number>): ResolveHeight {
  return (id, fallback) => (id in map ? map[id] : fallback);
}

describe("buildFlatItems", () => {
  it("header 与 question 交错扁平化", () => {
    const flat = buildFlatItems(groups());
    expect(flat.map((f) => f.type)).toEqual([
      "header",
      "question",
      "question",
      "header",
      "question",
    ]);
    expect(flat.map((f) => f.id)).toEqual([
      "header-judgment",
      "j1",
      "j2",
      "header-single",
      "s1",
    ]);
  });

  it("header 带 count 与 questionType", () => {
    const flat = buildFlatItems(groups());
    const header = flat[0];
    expect(header.type).toBe("header");
    if (header.type === "header") {
      expect(header.count).toBe(2);
      expect(header.questionType).toBe("judgment");
    }
  });
});

describe("buildSections", () => {
  it("按 header 切分", () => {
    const sections = buildSections(buildFlatItems(groups()));
    expect(sections.length).toBe(2);
    expect(sections[0].header.questionType).toBe("judgment");
    expect(sections[0].questionItems.map((q) => q.id)).toEqual(["j1", "j2"]);
    expect(sections[1].questionItems.map((q) => q.id)).toEqual(["s1"]);
  });
});

describe("buildSectionLayouts", () => {
  it("累计 y / 偏移 / 总高", () => {
    const sections = buildSections(buildFlatItems(groups()));
    // 固定高度：header=41，每题=100
    const resolve = resolveFromMap({
      "header-judgment": 41,
      "header-single": 41,
      j1: 100,
      j2: 100,
      s1: 100,
    });
    const layouts = buildSectionLayouts(sections, resolve);

    expect(layouts[0].y).toBe(0);
    expect(layouts[0].headerHeight).toBe(41);
    expect(layouts[0].questionsTotalHeight).toBe(200);
    expect(layouts[0].questionOffsets).toEqual([0, 100]);

    // 第二段紧跟第一段：41 + 200 = 241
    expect(layouts[1].y).toBe(241);
    expect(layouts[1].questionOffsets).toEqual([0]);
  });

  it("未测量时回退到估算高度", () => {
    const sections: Section[] = [
      {
        header: {
          type: "header",
          id: "header-blank",
          questionType: "blank",
          count: 1,
        },
        questionItems: [
          {
            type: "question",
            id: "b1",
            question: q("b1", "blank"),
            indicator: null,
          },
        ],
      },
    ];
    // resolve 永远回退：header → ESTIMATED，blank 题 → 86
    const resolve: ResolveHeight = (_id, fallback) => fallback;
    const layouts = buildSectionLayouts(sections, resolve);
    expect(layouts[0].headerHeight).toBe(ESTIMATED_HEADER_HEIGHT);
    expect(layouts[0].questionsTotalHeight).toBe(estimateQuestionHeight(q("b1", "blank")));
  });
});

describe("getVisibleRange", () => {
  function layout(): SectionLayout {
    const sections = buildSections(buildFlatItems(groups()));
    const resolve = resolveFromMap({
      "header-judgment": 41,
      "header-single": 41,
      j1: 100,
      j2: 100,
      s1: 100,
    });
    return buildSectionLayouts(sections, resolve)[0];
  }

  it("视口在第一题上方缓冲外 → null", () => {
    const sec = layout();
    // section y=0，header 41，题目区 41..241。视口在 1000 处
    expect(getVisibleRange(sec, 1000, 400, resolveFromMap({}))).toBeNull();
  });

  it("视口覆盖第一题 → 返回包含首项的范围", () => {
    const sec = layout();
    const resolve = resolveFromMap({
      "header-judgment": 41,
      j1: 100,
      j2: 100,
    });
    const range = getVisibleRange(sec, 0, 200, resolve);
    expect(range).not.toBeNull();
    expect(range!.start).toBe(0);
    expect(range!.end).toBeGreaterThanOrEqual(0);
  });
});

describe("findQuestionTop", () => {
  it("返回让题目居中的 scrollTop", () => {
    const sections = buildSections(buildFlatItems(groups()));
    const resolve = resolveFromMap({
      "header-judgment": 41,
      "header-single": 41,
      j1: 100,
      j2: 100,
      s1: 100,
    });
    const layouts = buildSectionLayouts(sections, resolve);
    // j2: y=0, header=41, offset=100, height=100 → 41+100 - 200/2 + 100/2 = 141 - 100 + 50 = 91
    expect(findQuestionTop(layouts, "j2", 200, resolve)).toBe(91);
  });

  it("找不到题目 → null", () => {
    const layouts = buildSectionLayouts(
      buildSections(buildFlatItems(groups())),
      resolveFromMap({}),
    );
    expect(findQuestionTop(layouts, "nope", 400, resolveFromMap({}))).toBeNull();
  });
});

describe("buildIdToRank", () => {
  it("扁平序号映射", () => {
    const flat = buildFlatItems(groups());
    const rank = buildIdToRank(flat);
    expect(rank.get("header-judgment")).toBe(0);
    expect(rank.get("j1")).toBe(1);
    expect(rank.get("s1")).toBe(4);
  });
});
