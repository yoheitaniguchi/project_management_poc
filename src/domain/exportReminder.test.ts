import { describe, expect, it } from "vitest";
import { exportReminder } from "./exportReminder";
import { createInitialState } from "./types";
import { fixtureRaw } from "./testState";
import { validateState } from "./validate";

const fixture = () => {
  const r = validateState(fixtureRaw());
  if (!r.ok) throw new Error(r.errors.join());
  return r.state;
};

describe("exportReminder", () => {
  it("初期状態では促さない。入力があって一度も書き出していなければ促す", () => {
    expect(exportReminder(createInitialState(), new Date())).toEqual({ kind: "nothingYet" });
    const s = { ...createInitialState(), project: { ...createInitialState().project, name: "案件" } };
    expect(exportReminder(s, new Date())).toEqual({ kind: "never" });
  });

  it("ベースラインの確定より前に書き出したきりなら促す", () => {
    const s = { ...fixture(), lastExportedAt: "2030-01-11T07:00:00.000Z" };
    expect(exportReminder(s, new Date("2030-01-11T09:00:00.000Z"))).toEqual({ kind: "afterBaseline", version: 1 });
  });

  it("書き出してから7日以上たったら促し、6日なら促さない", () => {
    const s = fixture(); // 書き出しは 2030-01-11T08:05Z、確定は 08:00Z
    expect(exportReminder(s, new Date("2030-01-17T08:05:00.000Z"))).toEqual({ kind: "ok" });
    expect(exportReminder(s, new Date("2030-01-18T08:05:00.000Z"))).toEqual({ kind: "stale", days: 7 });
  });
});
