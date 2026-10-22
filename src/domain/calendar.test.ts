import { describe, expect, it } from "vitest";
import { businessDays, isBusinessDay, localDate } from "./calendar";

describe("営業日（5章：土日と設定の祝日を除く）", () => {
  it("土日を除き、開始日と終了日の両方を含む", () => {
    // 2026-10-24（土）〜2026-11-02（月）
    expect(businessDays("2026-10-24", "2026-11-02", [])).toEqual([
      "2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30", "2026-11-02",
    ]);
    expect(isBusinessDay("2026-10-25", [])).toBe(false);
    expect(isBusinessDay("2026-10-26", [])).toBe(true);
  });

  it("設定の祝日を除く", () => {
    expect(businessDays("2026-11-02", "2026-11-04", ["2026-11-03"])).toEqual(["2026-11-02", "2026-11-04"]);
  });

  it("土日だけ・祝日だけの期間は営業日が無い。開始日が終了日より後なら空", () => {
    expect(businessDays("2026-10-24", "2026-10-25", [])).toEqual([]);
    expect(businessDays("2026-11-03", "2026-11-03", ["2026-11-03"])).toEqual([]);
    expect(businessDays("2026-10-30", "2026-10-26", [])).toEqual([]);
  });

  it("月・年をまたいでも数えられる", () => {
    expect(businessDays("2026-12-31", "2027-01-04", [])).toEqual(["2026-12-31", "2027-01-01", "2027-01-04"]);
  });

  it("端末の時刻での日付", () => {
    expect(localDate(new Date(2026, 9, 26, 23, 59))).toBe("2026-10-26");
  });
});
