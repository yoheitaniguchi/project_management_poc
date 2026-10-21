import { describe, expect, it } from "vitest";
import { parseStateText } from "./persistence";
import { reducer } from "./reducer";
import { fixtureText } from "./testState";
import { createInitialState, type AppState } from "./types";
import { validateState } from "./validate";

const fixtureState = (): AppState => {
  const r = parseStateText(fixtureText());
  if (!r.ok) throw new Error(r.errors.join());
  return r.state;
};

describe("reducer", () => {
  it("replaceState：追記だけのデータは受け付ける", () => {
    const next = reducer(createInitialState(), { type: "replaceState", state: fixtureState() });
    expect(next).toEqual(fixtureState());
  });

  it("replaceState：確定済みの記録を変えるデータは、利用者が置き換えを確認したとき（allowReplace）だけ受け付ける", () => {
    const current = fixtureState();
    const other = { ...createInitialState(), project: { ...current.project, name: "別の案件", pmMemberId: null } };
    expect(reducer(current, { type: "replaceState", state: other })).toBe(current);
    expect(reducer(current, { type: "replaceState", state: other, allowReplace: true })).toEqual(other);
  });

  it("replaceState：検証に通らないデータは、allowReplace でも受け付けない", () => {
    const current = createInitialState();
    const bad = fixtureState();
    bad.baselineItems = [];
    expect(reducer(current, { type: "replaceState", state: bad, allowReplace: true })).toBe(current);
  });

  it("markExported：書き出した日時を UTC の ISO 形式で記録し、検証に通る", () => {
    const next = reducer(fixtureState(), { type: "markExported", at: new Date("2030-01-12T03:04:05.006Z") });
    expect(next.lastExportedAt).toBe("2030-01-12T03:04:05.006Z");
    expect(validateState(next).ok).toBe(true);
  });

  it("reset：初期状態に戻す", () => {
    expect(reducer(fixtureState(), { type: "reset" })).toEqual(createInitialState());
  });
});
