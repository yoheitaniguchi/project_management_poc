// 状態の保存（CLAUDE.md 6.1、docs/security/checklist.md E）。
// - localStorage への自動保存（普段使い）。キーには名前空間を付ける
// - JSONファイルの書き出し・読み込み（毎週の正式な記録）
// ここは純粋な関数と、注入された Storage だけを使う（画面やブラウザの API に直接依存しない）。
import { PREVIEW_PR } from "../buildInfo";
import { CURRENT_SCHEMA_VERSION, type AppState } from "./types";
import { findForbiddenKeys, LIMITS, STATE_KEYS, validateState } from "./validate";

/**
 * 保存データのキーの名前空間。PRプレビューは本番と同じオリジンで開くため、本番の保存データを読み書きしないよう別の名前空間にする
 * （本番の名前空間の接頭辞にならない名前にして、本番の「保存データを消去」でも消えないようにする）
 */
export function storageNamespace(previewPr: number | null): string {
  return previewPr === null ? "project_management_poc:" : `project_management_poc-pr-preview-${previewPr}:`;
}

export const STORAGE_NAMESPACE = storageNamespace(PREVIEW_PR);
export const STORAGE_KEY = `${STORAGE_NAMESPACE}v1:state`;
const CORRUPT_BACKUP_PREFIX = `${STORAGE_NAMESPACE}corrupt-backup:`;

/** 書き出すファイル名の接頭辞（.gitignore の pmpoc-* と揃える） */
export const EXPORT_FILE_PREFIX = "pmpoc-";

/** localStorage のうち、ここで使う操作だけ */
export type KeyValueStorage = Pick<Storage, "getItem" | "setItem" | "removeItem" | "key" | "length">;

// ---------------------------------------------------------------- 版の移行

export type Migration = (raw: Record<string, unknown>) => Record<string, unknown>;

/**
 * 版ごとの移行関数。キーは移行元の版（例：1 → 2 の移行は MIGRATIONS[1]）。
 * 型を変えて CURRENT_SCHEMA_VERSION を上げたら、ここに足す。移行の後で必ず検証する。
 * 移行関数は、必要な項目だけを新しいオブジェクトに詰め替える形で書く（スプレッドや Object.assign で丸ごと写さない）
 */
const MIGRATIONS: Record<number, Migration> = {
  // 版1 → 2：WBS要素に必須WPの種類（requiredKey）を追加した。既存の要素は必須WPとして扱わない（null）。
  // 版1の画面にはWBSを作る操作が無かったため、版2で足した整合性の規則（WBSコードの形式・重複など）に反する版1のデータは、移行せずに拒否する
  1: (raw) => {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(raw)) {
      if (!(STATE_KEYS as readonly string[]).includes(k)) throw new MigrationError(`版1のデータに知らない項目「${k}」があります`);
      out[k] = raw[k];
    }
    out.schemaVersion = 2;
    if (Array.isArray(raw.wbsNodes)) out.wbsNodes = raw.wbsNodes.map((n: unknown, i: number) => migrateV1WbsNode(n, i));
    return out;
  },
};

const V1_WBS_NODE_KEYS = [
  "id", "code", "name", "kind", "category", "parentId", "asanaTaskGid",
  "plannedStart", "plannedEnd", "completedOn", "excluded", "excludedReason",
] as const;

function migrateV1WbsNode(n: unknown, i: number): unknown {
  if (typeof n !== "object" || n === null || Array.isArray(n)) return n; // 形式の誤りは移行の後の検証で拒否する
  const src = n as Record<string, unknown>;
  const unknownKey = Object.keys(src).find((k) => !(V1_WBS_NODE_KEYS as readonly string[]).includes(k));
  if (unknownKey !== undefined) throw new MigrationError(`版1のwbsNodes[${i}]に知らない項目「${unknownKey}」があります`);
  const out: Record<string, unknown> = {};
  for (const k of V1_WBS_NODE_KEYS) if (k in src) out[k] = src[k];
  out.requiredKey = null;
  return out;
}

/** 移行できないデータ（版の前提に合わない）。migrate が理由として返す */
export class MigrationError extends Error {}

export type MigrationResult = { ok: true; value: unknown } | { ok: false; error: string };

export function migrate(
  raw: unknown,
  migrations: Record<number, Migration> = MIGRATIONS,
  targetVersion: number = CURRENT_SCHEMA_VERSION,
): MigrationResult {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, error: "データの形式が正しくありません" };
  }
  let current = raw as Record<string, unknown>;
  const initialVersion = current.schemaVersion;
  if (typeof initialVersion !== "number" || !Number.isInteger(initialVersion) || initialVersion < 1) {
    return { ok: false, error: "データの版が分かりません" };
  }
  let version: number = initialVersion;
  if (version > targetVersion) {
    return { ok: false, error: `このアプリより新しい版（${version}）のデータです。アプリを更新してから読み込んでください` };
  }
  while (version < targetVersion) {
    const step = migrations[version];
    if (!step) return { ok: false, error: `版${version}からの移行の方法がありません` };
    try {
      current = step(current);
    } catch (e) {
      if (e instanceof MigrationError) return { ok: false, error: e.message };
      throw e;
    }
    const next = current.schemaVersion;
    // 移行関数は版を必ず1つ上げる（上げ忘れで無限ループにならないようにする）
    if (next !== version + 1) return { ok: false, error: `版${version}からの移行で版が正しく上がりませんでした` };
    version = version + 1;
  }
  return { ok: true, value: current };
}

// ---------------------------------------------------------------- 文字列 → 状態

export type ParseResult = { ok: true; state: AppState } | { ok: false; errors: string[] };

/** JSON文字列を、大きさの確認 → パース → 移行 → 検証の順に通す */
export function parseStateText(text: string): ParseResult {
  if (new TextEncoder().encode(text).length > LIMITS.maxBytes) {
    return { ok: false, errors: [`ファイルが大きすぎます（上限 ${LIMITS.maxBytes / 1024 / 1024}MB）`] };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, errors: ["JSONとして読めません。このアプリで書き出したファイルか確認してください"] };
  }
  // 危険なキーは移行の前に拒否する（移行関数に未検証のオブジェクトを渡さないため）
  const forbidden = findForbiddenKeys(raw);
  if (forbidden.length > 0) return { ok: false, errors: forbidden };
  const migrated = migrate(raw);
  if (!migrated.ok) return { ok: false, errors: [migrated.error] };
  const result = validateState(migrated.value);
  return result.ok ? { ok: true, state: result.state } : { ok: false, errors: result.errors };
}

export function serializeState(state: AppState): string {
  return JSON.stringify(state, null, 2);
}

// ---------------------------------------------------------------- localStorage

export type LoadResult =
  | { kind: "empty" }
  | { kind: "ok"; state: AppState }
  /** 読めなかった。元の値は backupKey に退避した（退避にも失敗したら null）。自動保存は止めること */
  | { kind: "corrupt"; errors: string[]; backupKey: string | null };

export function loadFromStorage(storage: KeyValueStorage, now: Date): LoadResult {
  let text: string | null;
  try {
    text = storage.getItem(STORAGE_KEY);
  } catch {
    return { kind: "corrupt", errors: ["このブラウザの保存領域を読めません"], backupKey: null };
  }
  if (text === null) return { kind: "empty" };
  const parsed = parseStateText(text);
  if (parsed.ok) return { kind: "ok", state: parsed.state };

  // 空の状態で上書きして消してしまわないよう、元の値を別のキーに退避する。
  // 同じ内容がすでに退避されていれば、起動のたびに増やさない
  try {
    for (const k of listCorruptBackups(storage)) {
      if (storage.getItem(k) === text) return { kind: "corrupt", errors: parsed.errors, backupKey: k };
    }
  } catch {
    return { kind: "corrupt", errors: parsed.errors, backupKey: null };
  }
  const backupKey = `${CORRUPT_BACKUP_PREFIX}${now.toISOString()}`;
  try {
    storage.setItem(backupKey, text);
    return { kind: "corrupt", errors: parsed.errors, backupKey };
  } catch {
    return { kind: "corrupt", errors: parsed.errors, backupKey: null };
  }
}

export type SaveResult = { ok: true } | { ok: false; error: string };

export function saveToStorage(storage: KeyValueStorage, state: AppState): SaveResult {
  // 次回の起動で読み戻せないものは保存しない（保存した時点で不整合に気づけるようにする）
  const checked = validateState(state);
  if (!checked.ok) {
    return { ok: false, error: "保存しようとしたデータに不整合があるため、保存を止めました。直前の操作を報告してください" };
  }
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(state));
    return { ok: true };
  } catch {
    return { ok: false, error: "このブラウザに保存できませんでした（容量の不足など）。JSONを書き出して保存してください" };
  }
}

/** 退避した壊れたデータ（書き出して調べる用） */
export function listCorruptBackups(storage: KeyValueStorage): string[] {
  const keys: string[] = [];
  for (let i = 0; i < storage.length; i++) {
    const k = storage.key(i);
    if (k !== null && k.startsWith(CORRUPT_BACKUP_PREFIX)) keys.push(k);
  }
  return keys.sort();
}

/** 「このブラウザの保存データを消去」。このアプリの名前空間のキーだけを消す */
export function clearStorage(storage: KeyValueStorage): void {
  const keys: string[] = [];
  for (let i = 0; i < storage.length; i++) {
    const k = storage.key(i);
    if (k !== null && k.startsWith(STORAGE_NAMESPACE)) keys.push(k);
  }
  for (const k of keys) storage.removeItem(k);
}

// ---------------------------------------------------------------- 書き出し・読み込み

const pad = (n: number) => String(n).padStart(2, "0");

/** 書き出すファイル名（例 pmpoc-state-20261030-1730.json。日時は利用者の端末の時刻） */
export function exportFileName(now: Date): string {
  const d = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  const t = `${pad(now.getHours())}${pad(now.getMinutes())}`;
  return `${EXPORT_FILE_PREFIX}state-${d}-${t}.json`;
}

/** 読み込む前に、読み込むデータと現在のデータを並べて見せるための要約 */
export interface StateSummary {
  projectName: string;
  latestBaselineVersion: number | null;
  auditLogCount: number;
  lastExportedAt: string | null;
}

export function summarize(state: AppState): StateSummary {
  const versions = state.baselines.map((b) => b.version);
  return {
    projectName: state.project.name,
    latestBaselineVersion: versions.length > 0 ? Math.max(...versions) : null,
    auditLogCount: state.auditLogs.length,
    lastExportedAt: state.lastExportedAt,
  };
}

export type ImportComparison =
  /** 現在のデータに、追記しただけのデータ（そのまま読み込んでよい） */
  | { kind: "appendOnly" }
  /** 現在のデータの確定済みの記録が欠けている・変わっている（別のデータへの置き換えになる） */
  | { kind: "replaces"; reasons: string[] };

/** キーの順序に依らない比較のため、キーを並べ替えて文字列にする */
function canonical(v: unknown): string {
  return JSON.stringify(v, (_key, value: unknown) => {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return value;
    const sorted: Record<string, unknown> = {};
    for (const k of Object.keys(value).sort()) sorted[k] = (value as Record<string, unknown>)[k];
    return sorted;
  });
}

const same = (a: unknown, b: unknown) => canonical(a) === canonical(b);

/**
 * 読み込むデータが、現在の確定済みの記録（ベースライン・明細・承認と差戻しの記録・監査ログ・
 * スナップショット）を同じ内容のまま含み、追記しかしていないかを確かめる（CLAUDE.md 4章の追記のみ）。
 * あわせて、実績やWBSなどの件数が減る場合も「置き換え」として理由に出す（黙って消さない）
 */
export function compareForImport(current: AppState, incoming: AppState): ImportComparison {
  const reasons = [...frozenRecordChanges(current, incoming)];
  const shrinks: [string, number, number][] = [
    ["目的", current.objectives.length, incoming.objectives.length],
    ["WBS要素", current.wbsNodes.length, incoming.wbsNodes.length],
    ["見積", current.estimates.length, incoming.estimates.length],
    ["実績工数", current.timeEntries.length, incoming.timeEntries.length],
    ["取込の履歴", current.syncRuns.length, incoming.syncRuns.length],
  ];
  for (const [label, cur, inc] of shrinks) {
    if (inc < cur) reasons.push(`${label}が${cur - inc}件少なくなります`);
  }
  return reasons.length === 0 ? { kind: "appendOnly" } : { kind: "replaces", reasons };
}

/**
 * 確定済みの記録（ベースライン・明細・承認と差戻しの記録・監査ログ・スナップショット）が、
 * 追記以外の形で変わっていないかを確かめ、変わっていればその理由を返す（CLAUDE.md 4章）。
 * 読み込み時の比較と、画面の操作で状態を変えるとき（reducer の commit）の両方で使う
 */
export function frozenRecordChanges(current: AppState, next: AppState): string[] {
  const reasons: string[] = [];
  const prefixOf = <T>(label: string, cur: T[], inc: T[]) => {
    if (inc.length < cur.length) {
      reasons.push(`${label}が${cur.length - inc.length}件少なくなります`);
      return;
    }
    if (!cur.every((x, i) => same(x, inc[i]))) reasons.push(`${label}の内容が現在のデータと違います`);
  };
  prefixOf("確定済みのベースライン", current.baselines, next.baselines);
  prefixOf("G1+2承認・差戻しの記録", current.gateReviews, next.gateReviews);
  prefixOf("監査ログ", current.auditLogs, next.auditLogs);
  prefixOf("週次スナップショット", current.evmSnapshots, next.evmSnapshots);

  // v1 の確定（＝G1+2承認）の後は、企画の承認の状態と承認日を変えない
  if (current.baselines.length > 0 && (current.proposal.status !== next.proposal.status || current.proposal.approvedOn !== next.proposal.approvedOn)) {
    reasons.push("G1+2承認の状態・承認日が現在のデータと違います");
  }

  // 既存の版の明細は、増えも減りも変わりもしない（明細を足してよいのは新しい版だけ）
  for (const b of current.baselines) {
    const cur = current.baselineItems.filter((x) => x.baselineId === b.id).map(canonical).sort();
    const inc = next.baselineItems.filter((x) => x.baselineId === b.id).map(canonical).sort();
    if (!same(cur, inc)) reasons.push(`ベースラインv${b.version}の明細が現在のデータと違います`);
  }
  return reasons;
}
