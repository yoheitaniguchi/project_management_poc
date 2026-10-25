// 実績工数の個人別表示の権限（4章）：本人とPMのみ
import { describe, expect, it } from "vitest";
import { canViewPersonalActuals, currentViewer, personalActuals } from "./access";
import { addMember, changeRole, updateMember, type OpResult } from "./proposal";
import { createInitialState, type AppState, type TimeEntry } from "./types";

const ids = () => {
  let n = 0;
  return () => `id${++n}`;
};
const okState = (r: OpResult): AppState => {
  if (!r.ok) throw new Error(r.error);
  return r.state;
};
const NOW = new Date(2026, 9, 26, 18, 0);

/** PM と メンバー A・B。実績は PM 2時間、A 1.5時間（うち 0.5時間は基準日の後）、メンバーの無い実績 1時間 */
function team() {
  const id = ids();
  let s = okState(addMember(createInitialState(), "pm", NOW, id));
  s = okState(addMember(s, "member", NOW, id));
  s = okState(addMember(s, "member", NOW, id));
  const [pm, a, b] = s.members.map((m) => m.id);
  s = okState(updateMember(s, pm, { name: "PM" }));
  s = okState(updateMember(s, a, { name: "A" }));
  s = okState(updateMember(s, b, { name: "B" }));
  const entry = (memberId: string | null, workDate: string, minutes: number, n: number): TimeEntry => ({
    id: `te${n}`, wbsNodeId: "w", memberId, workDate, minutes, source: "asana_csv", uniqueKey: `k${n}`,
  });
  s = { ...s, timeEntries: [entry(pm, "2026-10-26", 120, 1), entry(a, "2026-10-27", 60, 2), entry(a, "2026-10-31", 30, 3), entry(null, "2026-10-27", 60, 4)] };
  return { s, pm, a, b };
}

describe("canViewPersonalActuals：本人とPMのみ", () => {
  it("[@security] PMは全員（メンバーの無い実績を含む）を見られる", () => {
    const { s, pm, a, b } = team();
    expect([pm, a, b, null].map((t) => canViewPersonalActuals(s, pm, t))).toEqual([true, true, true, true]);
  });

  it("[@security] PM以外は本人だけ。他人とメンバーの無い実績は見られない", () => {
    const { s, pm, a, b } = team();
    expect([pm, a, b, null].map((t) => canViewPersonalActuals(s, a, t))).toEqual([false, true, false, false]);
  });

  it("[@security] 閲覧者が分からない（null）・登録されていないメンバーは、誰も見られない", () => {
    const { s, a } = team();
    expect(canViewPersonalActuals(s, null, a)).toBe(false);
    expect(canViewPersonalActuals(s, "nobody", "nobody")).toBe(false);
  });

  it("閲覧者は体制のPM（自己申告）。PMが未設定なら null で、誰も見られない", () => {
    const { s, pm } = team();
    expect(currentViewer(s)).toBe(pm);
    const noPm = { ...s, project: { ...s.project, pmMemberId: null } };
    expect(currentViewer(noPm)).toBeNull();
    expect(personalActuals(noPm, currentViewer(noPm), "2026-10-30")).toEqual([]);
  });

  it("[@security] 役割の変更が判定に反映される：PMを外すと他人の実績は見られず、新しいPMは全員分を見られる", () => {
    const { s, pm, a, b } = team();
    let next = okState(changeRole(s, pm, "member", NOW, ids()));
    expect(canViewPersonalActuals(next, pm, a)).toBe(false);
    expect(canViewPersonalActuals(next, pm, pm)).toBe(true);
    next = okState(changeRole(next, a, "pm", NOW, ids()));
    expect(currentViewer(next)).toBe(a);
    expect([pm, a, b, null].map((t) => canViewPersonalActuals(next, a, t))).toEqual([true, true, true, true]);
  });
});

describe("personalActuals：基準日までのメンバー別の合計（判定を通したものだけ）", () => {
  it("PMには全員分。基準日の後の実績は含めない", () => {
    const { s, pm } = team();
    expect(personalActuals(s, pm, "2026-10-30")).toEqual([
      { memberId: null, name: "（メンバーなし）", role: null, hours: 1 },
      { memberId: s.members[1].id, name: "A", role: "member", hours: 1 },
      { memberId: pm, name: "PM", role: "pm", hours: 2 },
    ]);
  });

  it("[@security] メンバー A には本人の分だけを出し、ほかのメンバーは人数も出さない", () => {
    const { s, a } = team();
    expect(personalActuals(s, a, "2026-10-31")).toEqual([{ memberId: a, name: "A", role: "member", hours: 1.5 }]);
  });
});
