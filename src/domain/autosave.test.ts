import { describe, expect, it } from "vitest";
import { shouldAutosave, type AutosaveConditions } from "./autosave";

const base: AutosaveConditions = { storageAvailable: true, corruptAtStart: false, recovered: false, changedInOtherTab: false };

describe("shouldAutosave", () => {
  it("通常は保存する", () => {
    expect(shouldAutosave(base)).toBe(true);
  });

  it("起動時に保存データを読めなかったら、回復するまで保存しない", () => {
    expect(shouldAutosave({ ...base, corruptAtStart: true })).toBe(false);
    expect(shouldAutosave({ ...base, corruptAtStart: true, recovered: true })).toBe(true);
  });

  it("他のタブで変わったら、回復していても保存しない", () => {
    expect(shouldAutosave({ ...base, changedInOtherTab: true })).toBe(false);
    expect(shouldAutosave({ ...base, corruptAtStart: true, recovered: true, changedInOtherTab: true })).toBe(false);
  });

  it("保存領域を使えなければ保存しない", () => {
    expect(shouldAutosave({ ...base, storageAvailable: false })).toBe(false);
  });
});
