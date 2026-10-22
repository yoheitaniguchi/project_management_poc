// 読み込むデータ（保存したJSON、localStorageの値）の検証（docs/security/checklist.md C・D）。
// unknown を受け取り、型と値を確かめながら新しいオブジェクトを組み立て直す。
// パース結果をそのまま状態に使ったり、スプレッドでマージしたりしない。
// これは整合性の検証であり、意図的な改ざんは検知できない。
import {
  CURRENT_SCHEMA_VERSION,
  REQUIRED_WP_CATEGORY,
  REQUIRED_WP_KEYS,
  WBS_CODE_PATTERN,
  type AppState,
  type AuditLog,
  type Baseline,
  type BaselineItem,
  type Estimate,
  type EstimationStandard,
  type EvmSnapshot,
  type GateReview,
  type Member,
  type Objective,
  type ObjectiveTrace,
  type Project,
  type ProjectMember,
  type Proposal,
  type Settings,
  type SyncRun,
  type TimeEntry,
  type WbsNode,
  latestBaselineOf,
} from "./types";

export const LIMITS = {
  /** 読み込むファイルの大きさの上限（バイト） */
  maxBytes: 5 * 1024 * 1024,
  /** 1つの一覧の件数の上限 */
  maxItems: 10_000,
  /** 1つの文字列の長さの上限 */
  maxStringLength: 10_000,
  /** 入れ子の深さの上限 */
  maxDepth: 20,
  /** 工数（時間）の上限。WP 1件・明細 1件あたり */
  maxHours: 10_000,
  /** 実績 1件あたりの分の上限（1日分） */
  maxMinutesPerEntry: 24 * 60,
  /** 監査ログの変更前後の値（JSON文字列）の長さの上限。maxStringLength より短くし、保存したものを必ず読み戻せるようにする */
  maxAuditPayloadLength: 2_000,
  /** 改版理由・改版で外す理由の長さの上限。監査ログに全文が収まるようにする */
  maxReasonLength: 500,
  /** 計画日に使える年の範囲（極端な期間で営業日の計算が止まらないようにする） */
  planYearMin: 2000,
  planYearMax: 2099,
};

const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);

export type ValidationResult = { ok: true; state: AppState } | { ok: false; errors: string[] };

type Rec = Record<string, unknown>;

function isPlainRecord(v: unknown): v is Rec {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
  const proto: unknown = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

/** 危険なキーと深すぎる入れ子を、どの階層にあっても見つける */
export function findForbiddenKeys(value: unknown, path = "$", depth = 0, found: string[] = []): string[] {
  if (depth > LIMITS.maxDepth) {
    found.push(`${path}：入れ子が深すぎます`);
    return found;
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => findForbiddenKeys(v, `${path}[${i}]`, depth + 1, found));
  } else if (typeof value === "object" && value !== null) {
    for (const key of Object.keys(value)) {
      if (FORBIDDEN_KEYS.has(key)) {
        found.push(`${path}：使えない項目名「${key}」があります`);
        continue;
      }
      findForbiddenKeys((value as Rec)[key], `${path}.${key}`, depth + 1, found);
    }
  }
  return found;
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;

/** 計画日として使える日付（実在し、年が LIMITS の範囲内） */
export function isPlanDate(s: string): boolean {
  if (!isValidDate(s)) return false;
  const y = Number(s.slice(0, 4));
  return y >= LIMITS.planYearMin && y <= LIMITS.planYearMax;
}

export function isValidDate(s: string): boolean {
  const m = DATE_RE.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

function isValidDateTime(s: string): boolean {
  return DATETIME_RE.test(s) && !Number.isNaN(Date.parse(s)) && isValidDate(s.slice(0, 10));
}

/** エラー文言に入れる項目名は短く切る（非常に長いキー名で文言が膨らまないように） */
const shorten = (s: string) => (s.length > 40 ? `${s.slice(0, 40)}…` : s);

/** 日時（ISO 8601）を時刻として比べるための値。文字列の大小はミリ秒の書き方で前後が逆になるため使わない */
export const timeOf = (iso: string) => Date.parse(iso);

/** 項目を1つずつ読み、問題があれば errors に日本語で積む */
class Reader {
  readonly errors: string[] = [];

  record(v: unknown, path: string, keys: readonly string[]): Rec | null {
    if (!isPlainRecord(v)) {
      this.errors.push(`${path}：オブジェクトではありません`);
      return null;
    }
    const allowed = new Set(keys);
    for (const k of Object.keys(v)) {
      if (!allowed.has(k)) this.errors.push(`${path}：知らない項目「${shorten(k)}」があります`);
    }
    for (const k of keys) {
      if (!Object.prototype.hasOwnProperty.call(v, k)) this.errors.push(`${path}：項目「${k}」がありません`);
    }
    return v;
  }

  list<T>(v: unknown, path: string, item: (x: unknown, p: string) => T | null): T[] {
    if (!Array.isArray(v)) {
      this.errors.push(`${path}：一覧ではありません`);
      return [];
    }
    if (v.length > LIMITS.maxItems) {
      this.errors.push(`${path}：件数が上限（${LIMITS.maxItems}件）を超えています`);
      return [];
    }
    const out: T[] = [];
    v.forEach((x, i) => {
      const r = item(x, `${path}[${i}]`);
      if (r !== null) out.push(r);
    });
    return out;
  }

  str(o: Rec, k: string, path: string, opts: { nonEmpty?: boolean } = {}): string {
    const v = o[k];
    if (typeof v !== "string") {
      this.errors.push(`${path}.${k}：文字列ではありません`);
      return "";
    }
    if (v.length > LIMITS.maxStringLength) this.errors.push(`${path}.${k}：文字数が上限を超えています`);
    if (opts.nonEmpty && v.trim() === "") this.errors.push(`${path}.${k}：空です`);
    return v;
  }

  nullableStr(o: Rec, k: string, path: string): string | null {
    return o[k] === null ? null : this.str(o, k, path);
  }

  num(o: Rec, k: string, path: string, opts: { min?: number; max?: number; integer?: boolean } = {}): number {
    const v = o[k];
    if (typeof v !== "number" || !Number.isFinite(v)) {
      this.errors.push(`${path}.${k}：数値ではありません`);
      return 0;
    }
    if (opts.min !== undefined && v < opts.min) this.errors.push(`${path}.${k}：${opts.min}未満です`);
    if (opts.max !== undefined && v > opts.max) this.errors.push(`${path}.${k}：上限（${opts.max}）を超えています`);
    if (opts.integer && !Number.isInteger(v)) this.errors.push(`${path}.${k}：整数ではありません`);
    return v;
  }

  nullableNum(o: Rec, k: string, path: string, opts: { min?: number; max?: number } = {}): number | null {
    return o[k] === null ? null : this.num(o, k, path, opts);
  }

  bool(o: Rec, k: string, path: string): boolean {
    const v = o[k];
    if (typeof v !== "boolean") {
      this.errors.push(`${path}.${k}：真偽値ではありません`);
      return false;
    }
    return v;
  }

  oneOf<T extends string>(o: Rec, k: string, path: string, values: readonly T[]): T {
    const v = o[k];
    if (typeof v !== "string" || !(values as readonly string[]).includes(v)) {
      this.errors.push(`${path}.${k}：決められた値（${values.join("・")}）ではありません`);
      return values[0];
    }
    return v as T;
  }

  date(o: Rec, k: string, path: string): string {
    const v = this.str(o, k, path);
    if (typeof o[k] === "string" && !isValidDate(v)) this.errors.push(`${path}.${k}：日付（YYYY-MM-DD）ではありません`);
    return v;
  }

  nullableDate(o: Rec, k: string, path: string): string | null {
    return o[k] === null ? null : this.date(o, k, path);
  }

  dateTime(o: Rec, k: string, path: string): string {
    const v = this.str(o, k, path);
    if (typeof o[k] === "string" && !isValidDateTime(v)) this.errors.push(`${path}.${k}：日時（ISO 8601、UTC）ではありません`);
    return v;
  }

  nullableDateTime(o: Rec, k: string, path: string): string | null {
    return o[k] === null ? null : this.dateTime(o, k, path);
  }
}

export const STATE_KEYS = [
  "schemaVersion", "proposal", "project", "objectives", "objectiveTraces", "members", "projectMembers",
  "wbsNodes", "estimates", "estimationStandards", "baselines", "baselineItems", "gateReviews",
  "timeEntries", "evmSnapshots", "syncRuns", "auditLogs", "settings", "lastExportedAt",
] as const;

function readProposal(r: Reader, v: unknown, p: string): Proposal | null {
  const o = r.record(v, p, ["background", "issues", "estimatedHours", "status", "approvedOn"]);
  if (!o) return null;
  return {
    background: r.str(o, "background", p),
    issues: r.str(o, "issues", p),
    estimatedHours: r.nullableNum(o, "estimatedHours", p, { min: 0, max: LIMITS.maxHours * 10 }),
    status: r.oneOf(o, "status", p, ["draft", "approved", "returned"] as const),
    approvedOn: r.nullableDate(o, "approvedOn", p),
  };
}

function readProject(r: Reader, v: unknown, p: string): Project | null {
  const o = r.record(v, p, ["name", "scope", "route", "hasRelease", "status", "pmMemberId"]);
  if (!o) return null;
  return {
    name: r.str(o, "name", p),
    scope: r.str(o, "scope", p),
    route: r.oneOf(o, "route", p, ["normal", "simple"] as const),
    hasRelease: r.bool(o, "hasRelease", p),
    status: r.oneOf(o, "status", p, ["planning", "executing", "closed"] as const),
    pmMemberId: r.nullableStr(o, "pmMemberId", p),
  };
}

function readObjective(r: Reader, v: unknown, p: string): Objective | null {
  const o = r.record(v, p, ["id", "code", "content", "metricName", "targetValue", "measurementTiming"]);
  if (!o) return null;
  return {
    id: r.str(o, "id", p, { nonEmpty: true }),
    code: r.str(o, "code", p),
    content: r.str(o, "content", p),
    metricName: r.str(o, "metricName", p),
    targetValue: r.str(o, "targetValue", p),
    measurementTiming: r.str(o, "measurementTiming", p),
  };
}

function readTrace(r: Reader, v: unknown, p: string): ObjectiveTrace | null {
  const o = r.record(v, p, ["id", "objectiveId", "wbsNodeId", "contribution"]);
  if (!o) return null;
  return {
    id: r.str(o, "id", p, { nonEmpty: true }),
    objectiveId: r.str(o, "objectiveId", p),
    wbsNodeId: r.str(o, "wbsNodeId", p),
    contribution: r.str(o, "contribution", p),
  };
}

function readMember(r: Reader, v: unknown, p: string): Member | null {
  const o = r.record(v, p, ["id", "name", "affiliation", "asanaUserGid"]);
  if (!o) return null;
  return {
    id: r.str(o, "id", p, { nonEmpty: true }),
    name: r.str(o, "name", p),
    affiliation: r.oneOf(o, "affiliation", p, ["internal", "vendor"] as const),
    asanaUserGid: r.nullableStr(o, "asanaUserGid", p),
  };
}

function readProjectMember(r: Reader, v: unknown, p: string): ProjectMember | null {
  const o = r.record(v, p, ["id", "memberId", "role"]);
  if (!o) return null;
  return {
    id: r.str(o, "id", p, { nonEmpty: true }),
    memberId: r.str(o, "memberId", p),
    role: r.oneOf(o, "role", p, ["pm", "member", "supervisor", "viewer", "vendor"] as const),
  };
}

function readWbsNode(r: Reader, v: unknown, p: string): WbsNode | null {
  const o = r.record(v, p, [
    "id", "code", "name", "kind", "category", "parentId", "asanaTaskGid",
    "plannedStart", "plannedEnd", "completedOn", "excluded", "excludedReason", "requiredKey",
  ]);
  if (!o) return null;
  return {
    id: r.str(o, "id", p, { nonEmpty: true }),
    code: r.str(o, "code", p),
    name: r.str(o, "name", p),
    kind: r.oneOf(o, "kind", p, ["phase", "work_package"] as const),
    category: r.oneOf(o, "category", p, ["functional", "non_functional_security", "operation_transition"] as const),
    parentId: r.nullableStr(o, "parentId", p),
    asanaTaskGid: r.nullableStr(o, "asanaTaskGid", p),
    plannedStart: r.nullableDate(o, "plannedStart", p),
    plannedEnd: r.nullableDate(o, "plannedEnd", p),
    completedOn: r.nullableDate(o, "completedOn", p),
    excluded: r.bool(o, "excluded", p),
    excludedReason: r.str(o, "excludedReason", p),
    requiredKey: o.requiredKey === null ? null : r.oneOf(o, "requiredKey", p, REQUIRED_WP_KEYS),
  };
}

function readEstimate(r: Reader, v: unknown, p: string): Estimate | null {
  const o = r.record(v, p, ["id", "wbsNodeId", "hours", "basis", "standardId"]);
  if (!o) return null;
  return {
    id: r.str(o, "id", p, { nonEmpty: true }),
    wbsNodeId: r.str(o, "wbsNodeId", p),
    hours: r.num(o, "hours", p, { min: 0, max: LIMITS.maxHours }),
    basis: r.str(o, "basis", p),
    standardId: r.nullableStr(o, "standardId", p),
  };
}

function readStandard(r: Reader, v: unknown, p: string): EstimationStandard | null {
  const o = r.record(v, p, ["id", "workType", "sizeUnit", "hoursPerUnit", "version", "provisional"]);
  if (!o) return null;
  return {
    id: r.str(o, "id", p, { nonEmpty: true }),
    workType: r.str(o, "workType", p),
    sizeUnit: r.str(o, "sizeUnit", p),
    hoursPerUnit: r.num(o, "hoursPerUnit", p, { min: 0, max: LIMITS.maxHours }),
    version: r.str(o, "version", p),
    provisional: r.bool(o, "provisional", p),
  };
}

function readBaseline(r: Reader, v: unknown, p: string): Baseline | null {
  const o = r.record(v, p, [
    "id", "version", "approvedOn", "approver", "approverSelfDeclared", "gate", "comment", "revisionReason", "operatedAt",
  ]);
  if (!o) return null;
  if (o.approverSelfDeclared !== true) r.errors.push(`${p}.approverSelfDeclared：true ではありません`);
  return {
    id: r.str(o, "id", p, { nonEmpty: true }),
    version: r.num(o, "version", p, { min: 1, integer: true }),
    approvedOn: r.date(o, "approvedOn", p),
    approver: r.str(o, "approver", p, { nonEmpty: true }),
    approverSelfDeclared: true,
    gate: r.str(o, "gate", p, { nonEmpty: true }),
    comment: r.str(o, "comment", p),
    revisionReason: r.nullableStr(o, "revisionReason", p),
    operatedAt: r.dateTime(o, "operatedAt", p),
  };
}

function readBaselineItem(r: Reader, v: unknown, p: string): BaselineItem | null {
  const o = r.record(v, p, ["id", "baselineId", "wbsNodeId", "plannedHours", "plannedStart", "plannedEnd"]);
  if (!o) return null;
  return {
    id: r.str(o, "id", p, { nonEmpty: true }),
    baselineId: r.str(o, "baselineId", p),
    wbsNodeId: r.str(o, "wbsNodeId", p),
    plannedHours: r.num(o, "plannedHours", p, { min: 0, max: LIMITS.maxHours }),
    plannedStart: r.date(o, "plannedStart", p),
    plannedEnd: r.date(o, "plannedEnd", p),
  };
}

function readGateReview(r: Reader, v: unknown, p: string): GateReview | null {
  const o = r.record(v, p, [
    "id", "decision", "reviewedOn", "reviewer", "reviewerSelfDeclared", "comment", "baselineId", "operatedAt",
  ]);
  if (!o) return null;
  if (o.reviewerSelfDeclared !== true) r.errors.push(`${p}.reviewerSelfDeclared：true ではありません`);
  return {
    id: r.str(o, "id", p, { nonEmpty: true }),
    decision: r.oneOf(o, "decision", p, ["approved", "returned"] as const),
    reviewedOn: r.date(o, "reviewedOn", p),
    reviewer: r.str(o, "reviewer", p, { nonEmpty: true }),
    reviewerSelfDeclared: true,
    comment: r.str(o, "comment", p),
    baselineId: r.nullableStr(o, "baselineId", p),
    operatedAt: r.dateTime(o, "operatedAt", p),
  };
}

function readTimeEntry(r: Reader, v: unknown, p: string): TimeEntry | null {
  const o = r.record(v, p, ["id", "wbsNodeId", "memberId", "workDate", "minutes", "source", "uniqueKey"]);
  if (!o) return null;
  return {
    id: r.str(o, "id", p, { nonEmpty: true }),
    wbsNodeId: r.str(o, "wbsNodeId", p),
    memberId: r.nullableStr(o, "memberId", p),
    workDate: r.date(o, "workDate", p),
    minutes: r.num(o, "minutes", p, { min: 0, max: LIMITS.maxMinutesPerEntry, integer: true }),
    source: r.oneOf(o, "source", p, ["asana_csv", "manual_csv"] as const),
    uniqueKey: r.str(o, "uniqueKey", p, { nonEmpty: true }),
  };
}

function readSnapshot(r: Reader, v: unknown, p: string): EvmSnapshot | null {
  const o = r.record(v, p, [
    "id", "baselineId", "asOf", "pv", "ev", "ac", "bac", "cpi", "spi", "eac",
    "consumptionRate", "progressRate", "createdAt",
  ]);
  if (!o) return null;
  return {
    id: r.str(o, "id", p, { nonEmpty: true }),
    baselineId: r.str(o, "baselineId", p),
    asOf: r.date(o, "asOf", p),
    pv: r.num(o, "pv", p, { min: 0 }),
    ev: r.num(o, "ev", p, { min: 0 }),
    ac: r.num(o, "ac", p, { min: 0 }),
    bac: r.num(o, "bac", p, { min: 0 }),
    cpi: r.nullableNum(o, "cpi", p, { min: 0 }),
    spi: r.nullableNum(o, "spi", p, { min: 0 }),
    eac: r.nullableNum(o, "eac", p, { min: 0 }),
    consumptionRate: r.nullableNum(o, "consumptionRate", p, { min: 0 }),
    progressRate: r.nullableNum(o, "progressRate", p, { min: 0 }),
    createdAt: r.dateTime(o, "createdAt", p),
  };
}

function readSyncRun(r: Reader, v: unknown, p: string): SyncRun | null {
  const o = r.record(v, p, ["id", "importedAt", "fileName", "result", "count", "error"]);
  if (!o) return null;
  return {
    id: r.str(o, "id", p, { nonEmpty: true }),
    importedAt: r.dateTime(o, "importedAt", p),
    fileName: r.str(o, "fileName", p),
    result: r.oneOf(o, "result", p, ["success", "failure"] as const),
    count: r.num(o, "count", p, { min: 0, integer: true }),
    error: r.nullableStr(o, "error", p),
  };
}

function readAuditLog(r: Reader, v: unknown, p: string): AuditLog | null {
  const o = r.record(v, p, [
    "id", "seq", "at", "operator", "operatorSelfDeclared", "targetType", "targetId", "action", "before", "after",
  ]);
  if (!o) return null;
  if (o.operatorSelfDeclared !== true) r.errors.push(`${p}.operatorSelfDeclared：true ではありません`);
  const entry: AuditLog = {
    id: r.str(o, "id", p, { nonEmpty: true }),
    seq: r.num(o, "seq", p, { min: 1, integer: true }),
    at: r.dateTime(o, "at", p),
    operator: r.str(o, "operator", p),
    operatorSelfDeclared: true,
    targetType: r.str(o, "targetType", p, { nonEmpty: true }),
    targetId: r.str(o, "targetId", p),
    action: r.str(o, "action", p, { nonEmpty: true }),
    before: r.nullableStr(o, "before", p),
    after: r.nullableStr(o, "after", p),
  };
  for (const k of ["before", "after"] as const) {
    const x = entry[k];
    if (x !== null && x.length > LIMITS.maxAuditPayloadLength) r.errors.push(`${p}.${k}：文字数が上限を超えています`);
  }
  return entry;
}

function readSettings(r: Reader, v: unknown, p: string): Settings | null {
  const o = r.record(v, p, ["alertThresholdPoints", "holidays"]);
  if (!o) return null;
  const holidays = r.list(o.holidays, `${p}.holidays`, (x, hp) => {
    if (typeof x !== "string" || !isValidDate(x)) {
      r.errors.push(`${hp}：日付（YYYY-MM-DD）ではありません`);
      return null;
    }
    return x;
  });
  return { alertThresholdPoints: r.num(o, "alertThresholdPoints", p, { min: 0, max: 100, integer: true }), holidays };
}

/** 4章のルールのうち、ファイルの中だけで確かめられる整合性 */
export function checkIntegrity(s: AppState): string[] {
  const errors: string[] = [];

  const ids = <T extends { id: string }>(name: string, items: T[]): Set<string> => {
    const set = new Set<string>();
    for (const x of items) {
      if (set.has(x.id)) errors.push(`${name}：ID「${x.id}」が重複しています`);
      set.add(x.id);
    }
    return set;
  };
  const objectiveIds = ids("objectives", s.objectives);
  ids("objectiveTraces", s.objectiveTraces);
  const memberIds = ids("members", s.members);
  ids("projectMembers", s.projectMembers);
  const nodeIds = ids("wbsNodes", s.wbsNodes);
  ids("estimates", s.estimates);
  const standardIds = ids("estimationStandards", s.estimationStandards);
  const baselineIds = ids("baselines", s.baselines);
  ids("baselineItems", s.baselineItems);
  ids("gateReviews", s.gateReviews);
  ids("timeEntries", s.timeEntries);
  ids("evmSnapshots", s.evmSnapshots);
  ids("syncRuns", s.syncRuns);
  ids("auditLogs", s.auditLogs);

  const ref = (path: string, id: string | null, set: Set<string>, what: string) => {
    if (id !== null && !set.has(id)) errors.push(`${path}：存在しない${what}「${id}」を参照しています`);
  };
  ref("project.pmMemberId", s.project.pmMemberId, memberIds, "メンバー");
  if (s.proposal.status === "approved" && s.proposal.approvedOn === null) {
    errors.push("proposal：承認済みなのに承認日がありません");
  }
  // 承認＝v1の確定（CLAUDE.md 4章）。v1 がある ⇔ 企画が承認済み
  const hasV1 = s.baselines.some((b) => b.version === 1);
  if (hasV1 && s.proposal.status !== "approved") errors.push("proposal：ベースラインv1があるのに承認済みになっていません");
  if (!hasV1 && s.proposal.status === "approved") errors.push("proposal：ベースラインが無いのに承認済みになっています");
  // 体制：1人のメンバーに体制の記録は1件、PMは1名、プロジェクトのPMは役割がPMのメンバー
  const roleOf = new Map<string, string>();
  for (const pm of s.projectMembers) {
    if (roleOf.has(pm.memberId)) errors.push(`projectMembers：メンバー「${pm.memberId}」の体制の記録が重複しています`);
    roleOf.set(pm.memberId, pm.role);
  }
  s.members.forEach((m, i) => {
    if (!roleOf.has(m.id)) errors.push(`members[${i}]：体制（役割）の記録がありません`);
  });
  const pms = s.projectMembers.filter((p) => p.role === "pm");
  if (pms.length > 1) errors.push("projectMembers：PMが2名以上います");
  if ((pms[0]?.memberId ?? null) !== s.project.pmMemberId) {
    errors.push("project.pmMemberId：役割がPMのメンバーと一致しません");
  }
  s.objectiveTraces.forEach((t, i) => {
    ref(`objectiveTraces[${i}].objectiveId`, t.objectiveId, objectiveIds, "目的");
    ref(`objectiveTraces[${i}].wbsNodeId`, t.wbsNodeId, nodeIds, "WBS要素");
  });
  s.projectMembers.forEach((m, i) => ref(`projectMembers[${i}].memberId`, m.memberId, memberIds, "メンバー"));
  s.wbsNodes.forEach((n, i) => {
    ref(`wbsNodes[${i}].parentId`, n.parentId, nodeIds, "WBS要素");
    if ((n.plannedStart !== null && !isPlanDate(n.plannedStart)) || (n.plannedEnd !== null && !isPlanDate(n.plannedEnd))) {
      errors.push(`wbsNodes[${i}]：計画日の年が範囲外です（${LIMITS.planYearMin}〜${LIMITS.planYearMax}年）`);
    }
    if (n.plannedStart && n.plannedEnd && n.plannedStart > n.plannedEnd) {
      errors.push(`wbsNodes[${i}]：計画開始日が計画終了日より後です`);
    }
  });
  const nodeById = new Map(s.wbsNodes.map((n) => [n.id, n]));
  const latestBaselineId = latestBaselineOf(s.baselines)?.id ?? null;
  const versionOf = new Map(s.baselines.map((b) => [b.id, b.version]));
  const nodesOfVersion = (version: number) => {
    const b = s.baselines.find((x) => x.version === version);
    return new Set(b ? s.baselineItems.filter((x) => x.baselineId === b.id).map((x) => x.wbsNodeId) : []);
  };
  // 見積はWP 1件につき1件まで、WPだけに付ける（合計やベースラインの計画工数で、どの見積を使うかを1つに決めるため）
  const estimatedNodes = new Set<string>();
  s.estimates.forEach((e, i) => {
    ref(`estimates[${i}].wbsNodeId`, e.wbsNodeId, nodeIds, "WBS要素");
    ref(`estimates[${i}].standardId`, e.standardId, standardIds, "見積基準");
    if (nodeById.get(e.wbsNodeId)?.kind === "phase") errors.push(`estimates[${i}]：phase に見積は付けられません`);
    if (estimatedNodes.has(e.wbsNodeId)) errors.push(`estimates[${i}]：同じWBS要素の見積が重複しています`);
    estimatedNodes.add(e.wbsNodeId);
  });
  // 目的の紐付けは、同じ目的とWPの組を重複させず、WPだけに付ける
  const tracePairs = new Set<string>();
  s.objectiveTraces.forEach((t, i) => {
    if (nodeById.get(t.wbsNodeId)?.kind === "phase") errors.push(`objectiveTraces[${i}]：phase は目的に紐付けられません`);
    const pair = `${t.objectiveId}\u0000${t.wbsNodeId}`;
    if (tracePairs.has(pair)) errors.push(`objectiveTraces[${i}]：同じ目的とWBS要素の紐付けが重複しています`);
    tracePairs.add(pair);
  });
  const itemPairs = new Set<string>();
  s.baselineItems.forEach((b, i) => {
    ref(`baselineItems[${i}].baselineId`, b.baselineId, baselineIds, "ベースライン");
    ref(`baselineItems[${i}].wbsNodeId`, b.wbsNodeId, nodeIds, "WBS要素");
    if (b.plannedStart > b.plannedEnd) errors.push(`baselineItems[${i}]：計画開始日が計画終了日より後です`);
    if (b.plannedHours <= 0) errors.push(`baselineItems[${i}]：計画工数が0です`);
    const node = nodeById.get(b.wbsNodeId);
    if (node && node.kind !== "work_package") errors.push(`baselineItems[${i}]：phase は明細にできません`);
    // 過去の版の明細は凍結した記録なので、改版で外したWP（今は対象外）を含んでいてよい。ただし、次の版で外れている（次の版の明細に無い）こと。
    // 最新の版には対象外のWPを入れない
    if (node && node.excluded) {
      const version = versionOf.get(b.baselineId);
      if (b.baselineId === latestBaselineId) errors.push(`baselineItems[${i}]：対象外のWPは明細にできません`);
      else if (version !== undefined && nodesOfVersion(version + 1).has(node.id)) errors.push(`baselineItems[${i}]：対象外のWPが次の版にも残っています`);
    }
    if (!isPlanDate(b.plannedStart) || !isPlanDate(b.plannedEnd)) errors.push(`baselineItems[${i}]：計画日の年が範囲外です`);
    const pair = `${b.baselineId}\u0000${b.wbsNodeId}`;
    if (itemPairs.has(pair)) errors.push(`baselineItems[${i}]：同じ版に同じWBS要素の明細が重複しています`);
    itemPairs.add(pair);
  });
  s.gateReviews.forEach((g, i) => {
    ref(`gateReviews[${i}].baselineId`, g.baselineId, baselineIds, "ベースライン");
    if (g.decision === "approved" && g.baselineId === null) errors.push(`gateReviews[${i}]：承認なのに確定した版がありません`);
    if (g.decision === "returned" && g.baselineId !== null) errors.push(`gateReviews[${i}]：差戻しなのに版が指定されています`);
  });
  s.timeEntries.forEach((t, i) => {
    ref(`timeEntries[${i}].wbsNodeId`, t.wbsNodeId, nodeIds, "WBS要素");
    ref(`timeEntries[${i}].memberId`, t.memberId, memberIds, "メンバー");
  });
  s.evmSnapshots.forEach((e, i) => ref(`evmSnapshots[${i}].baselineId`, e.baselineId, baselineIds, "ベースライン"));

  // WBSコードは一意（実績のCSVはWBSコードでWPを指すため）。必須WPは種類ごとに1件、WPであること
  const codes = new Set<string>();
  const requiredKeys = new Set<string>();
  s.wbsNodes.forEach((n, i) => {
    if (!WBS_CODE_PATTERN.test(n.code)) errors.push(`wbsNodes[${i}]：WBSコードの形式が正しくありません`);
    else if (codes.has(n.code)) errors.push(`wbsNodes[${i}]：WBSコード「${n.code}」が重複しています`);
    codes.add(n.code);
    if (n.requiredKey !== null) {
      if (requiredKeys.has(n.requiredKey)) errors.push(`wbsNodes[${i}]：必須WP「${n.requiredKey}」が重複しています`);
      requiredKeys.add(n.requiredKey);
      if (n.kind !== "work_package") errors.push(`wbsNodes[${i}]：必須WPがWPではありません`);
      if (n.category !== REQUIRED_WP_CATEGORY[n.requiredKey]) errors.push(`wbsNodes[${i}]：必須WPの作業区分が正しくありません`);
    }
    if (n.excluded && n.excludedReason.trim() === "") errors.push(`wbsNodes[${i}]：対象外の理由がありません`);
    if (n.requiredKey !== null && n.name.trim() === "") errors.push(`wbsNodes[${i}]：必須WPの作業名がありません`);
    if (n.parentId !== null && nodeById.get(n.parentId)?.kind === "work_package") {
      errors.push(`wbsNodes[${i}]：WPの下に要素は置けません`);
    }
  });

  // WBSの親子の循環（訪問済みの集合で辿る）
  const parentOf = new Map(s.wbsNodes.map((n) => [n.id, n.parentId]));
  for (const n of s.wbsNodes) {
    const seen = new Set<string>();
    let cur: string | null = n.id;
    while (cur !== null && parentOf.has(cur)) {
      if (seen.has(cur)) {
        errors.push(`wbsNodes：「${n.code || n.id}」の親子関係が循環しています`);
        break;
      }
      seen.add(cur);
      cur = parentOf.get(cur) ?? null;
    }
  }

  // TimeEntryの一意キー
  const keys = new Set<string>();
  for (const t of s.timeEntries) {
    if (keys.has(t.uniqueKey)) errors.push(`timeEntries：一意キー「${t.uniqueKey}」が重複しています`);
    keys.add(t.uniqueKey);
  }

  // ベースラインの版番号は1から連番。合意日は前の版より前にならない。企画の承認日は v1 の合意日
  const ordered = [...s.baselines].sort((a, b) => a.version - b.version);
  const versions = ordered.map((b) => b.version);
  if (versions.some((v, i) => v !== i + 1)) {
    errors.push(`baselines：版番号が1から連番になっていません（${versions.join(",")}）`);
  }
  ordered.forEach((b, i) => {
    if (i > 0 && b.approvedOn < ordered[i - 1].approvedOn) errors.push(`baselines：v${b.version}の合意日が前の版より前です`);
  });
  if (ordered[0] && s.proposal.approvedOn !== ordered[0].approvedOn) errors.push("proposal.approvedOn：ベースラインv1の合意日と違います");
  if (!ordered[0] && s.proposal.approvedOn !== null) errors.push("proposal.approvedOn：ベースラインが無いのに承認日があります");
  ordered.forEach((b) => {
    if (b.version === 1 && b.gate !== "G1+2") errors.push("baselines：v1の承認ゲートが G1+2 ではありません");
    if (b.version >= 2 && b.gate !== "改版") errors.push(`baselines：v${b.version}の承認ゲートが 改版 ではありません`);
    if (b.revisionReason !== null && b.revisionReason.length > LIMITS.maxReasonLength) errors.push(`baselines：v${b.version}の改版理由が長すぎます`);
  });
  // 承認の記録は v1 を指し、合意日が v1 と同じ
  s.gateReviews.forEach((g, i) => {
    if (g.decision !== "approved" || g.baselineId === null) return;
    const b = s.baselines.find((x) => x.id === g.baselineId);
    if (b && b.version !== 1) errors.push(`gateReviews[${i}]：承認の記録がv1以外の版を指しています`);
    if (b && g.reviewedOn !== b.approvedOn) errors.push(`gateReviews[${i}]：承認の日付がv1の合意日と違います`);
  });
  // 各版について：明細が1件以上ある。v1は確定（baseline.confirm）、v2以降は改版（baseline.revise）の監査ログがある。
  // v2以降は改版理由が要る。v1は G1+2 承認と同じ操作で確定するので、その版を指す承認の記録がある
  for (const b of s.baselines) {
    if (!s.baselineItems.some((x) => x.baselineId === b.id)) errors.push(`baselines：v${b.version}に明細がありません`);
    if (b.version >= 2 && (b.revisionReason === null || b.revisionReason.trim() === "")) {
      errors.push(`baselines：v${b.version}に改版理由がありません`);
    }
    const expectedAction = b.version === 1 ? "baseline.confirm" : "baseline.revise";
    const logged = s.auditLogs.some((a) => a.targetType === "baseline" && a.targetId === b.id && a.action === expectedAction);
    if (!logged) errors.push(`baselines：v${b.version}の${b.version === 1 ? "確定" : "改版"}の監査ログがありません`);
    if (b.version === 1 && !s.gateReviews.some((g) => g.decision === "approved" && g.baselineId === b.id)) {
      errors.push("baselines：v1に対応するG1+2承認の記録がありません");
    }
  }

  // 監査ログは1からの連番で、日時は前のログより前にならない
  s.auditLogs.forEach((a, i) => {
    if (a.seq !== i + 1) errors.push(`auditLogs[${i}]：連番が${i + 1}ではありません（${a.seq}）`);
    if (i > 0 && timeOf(a.at) < timeOf(s.auditLogs[i - 1].at)) errors.push(`auditLogs[${i}]：日時が前のログより前です`);
  });

  return errors;
}

/** unknown を検証し、問題が無ければ組み立て直した状態を返す */
export function validateState(raw: unknown): ValidationResult {
  const forbidden = findForbiddenKeys(raw);
  if (forbidden.length > 0) return { ok: false, errors: forbidden };

  const r = new Reader();
  const o = r.record(raw, "$", STATE_KEYS);
  if (!o) return { ok: false, errors: r.errors };
  if (o.schemaVersion !== CURRENT_SCHEMA_VERSION) {
    return { ok: false, errors: [`$.schemaVersion：対応していない版です（${String(o.schemaVersion)}）`] };
  }

  const proposal = readProposal(r, o.proposal, "proposal");
  const project = readProject(r, o.project, "project");
  const settings = readSettings(r, o.settings, "settings");
  const state: AppState = {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    proposal: proposal ?? { background: "", issues: "", estimatedHours: null, status: "draft", approvedOn: null },
    project: project ?? { name: "", scope: "", route: "simple", hasRelease: false, status: "planning", pmMemberId: null },
    objectives: r.list(o.objectives, "objectives", (x, p) => readObjective(r, x, p)),
    objectiveTraces: r.list(o.objectiveTraces, "objectiveTraces", (x, p) => readTrace(r, x, p)),
    members: r.list(o.members, "members", (x, p) => readMember(r, x, p)),
    projectMembers: r.list(o.projectMembers, "projectMembers", (x, p) => readProjectMember(r, x, p)),
    wbsNodes: r.list(o.wbsNodes, "wbsNodes", (x, p) => readWbsNode(r, x, p)),
    estimates: r.list(o.estimates, "estimates", (x, p) => readEstimate(r, x, p)),
    estimationStandards: r.list(o.estimationStandards, "estimationStandards", (x, p) => readStandard(r, x, p)),
    baselines: r.list(o.baselines, "baselines", (x, p) => readBaseline(r, x, p)),
    baselineItems: r.list(o.baselineItems, "baselineItems", (x, p) => readBaselineItem(r, x, p)),
    gateReviews: r.list(o.gateReviews, "gateReviews", (x, p) => readGateReview(r, x, p)),
    timeEntries: r.list(o.timeEntries, "timeEntries", (x, p) => readTimeEntry(r, x, p)),
    evmSnapshots: r.list(o.evmSnapshots, "evmSnapshots", (x, p) => readSnapshot(r, x, p)),
    syncRuns: r.list(o.syncRuns, "syncRuns", (x, p) => readSyncRun(r, x, p)),
    auditLogs: r.list(o.auditLogs, "auditLogs", (x, p) => readAuditLog(r, x, p)),
    settings: settings ?? { alertThresholdPoints: 5, holidays: [] },
    lastExportedAt: r.nullableDateTime(o, "lastExportedAt", "$"),
  };
  if (r.errors.length > 0) return { ok: false, errors: r.errors };

  const integrity = checkIntegrity(state);
  if (integrity.length > 0) return { ok: false, errors: integrity };
  return { ok: true, state };
}
