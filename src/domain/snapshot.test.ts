// 週次スナップショット（5章）：基準日の初期値、作れない基準日、作成した値、作成後に変わらないこと、読み込み時の検証、CSV
import { describe, expect, it } from "vitest";
import { confirmBaseline, reviseBaseline } from "./baseline";
import { computeEvm } from "./evm";
import { frozenRecordChanges, migrate, parseStateText, serializeState } from "./persistence";
import type { OpResult } from "./proposal";
import { addMember, addObjective, updateMember } from "./proposal";
import {
  createSnapshot, defaultAsOf, latestSnapshot, previewSnapshot, snapshotAsOfError, snapshotCsv, snapshotCsvFileName,
  SNAPSHOT_CSV_HEADER, sortedSnapshots,
} from "./snapshot";
import { expectValidState, fixtureRaw } from "./testState";
import { createInitialState, type AppState, type TimeEntry } from "./types";
import { validateState } from "./validate";
import { expandTemplate, setEstimate, setExcluded, setTrace, targetWorkPackages, updateNode } from "./wbs";

const ids = () => {
  let n = 0;
  return () => `id${++n}`;
};
const okState = (r: OpResult): AppState => {
  if (!r.ok) throw new Error(r.error);
  expectValidState(r.state);
  return r.state;
};
/** 端末の地域の日時（月は0から） */
const at = (day: number, hour = 18, month = 9) => new Date(2026, month, day, hour, 0);

/**
 * 計画（v1、合意日 2026-10-26）：設計 10時間（10/26〜10/30）、開発 6時間（10/29〜11/03）。BAC＝16時間。
 * 実績：設計に 10/26 に 10時間（着手）
 */
function planned() {
  const id = ids();
  const now = at(26);
  let s = okState(addMember(createInitialState(), "pm", now, id));
  s = okState(updateMember(s, s.members[0].id, { name: "PM" }));
  s = okState(addObjective(s, id));
  s = okState(expandTemplate(s, id));
  const plan: Record<string, [number, string, string]> = {
    設計: [10, "2026-10-26", "2026-10-30"],
    開発: [6, "2026-10-29", "2026-11-03"],
  };
  for (const n of targetWorkPackages(s)) {
    const p = plan[n.name];
    if (!p) {
      s = okState(setExcluded(s, n.id, true, "例では使わない"));
      continue;
    }
    s = okState(setTrace(s, n.id, s.objectives[0].id, true, id));
    s = okState(setEstimate(s, n.id, { hours: p[0], basis: "" }, id));
    s = okState(updateNode(s, n.id, { plannedStart: p[1], plannedEnd: p[2] }));
  }
  s = okState(confirmBaseline(s, { approver: "監理者", approvedOn: "2026-10-26", comment: "" }, now, id));
  const A = s.wbsNodes.find((x) => x.name === "設計")!.id;
  const B = s.wbsNodes.find((x) => x.name === "開発")!.id;
  const entry: TimeEntry = {
    id: "te1", wbsNodeId: A, memberId: s.members[0].id, workDate: "2026-10-26", minutes: 600,
    source: "manual_csv", uniqueKey: `manual_csv:2026-10-26:${A}:テスト`,
  };
  s = { ...s, timeEntries: [entry] };
  expectValidState(s);
  return { s, id, A, B };
}

describe("defaultAsOf：基準日の初期値は直近の金曜日", () => {
  it.each([
    [26, "2026-10-23"], // 月
    [27, "2026-10-23"], // 火
    [29, "2026-10-23"], // 木
    [30, "2026-10-30"], // 金は当日
    [31, "2026-10-30"], // 土
  ])("2026-10-%i → %s", (day, expected) => {
    expect(defaultAsOf(at(day))).toBe(expected);
  });

  it("日曜日は前の金曜日。月をまたいでも数える", () => {
    expect(defaultAsOf(at(1, 9, 10))).toBe("2026-10-30");
  });

  it("端末の地域の日付で決める（0時ちょうど・23時台でも日付がずれない）", () => {
    expect(defaultAsOf(new Date(2026, 9, 30, 0, 0))).toBe("2026-10-30");
    expect(defaultAsOf(new Date(2026, 9, 29, 23, 59))).toBe("2026-10-23");
  });
});

describe("snapshotAsOfError：作れない基準日", () => {
  it("ベースラインが未確定なら作れない", () => {
    expect(snapshotAsOfError(createInitialState(), "2026-10-30", at(30))).toMatch(/ベースラインが未確定/);
  });

  it("日付でない・年が範囲外の基準日は作れない", () => {
    const { s } = planned();
    for (const bad of ["", "2026/10/30", "2026-02-30", "2100-01-01"]) {
      expect(snapshotAsOfError(s, bad, at(30))).toMatch(/基準日を入力/);
    }
  });

  it("未来の日付は作れない。今日ちょうどは作れる", () => {
    const { s } = planned();
    expect(snapshotAsOfError(s, "2026-10-31", at(30))).toMatch(/未来/);
    expect(snapshotAsOfError(s, "2026-10-30", at(30))).toBeNull();
  });

  it("今日は端末の地域の日付で決める（23:59 と 0:00 の境目）", () => {
    const { s } = planned();
    expect(snapshotAsOfError(s, "2026-10-30", new Date(2026, 9, 30, 0, 0))).toBeNull();
    expect(snapshotAsOfError(s, "2026-10-30", new Date(2026, 9, 29, 23, 59))).toMatch(/未来/);
    expect(snapshotAsOfError(s, "2026-10-29", new Date(2026, 9, 29, 23, 59))).toBeNull();
  });

  it("最新の版の合意日より前は作れない。合意日ちょうどは作れる", () => {
    const { s } = planned();
    expect(snapshotAsOfError(s, "2026-10-23", at(30))).toMatch(/v1）の合意日（2026-10-26）より前/);
    expect(snapshotAsOfError(s, "2026-10-26", at(30))).toBeNull();
  });

  it("同じ基準日・同じ版のスナップショットは2件目を作れない", () => {
    const { s, id } = planned();
    const once = okState(createSnapshot(s, "2026-10-30", at(30), id));
    expect(snapshotAsOfError(once, "2026-10-30", at(30))).toMatch(/作成済み/);
    expect(createSnapshot(once, "2026-10-30", at(30), id)).toEqual({ ok: false, error: expect.stringMatching(/作成済み/) });
  });

  it("改版した後は、同じ基準日を新しい版で作れる。新しい版の合意日より前は作れない", () => {
    const { s, id, B } = planned();
    const v1 = okState(createSnapshot(s, "2026-10-30", at(30), id));
    const v2 = okState(
      reviseBaseline(v1, { approver: "監理者", approvedOn: "2026-10-30", comment: "", revisionReason: "開発を外す", exclusions: [{ wbsNodeId: B, reason: "範囲外" }] }, at(30, 19), id),
    );
    expect(snapshotAsOfError(v2, "2026-10-30", at(30, 20))).toBeNull();
    expect(snapshotAsOfError(v2, "2026-10-29", at(30, 20))).toMatch(/v2）の合意日（2026-10-30）より前/);
    const both = okState(createSnapshot(v2, "2026-10-30", at(30, 20), id));
    expect(both.evmSnapshots.map((e) => e.baselineId)).toEqual([v1.baselines[0].id, v2.baselines[1].id]);
  });
});

describe("createSnapshot：作成した値", () => {
  it("基準日の簡易EVMの値と、作成時の閾値・ずれ・要対応を記録する", () => {
    const { s, id } = planned();
    const next = okState(createSnapshot(s, "2026-10-27", at(27), id));
    const evm = computeEvm(s, "2026-10-27")!;
    expect(next.evmSnapshots).toHaveLength(1);
    const snap = next.evmSnapshots[0];
    // PV：設計 2日分＝4時間。EV：設計は着手＝5時間。AC：10時間
    expect(snap).toEqual({
      id: expect.any(String), baselineId: s.baselines[0].id, asOf: "2026-10-27",
      pv: 4, ev: 5, ac: 10, bac: 16, cpi: evm.cpi, spi: evm.spi, eac: evm.eac,
      consumptionRate: 10 / 16, progressRate: 5 / 16,
      gapPoints: 31, thresholdPoints: 5, alert: true, createdAt: at(27).toISOString(),
    });
    // 監査ログには記録しない（人間の判断）
    expect(next.auditLogs).toEqual(s.auditLogs);
  });

  it("算出できない指標は null のまま記録する（実績0：CPI・EAC が無い）", () => {
    const { s, id } = planned();
    const noActuals = { ...s, timeEntries: [] };
    const next = okState(createSnapshot(noActuals, "2026-10-26", at(26), id));
    const snap = next.evmSnapshots[0];
    expect([snap.cpi, snap.eac, snap.ac]).toEqual([null, null, 0]);
    expect(snap.spi).toBe(0); // PV＝2時間・EV＝0
  });

  it("要対応の境界：ずれ5ポイントは要対応にせず、6ポイントで要対応（閾値5）", () => {
    const { s, id } = planned();
    // 設計は着手（EV 5時間）、BAC 16時間。ずれ＝（AC − 5）÷ 16 × 100：AC 348分＝5.8時間で5ポイント、358分≒5.97時間で6ポイント
    const withMinutes = (minutes: number): AppState => ({ ...s, timeEntries: [{ ...s.timeEntries[0], minutes }] });
    const five = okState(createSnapshot(withMinutes(348), "2026-10-26", at(26), id)).evmSnapshots[0];
    const six = okState(createSnapshot(withMinutes(358), "2026-10-26", at(26), id)).evmSnapshots[0];
    expect([five.gapPoints, five.alert]).toEqual([5, false]);
    expect([six.gapPoints, six.alert]).toEqual([6, true]);
  });

  it("閾値を後で変えても、記録した週の要対応は変わらず、読み込みも拒否されない", () => {
    const { s, id } = planned();
    const next = okState(createSnapshot(s, "2026-10-27", at(27), id));
    const raised = { ...next, settings: { ...next.settings, alertThresholdPoints: 50 } };
    expectValidState(raised);
    expect([raised.evmSnapshots[0].thresholdPoints, raised.evmSnapshots[0].alert]).toEqual([5, true]);
  });

  it("previewSnapshot は記録せずに値を返す", () => {
    const { s } = planned();
    const p = previewSnapshot(s, "2026-10-27", at(27));
    expect(p.ok && p.evm.ac).toBe(10);
    expect(s.evmSnapshots).toHaveLength(0);
    expect(previewSnapshot(s, "2026-10-31", at(30))).toEqual({ ok: false, error: expect.stringMatching(/未来/) });
  });
});

describe("最新のスナップショットと並び順", () => {
  it("作成した順ではなく、基準日の順に並べる。最新は基準日が最も新しいもの", () => {
    const { s, id } = planned();
    let next = okState(createSnapshot(s, "2026-10-30", at(30), id));
    next = okState(createSnapshot(next, "2026-10-27", at(30, 19), id));
    expect(sortedSnapshots(next).map((e) => e.asOf)).toEqual(["2026-10-27", "2026-10-30"]);
    expect(latestSnapshot(next)?.asOf).toBe("2026-10-30");
    expect(latestSnapshot(s)).toBeNull();
  });
});

describe("作成後は変更しない（読み込み時の検証）", () => {
  function withSnapshot() {
    const p = planned();
    return { ...p, s: okState(createSnapshot(p.s, "2026-10-27", at(27), p.id)) };
  }
  const errorsOf = (s: AppState) => {
    const r = validateState(s);
    return r.ok ? "" : r.errors.join("\n");
  };

  it("JSONに書き出して読み込むと元に戻る", () => {
    const { s } = withSnapshot();
    const parsed = parseStateText(serializeState(s));
    expect(parsed.ok && parsed.state).toEqual(s);
  });

  it("記録したスナップショットを書き換えたデータは、置き換えとして扱う", () => {
    const { s } = withSnapshot();
    const changed = structuredClone(s);
    changed.evmSnapshots[0].thresholdPoints = 50;
    changed.evmSnapshots[0].alert = false;
    expect(frozenRecordChanges(s, changed).join("\n")).toMatch(/週次スナップショット/);
  });

  it("指標・ずれ・要対応が記録した値と合わないデータは拒否する", () => {
    const { s } = withSnapshot();
    const mutate = (f: (e: AppState["evmSnapshots"][number]) => void) => {
      const c = structuredClone(s);
      f(c.evmSnapshots[0]);
      return errorsOf(c);
    };
    expect(mutate((e) => (e.cpi = 2))).toMatch(/指標・ずれ・要対応が/);
    expect(mutate((e) => (e.alert = false))).toMatch(/指標・ずれ・要対応が/);
    expect(mutate((e) => (e.gapPoints = 30))).toMatch(/指標・ずれ・要対応が/);
    expect(mutate((e) => (e.eac = null))).toMatch(/指標・ずれ・要対応が/);
    expect(mutate((e) => (e.gapPoints = 31.5))).toMatch(/gapPoints：整数ではありません/);
    expect(mutate((e) => (e.thresholdPoints = 101))).toMatch(/thresholdPoints：上限（100）を超えています/);
    expect(mutate((e) => (e.thresholdPoints = 4.5))).toMatch(/thresholdPoints：整数ではありません/);
    expect(mutate((e) => (e.thresholdPoints = -1))).toMatch(/thresholdPoints：0未満です/);
  });

  it("BAC が明細と合わない、PV・EV が BAC を超えるデータは、指標をそろえて書き換えても拒否する", () => {
    const { s } = withSnapshot();
    // 4つの値を2倍にすると、指標・ずれ・要対応は元のまま合う
    const doubled = structuredClone(s);
    const e = doubled.evmSnapshots[0];
    [e.bac, e.pv, e.ev, e.ac] = [e.bac * 2, e.pv * 2, e.ev * 2, e.ac * 2];
    e.eac = e.eac === null ? null : e.eac * 2;
    expect(errorsOf(doubled)).toBe("evmSnapshots[0]：BAC が版v1の明細の計画工数の合計と合いません");
    const over = structuredClone(s);
    over.evmSnapshots[0].ev = 17;
    expect(errorsOf(over)).toMatch(/PV・EV が BAC を超えています/);
  });

  it("同じ基準日・同じ版の重複、作成日時の逆転、基準日が作成日より後のデータは拒否する", () => {
    const { s } = withSnapshot();
    const dup = structuredClone(s);
    dup.evmSnapshots.push({ ...dup.evmSnapshots[0], id: "dup" });
    expect(errorsOf(dup)).toMatch(/重複しています/);

    const p = planned();
    let two = okState(createSnapshot(p.s, "2026-10-27", at(28), p.id));
    two = okState(createSnapshot(two, "2026-10-26", at(28, 19), p.id));
    const reversed = structuredClone(two);
    // 2件目の作成日時を、確定より後で1件目より前にする（逆転だけを確かめる）
    reversed.evmSnapshots[1].createdAt = new Date(Date.parse(two.evmSnapshots[0].createdAt) - 1).toISOString();
    expect(errorsOf(reversed)).toBe("evmSnapshots[1]：作成日時が前のスナップショットより前です");

    // 基準日は、作成日時の UTC の日付＋1日まで受け付ける（作成日時は確定より後にする）
    const future = structuredClone(s);
    const created = future.evmSnapshots[0].createdAt;
    const plusDays = (n: number) => new Date(Date.parse(`${created.slice(0, 10)}T00:00:00Z`) + n * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    future.evmSnapshots[0].asOf = plusDays(1);
    expect(errorsOf(future)).toBe("");
    future.evmSnapshots[0].asOf = plusDays(2);
    expect(errorsOf(future)).toBe("evmSnapshots[0]：基準日が作成日より後です");
  });

  it("日本時間の朝（UTCでは前日）に作ったスナップショットも受け付ける", () => {
    const { s } = withSnapshot();
    const jst = structuredClone(s);
    // 例：日本時間 10/27 07:00 ＝ UTC 10/26 22:00 に、基準日 10/27 で作った。テストを実行する端末の時間帯によらないよう、
    // 作成日時を確定の1時間後にし、基準日をその UTC の日付の翌日にする
    const created = new Date(Date.parse(s.baselines[0].operatedAt) + 60 * 60 * 1000);
    jst.evmSnapshots[0].createdAt = created.toISOString();
    jst.evmSnapshots[0].asOf = new Date(Date.parse(`${created.toISOString().slice(0, 10)}T00:00:00Z`) + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    expect(errorsOf(jst)).toBe("");
  });

  it("作成した時点で最新でない版を基準にしたデータ、基準日がその版の合意日より前のデータは拒否する", () => {
    const { s, id, B } = planned();
    const v2 = okState(
      reviseBaseline(s, { approver: "監理者", approvedOn: "2026-10-28", comment: "", revisionReason: "開発を外す", exclusions: [{ wbsNodeId: B, reason: "範囲外" }] }, at(28), id),
    );
    const snap = okState(createSnapshot(v2, "2026-10-29", at(29), id));
    const old = structuredClone(snap);
    old.evmSnapshots[0].baselineId = v2.baselines[0].id; // v2 の確定の後に作ったのに v1 を指す
    expect(errorsOf(old)).toMatch(/最新の版を基準にしていません/);
    // 境界：改版の確定と同じ時刻に作ったものは v2 を基準にする。1ミリ秒前なら v1 を基準にしてよい
    const v2At = Date.parse(v2.baselines[1].operatedAt);
    const sameTime = structuredClone(old);
    sameTime.evmSnapshots[0].createdAt = new Date(v2At).toISOString();
    expect(errorsOf(sameTime)).toMatch(/最新の版を基準にしていません/);
    const before = structuredClone(old);
    before.evmSnapshots[0].createdAt = new Date(v2At - 1).toISOString();
    before.evmSnapshots[0].asOf = "2026-10-28";
    expect(errorsOf(before)).not.toMatch(/最新の版を基準にしていません/);
    const early = structuredClone(snap);
    early.evmSnapshots[0].asOf = "2026-10-27";
    expect(errorsOf(early)).toMatch(/版v2の合意日より前/);
  });
});

describe("版2 → 3 の移行", () => {
  it("スナップショットの無い版2のデータは、そのまま版3になる", () => {
    const raw = fixtureRaw();
    const v2 = { ...raw, schemaVersion: 2 };
    const r = migrate(v2, undefined, 3);
    expect(r.ok && (r.value as Record<string, unknown>).schemaVersion).toBe(3);
  });

  it("スナップショットのある版2のデータは、作成時の閾値が分からないので移行しない", () => {
    const raw = { ...fixtureRaw(), schemaVersion: 2, evmSnapshots: [{ id: "s1" }] };
    expect(migrate(raw)).toEqual({ ok: false, error: expect.stringMatching(/週次スナップショットがあります/) });
  });
});

describe("snapshotCsv：現状値の採取のためのCSV", () => {
  it("基準日の順に、丸めた値を書く。算出できない値は空欄、負のずれは数値のまま", () => {
    const { s, id } = planned();
    let next = okState(createSnapshot({ ...s, timeEntries: [] }, "2026-10-26", at(26), id));
    next = { ...next, timeEntries: s.timeEntries };
    next = okState(createSnapshot(next, "2026-10-27", at(27), id));
    const lines = snapshotCsv(next).split("\r\n");
    expect(lines[0]).toBe(SNAPSHOT_CSV_HEADER.join(","));
    // 10/26：実績0（CPI・EAC は空欄）、PV 2・EV 0・AC 0。ずれ 0
    expect(lines[1]).toBe(`2026-10-26,v1,16,2,0,0,,0,,0,0,0,5,,2026-10-26 18:00`);
    // 10/27：PV 4・EV 5・AC 10。CPI 0.5、SPI 1.25、EAC 32、消化率 62.5%、進捗率 31.3%、ずれ 31
    expect(lines[2]).toBe(`2026-10-27,v1,16,4,5,10,0.5,1.25,32,62.5,31.3,31,5,要対応,2026-10-27 18:00`);
    expect(lines).toHaveLength(4); // 末尾の改行
  });

  it("[@security] 負のずれは、数式の対策で ' を付けた文字にならない", () => {
    const { s, id, B } = planned();
    // 設計・開発とも着手（EV 8時間）で、AC は2時間 → ずれは負
    const entries: TimeEntry[] = [
      { ...s.timeEntries[0], minutes: 60 },
      { ...s.timeEntries[0], id: "te2", wbsNodeId: B, workDate: "2026-10-29", minutes: 60, uniqueKey: `manual_csv:2026-10-29:${B}:テスト` },
    ];
    const next = okState(createSnapshot({ ...s, timeEntries: entries }, "2026-10-29", at(29), id));
    expect(next.evmSnapshots[0].gapPoints).toBeLessThan(0);
    const row = snapshotCsv(next).split("\r\n")[1];
    expect(row).toContain(`,${next.evmSnapshots[0].gapPoints},`);
    expect(row).not.toContain("'-");
  });

  it("[@security] 巨大な工数のスナップショットは読み込みで拒否する（CSVに丸めて書けなくならないように）", () => {
    const raw = structuredClone(okState(createSnapshot(planned().s, "2026-10-27", at(27), ids())));
    const e = raw.evmSnapshots[0];
    [e.bac, e.pv, e.ev, e.ac] = [1e307, 1e307, 1e307, 1e307];
    const r = validateState(raw);
    expect(r.ok ? "" : r.errors.join("\n")).toMatch(/bac：上限（100000000）を超えています/);
  });

  it("ファイル名は pmpoc- で始まり、端末の地域の日付を付ける", () => {
    expect(snapshotCsvFileName(at(30))).toBe("pmpoc-evm-snapshots-20261030.csv");
  });
});
