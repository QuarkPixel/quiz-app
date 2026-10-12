import { describe, expect, test } from "vitest";
import { stripDeviceLocal, SYNCED_BANK_FIELDS } from "@/features/sync/model/policy";
describe("s", () => {
  test("strip", () => {
    console.log("SYNCED_BANK_FIELDS =", JSON.stringify(SYNCED_BANK_FIELDS));
    const state = { currentRound: 1, memory: { progress: { q1: { level: 2 } }, settings: { graduateLevel: 7 } } };
    console.log("strip 结果 =", JSON.stringify(stripDeviceLocal(state)));
    expect(true).toBe(true);
  });
});
