import { describe, expect, it } from "vitest";
import { createInitialState } from "./types";
import { isValidDate, validateState } from "./validate";
import { fixtureRaw } from "./testState";

describe("validateState：正しいデータ", () => {
  it("初期状態を受け付ける", () => {
    expect(validateState(createInitialState())).toEqual({ ok: true, state: createInitialState() });
  });

  it("1週目の形の素材（架空データ）を受け付け、内容を保つ", () => {
    const raw = fixtureRaw();
    const result = validateState(raw);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.state).toEqual(raw);
  });
});

describe("validateState：整合性（4章のルール）", () => {
  const errorsOf = (mutate: (raw: Record<string, unknown>) => void) => {
    const raw = fixtureRaw();
    mutate(raw);
    const result = validateState(raw);
    return result.ok ? "" : result.errors.join("\n");
  };
  const list = (raw: Record<string, unknown>, key: string) => raw[key] as Record<string, unknown>[];
  /** v2 を正しく足す（各テストはここから1か所だけ壊す） */
  const addV2 = (r: Record<string, unknown>) => {
    list(r, "baselines").push({ ...list(r, "baselines")[0], id: "b2", version: 2, gate: "改版", revisionReason: "テスト用の改版" });
    list(r, "baselineItems").push({ ...list(r, "baselineItems")[0], id: "bi2", baselineId: "b2" });
    list(r, "auditLogs").push({ ...list(r, "auditLogs")[0], id: "a2", seq: 2, targetId: "b2", action: "baseline.revise" });
  };

  it("正しく改版した v2 を受け付ける", () => {
    expect(errorsOf(addV2)).toBe("");
  });

  it("ベースラインの版番号が連番でないと拒否する", () => {
    expect(errorsOf((r) => (list(r, "baselines")[0].version = 2))).toMatch(/baselines：版番号が1から連番/);
  });

  it("v2以降に改版理由が無いと拒否する", () => {
    expect(errorsOf((r) => (addV2(r), (list(r, "baselines")[1].revisionReason = null)))).toMatch(/v2に改版理由がありません/);
  });

  it("v1は確定、v2以降は改版の監査ログが要る", () => {
    expect(errorsOf((r) => (r.auditLogs = []))).toMatch(/v1の確定の監査ログがありません/);
    expect(errorsOf((r) => (addV2(r), (list(r, "auditLogs")[1].action = "baseline.confirm")))).toMatch(/v2の改版の監査ログがありません/);
  });

  it("v1に対応するG1+2承認の記録が要る", () => {
    expect(errorsOf((r) => (r.gateReviews = []))).toMatch(/v1に対応するG1\+2承認の記録がありません/);
  });

  it("明細が無い版・計画工数0の明細を拒否する", () => {
    expect(errorsOf((r) => (r.baselineItems = []))).toMatch(/v1に明細がありません/);
    expect(errorsOf((r) => (list(r, "baselineItems")[0].plannedHours = 0))).toMatch(/baselineItems\[0\]：計画工数が0です/);
  });

  it("承認済みの企画に承認日が無いと拒否する", () => {
    expect(errorsOf((r) => ((r.proposal as Record<string, unknown>).approvedOn = null))).toMatch(/承認済みなのに承認日がありません/);
  });

  it("承認（v1）と企画の状態が食い違うと拒否する", () => {
    expect(errorsOf((r) => ((r.proposal as Record<string, unknown>).status = "draft"))).toMatch(/v1があるのに承認済みになっていません/);
    expect(
      errorsOf((r) => {
        r.baselines = [];
        r.baselineItems = [];
        r.gateReviews = [];
        r.auditLogs = [];
      }),
    ).toMatch(/ベースラインが無いのに承認済み/);
  });

  it("体制の食い違い（PMが2名・PMの不一致・体制の記録の欠け・重複）を拒否する", () => {
    expect(errorsOf((r) => list(r, "projectMembers").push({ id: "pm2", memberId: "m1", role: "member" }))).toMatch(/体制の記録が重複/);
    expect(errorsOf((r) => (r.projectMembers = []))).toMatch(/体制（役割）の記録がありません/);
    expect(errorsOf((r) => ((r.project as Record<string, unknown>).pmMemberId = null))).toMatch(/役割がPMのメンバーと一致しません/);
    expect(
      errorsOf((r) => {
        list(r, "members").push({ id: "m2", name: "x", affiliation: "internal", asanaUserGid: null });
        list(r, "projectMembers").push({ id: "pm2", memberId: "m2", role: "pm" });
      }),
    ).toMatch(/PMが2名以上/);
  });

  it("監査ログの連番が飛んでいると拒否する", () => {
    expect(errorsOf((r) => (list(r, "auditLogs")[0].seq = 2))).toMatch(/auditLogs\[0\]：連番が1ではありません/);
  });

  it("参照切れを拒否する", () => {
    expect(errorsOf((r) => (list(r, "baselineItems")[0].wbsNodeId = "nope"))).toMatch(/baselineItems\[0\]\.wbsNodeId：存在しない/);
    expect(errorsOf((r) => (list(r, "gateReviews")[0].baselineId = "nope"))).toMatch(/gateReviews\[0\]\.baselineId：存在しない/);
    expect(errorsOf((r) => (list(r, "estimates")[0].standardId = "nope"))).toMatch(/estimates\[0\]\.standardId：存在しない/);
    expect(errorsOf((r) => ((r.project as Record<string, unknown>).pmMemberId = "nope"))).toMatch(/project\.pmMemberId：存在しない/);
    const snapshot = {
      id: "s1", baselineId: "nope", asOf: "2030-01-11", pv: 0, ev: 0, ac: 0, bac: 10,
      cpi: null, spi: null, eac: null, consumptionRate: 0, progressRate: 0, createdAt: "2030-01-11T09:00:00.000Z",
    };
    expect(errorsOf((r) => (r.evmSnapshots = [snapshot]))).toMatch(/evmSnapshots\[0\]\.baselineId：存在しない/);
    const entry = { id: "te1", wbsNodeId: "nope", memberId: null, workDate: "2030-01-08", minutes: 60, source: "manual_csv", uniqueKey: "k1" };
    expect(errorsOf((r) => (r.timeEntries = [entry]))).toMatch(/timeEntries\[0\]\.wbsNodeId：存在しない/);
  });

  it("計画開始日が計画終了日より後なら拒否する", () => {
    expect(errorsOf((r) => (list(r, "wbsNodes")[1].plannedStart = "2030-02-01"))).toMatch(/wbsNodes\[1\]：計画開始日/);
    expect(errorsOf((r) => (list(r, "baselineItems")[0].plannedStart = "2030-02-01"))).toMatch(/baselineItems\[0\]：計画開始日/);
  });

  it("IDの重複を拒否する", () => {
    expect(errorsOf((r) => list(r, "objectives").push({ ...list(r, "objectives")[0] }))).toMatch(/objectives：ID「o1」が重複/);
  });

  it("TimeEntryの一意キーの重複を拒否する", () => {
    const entry = { id: "te1", wbsNodeId: "n2", memberId: "m1", workDate: "2030-01-08", minutes: 60, source: "manual_csv", uniqueKey: "k1" };
    expect(errorsOf((r) => (r.timeEntries = [entry, { ...entry, id: "te2" }]))).toMatch(/一意キー「k1」が重複/);
  });

  it("書き出し日時の形式を確かめる", () => {
    expect(errorsOf((r) => (r.lastExportedAt = "2030/01/11"))).toMatch(/lastExportedAt：日時/);
  });

  it("承認者・操作者が自己申告であることの記録が欠けたら拒否する", () => {
    expect(errorsOf((r) => (list(r, "baselines")[0].approverSelfDeclared = false))).toMatch(/approverSelfDeclared/);
    expect(errorsOf((r) => (list(r, "gateReviews")[0].reviewerSelfDeclared = false))).toMatch(/reviewerSelfDeclared/);
  });
});

describe("isValidDate", () => {
  it.each([
    ["2030-01-31", true],
    ["2030-02-29", false],
    ["2028-02-29", true],
    ["2030-1-01", false],
    ["2030-13-01", false],
  ])("%s → %s", (s, expected) => {
    expect(isValidDate(s)).toBe(expected);
  });
});

describe("validateState：WBS・見積・紐付けの規則（版2）", () => {
  const errorsOf = (mutate: (raw: Record<string, unknown>) => void) => {
    const raw = fixtureRaw();
    mutate(raw);
    const result = validateState(raw);
    return result.ok ? "" : result.errors.join("\n");
  };
  const list = (raw: Record<string, unknown>, key: string) => raw[key] as Record<string, unknown>[];
  const node = (raw: Record<string, unknown>, id: string) => {
    const n = list(raw, "wbsNodes").find((x) => x.id === id);
    if (!n) throw new Error(id);
    return n;
  };

  it("WBSコードの重複を拒否する", () => {
    expect(errorsOf((r) => (node(r, "n3").code = "1.1"))).toMatch(/WBSコード「1.1」が重複/);
  });

  it.each(["", " 1.1", "1.1 ", "=1+1", "+1", "-1", "@x", "1\n2", "a".repeat(41)])("WBSコードの形式の誤りを拒否する（%j）", (code) => {
    expect(errorsOf((r) => (node(r, "n2").code = code))).toMatch(/WBSコードの形式/);
  });

  it("必須WPの重複・phase への付与・知らない値・作業区分の誤りを拒否する", () => {
    const withKeys = (r: Record<string, unknown>) => {
      node(r, "n3").requiredKey = "operation_design";
    };
    expect(errorsOf(withKeys)).toBe("");
    expect(
      errorsOf((r) => {
        withKeys(r);
        node(r, "n2").category = "operation_transition";
        node(r, "n2").requiredKey = "operation_design";
      }),
    ).toMatch(/必須WP「operation_design」が重複/);
    expect(errorsOf((r) => (node(r, "n1").requiredKey = "threat_analysis"))).toMatch(/必須WPがWPではありません/);
    expect(errorsOf((r) => (node(r, "n3").requiredKey = "unknown_key"))).not.toBe("");
    expect(errorsOf((r) => (node(r, "n2").requiredKey = "threat_analysis"))).toMatch(/必須WPの作業区分/);
  });

  it("対象外なのに理由が空、WPの下の要素を拒否する", () => {
    expect(errorsOf((r) => (node(r, "n3").excludedReason = " "))).toMatch(/対象外の理由がありません/);
    expect(errorsOf((r) => (node(r, "n3").parentId = "n2"))).toMatch(/WPの下に要素は置けません/);
  });

  it("見積の重複・phase への見積を拒否する", () => {
    expect(errorsOf((r) => list(r, "estimates").push({ ...list(r, "estimates")[0], id: "e2" }))).toMatch(/見積が重複/);
    expect(errorsOf((r) => list(r, "estimates").push({ ...list(r, "estimates")[0], id: "e2", wbsNodeId: "n1" }))).toMatch(/phase に見積/);
  });

  /** v2（改版）を正しく足す */
  const withV2 = (r: Record<string, unknown>, approvedOn = "2030-01-08") => {
    list(r, "baselines").push({ ...list(r, "baselines")[0], id: "b2", version: 2, gate: "改版", approvedOn, revisionReason: "テスト用の改版" });
    list(r, "baselineItems").push({ ...list(r, "baselineItems")[0], id: "bi2", baselineId: "b2" });
    list(r, "auditLogs").push({ ...list(r, "auditLogs")[0], id: "a2", seq: 2, targetId: "b2", action: "baseline.revise" });
  };

  it("対象外のWPは、最新の版の明細には入れられないが、過去の版の明細には残ってよい（改版で外したWP）", () => {
    expect(errorsOf((r) => withV2(r))).toBe("");
    // v1 だけにある n3（対象外）：改版で外したWP
    expect(errorsOf((r) => {
      withV2(r);
      list(r, "baselineItems").push({ ...list(r, "baselineItems")[0], id: "bi3", baselineId: "b1", wbsNodeId: "n3" });
    })).toBe("");
    // 最新の v2 に n3（対象外）
    expect(errorsOf((r) => {
      withV2(r);
      list(r, "baselineItems").push({ ...list(r, "baselineItems")[0], id: "bi3", baselineId: "b2", wbsNodeId: "n3" });
    })).toMatch(/対象外のWPは明細にできません/);
  });

  it("版の合意日が前の版より前、企画の承認日が v1 の合意日と違うデータを拒否する", () => {
    expect(errorsOf((r) => withV2(r, "2030-01-06"))).toMatch(/v2の合意日が前の版より前/);
    expect(errorsOf((r) => ((r.proposal as Record<string, unknown>).approvedOn = "2030-01-08"))).toMatch(/v1の合意日と違います/);
  });

  it("承認ゲート・承認日・承認の記録の食い違いを拒否する", () => {
    expect(errorsOf((r) => (list(r, "baselines")[0].gate = "改版"))).toMatch(/v1の承認ゲート/);
    expect(errorsOf((r) => {
      withV2(r);
      list(r, "baselines")[1].gate = "G1+2";
    })).toMatch(/v2の承認ゲート/);
    expect(errorsOf((r) => (list(r, "gateReviews")[0].reviewedOn = "2030-01-08"))).toMatch(/承認の日付がv1の合意日と違います/);
    expect(errorsOf((r) => {
      withV2(r);
      list(r, "gateReviews").push({ ...list(r, "gateReviews")[0], id: "g2", baselineId: "b2" });
    })).toMatch(/v1以外の版を指しています/);
    expect(errorsOf((r) => {
      withV2(r);
      list(r, "baselines")[1].revisionReason = "あ".repeat(501);
    })).toMatch(/改版理由が長すぎます/);
  });

  it("ベースラインが無いのに承認日があるデータを拒否する", () => {
    const raw = { ...createInitialState(), proposal: { ...createInitialState().proposal, approvedOn: "2030-01-07" } };
    const r = validateState(raw);
    expect(r.ok ? "" : r.errors.join()).toMatch(/ベースラインが無いのに承認日があります/);
  });

  it("過去の版の対象外のWPが、次の版にも残っているデータを拒否する", () => {
    expect(errorsOf((r) => {
      withV2(r);
      list(r, "baselineItems").push({ ...list(r, "baselineItems")[0], id: "bi3", baselineId: "b1", wbsNodeId: "n3" });
      list(r, "baselines").push({ ...list(r, "baselines")[0], id: "b3", version: 3, gate: "改版", approvedOn: "2030-01-09", revisionReason: "r" });
      list(r, "baselineItems").push({ ...list(r, "baselineItems")[0], id: "bi4", baselineId: "b3" });
      list(r, "auditLogs").push({ ...list(r, "auditLogs")[0], id: "a3", seq: 3, targetId: "b3", action: "baseline.revise" });
      list(r, "baselineItems").push({ ...list(r, "baselineItems")[0], id: "bi5", baselineId: "b2", wbsNodeId: "n3" });
    })).toMatch(/次の版にも残っています/);
  });

  it("計画日の年が範囲外のデータを拒否する", () => {
    expect(errorsOf((r) => (node(r, "n2").plannedEnd = "9999-12-31"))).toMatch(/計画日の年が範囲外/);
    expect(errorsOf((r) => (list(r, "baselineItems")[0].plannedStart = "1000-01-01"))).toMatch(/計画日の年が範囲外/);
  });

  it("取込で受け付けない実績は、読み込みでも拒否する", () => {
    const entry = (over: Record<string, unknown>) => ({ id: "te1", wbsNodeId: "n2", memberId: "m1", workDate: "2030-01-08", minutes: 60, source: "manual_csv", uniqueKey: "manual_csv:2030-01-08:n2:a", ...over });
    expect(errorsOf((r) => list(r, "timeEntries").push(entry({})))).toBe("");
    expect(errorsOf((r) => list(r, "timeEntries").push(entry({ wbsNodeId: "n1", uniqueKey: "manual_csv:2030-01-08:n1:a" })))).toMatch(/phase に実績は付けられません/);
    expect(errorsOf((r) => list(r, "timeEntries").push(entry({ wbsNodeId: "n3", uniqueKey: "manual_csv:2030-01-08:n3:a" })))).toMatch(/対象外のWPに実績は付けられません/);
    expect(errorsOf((r) => list(r, "timeEntries").push(entry({ minutes: 0 })))).toMatch(/工数が0です/);
    expect(errorsOf((r) => list(r, "timeEntries").push(entry({ workDate: "2030-01-06", uniqueKey: "manual_csv:2030-01-06:n2:a" })))).toMatch(/合意日より前/);
    expect(errorsOf((r) => list(r, "timeEntries").push(entry({ memberId: null })))).toMatch(/メンバーがありません/);
    expect(errorsOf((r) => list(r, "timeEntries").push(entry({ uniqueKey: "manual_csv:2030-01-09:n2:a" })))).toMatch(/一意キーが作業日・WBS要素と合いません/);
  });

  it("要対応の閾値は整数のポイント", () => {
    expect(errorsOf((r) => ((r.settings as Record<string, unknown>).alertThresholdPoints = 5.5))).toMatch(/整数ではありません/);
  });

  it("必須WPの作業名が空のデータを拒否する", () => {
    expect(errorsOf((r) => Object.assign(node(r, "n3"), { requiredKey: "operation_design", name: " " }))).toMatch(/必須WPの作業名がありません/);
  });

  it("紐付けの重複・phase への紐付けを拒否する", () => {
    expect(errorsOf((r) => list(r, "objectiveTraces").push({ ...list(r, "objectiveTraces")[0], id: "t2" }))).toMatch(/紐付けが重複/);
    expect(errorsOf((r) => list(r, "objectiveTraces").push({ ...list(r, "objectiveTraces")[0], id: "t2", wbsNodeId: "n1" }))).toMatch(
      /phase は目的に紐付けられません/,
    );
  });
});
