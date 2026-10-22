import { describe, expect, it } from "vitest";
import { exportReminder, hasAnyData } from "./exportReminder";
import { createInitialState } from "./types";
import { fixtureRaw } from "./testState";
import { validateState } from "./validate";

const fixture = () => {
  const r = validateState(fixtureRaw());
  if (!r.ok) throw new Error(r.errors.join());
  return r.state;
};

describe("exportReminder", () => {
  it("初期状態では促さない。何か入力して一度も書き出していなければ促す", () => {
    expect(exportReminder(createInitialState(), new Date())).toEqual({ kind: "nothingYet" });
    const s = createInitialState();
    s.proposal.background = "背景だけ入力";
    expect(hasAnyData(s)).toBe(true);
    expect(exportReminder(s, new Date())).toEqual({ kind: "never" });
  });

  it("一度も書き出していなければ、確定済みの記録があっても never を出す", () => {
    expect(exportReminder({ ...fixture(), lastExportedAt: null }, new Date("2030-01-12T00:00:00.000Z"))).toEqual({ kind: "never" });
  });

  it("ベースラインの確定より前に書き出したきりなら促す", () => {
    const s = { ...fixture(), lastExportedAt: "2030-01-11T07:00:00.000Z" };
    expect(exportReminder(s, new Date("2030-01-11T09:00:00.000Z"))).toEqual({ kind: "afterRecord", record: "ベースラインv1の確定" });
  });

  it("週次スナップショットの作成後に書き出していなければ、7日未満でも促す", () => {
    const s = fixture(); // 書き出しは 2030-01-11T08:05Z
    s.evmSnapshots = [{
      id: "s1", baselineId: "b1", asOf: "2030-01-11", pv: 10, ev: 5, ac: 4, bac: 10,
      cpi: 1.25, spi: 0.5, eac: 8, consumptionRate: 0.4, progressRate: 0.5, createdAt: "2030-01-11T09:00:00.000Z",
    }];
    expect(exportReminder(s, new Date("2030-01-12T00:00:00.000Z"))).toEqual({ kind: "afterRecord", record: "週次スナップショット（2030-01-11）の作成" });
  });

  it("差戻しの記録の後に書き出していなければ促す", () => {
    const s = fixture();
    s.gateReviews.push({ ...s.gateReviews[0], id: "g2", decision: "returned", baselineId: null, operatedAt: "2030-01-11T10:00:00.000Z" });
    expect(exportReminder(s, new Date("2030-01-12T00:00:00.000Z"))).toEqual({ kind: "afterRecord", record: "G1+2の差戻し" });
  });

  it("確定と同じ時刻に書き出したなら、促さない（境界）", () => {
    const s = { ...fixture(), lastExportedAt: "2030-01-11T08:00:00.000Z" };
    expect(exportReminder(s, new Date("2030-01-11T09:00:00.000Z"))).toEqual({ kind: "ok" });
  });

  it("書き出してから7日以上たったら促し、6日なら促さない", () => {
    const s = fixture();
    expect(exportReminder(s, new Date("2030-01-17T08:05:00.000Z"))).toEqual({ kind: "ok" });
    expect(exportReminder(s, new Date("2030-01-18T08:05:00.000Z"))).toEqual({ kind: "stale", days: 7 });
  });

  it("書き出し日時が今より後なら、正しく判定できないので促す", () => {
    expect(exportReminder(fixture(), new Date("2030-01-01T00:00:00.000Z"))).toEqual({ kind: "futureExport" });
  });
});
