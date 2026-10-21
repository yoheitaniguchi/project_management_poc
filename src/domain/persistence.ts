// 状態の保存（CLAUDE.md 6.1、docs/security/checklist.md E）。
// - localStorage への自動保存（普段使い）。キーには名前空間を付ける
// - JSONファイルの書き出し・読み込み（毎週の正式な記録）
// ここは純粋な関数と、注入された Storage だけを使う（画面やブラウザの API に直接依存しない）。
import { CURRENT_SCHEMA_VERSION, type AppState } from "./types";
import { LIMITS, validateState } from "./validate";

export const STORAGE_NAMESPACE = "project_management_poc:";
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
 * 型を変えて CURRENT_SCHEMA_VERSION を上げたら、ここに足す。移行の後で必ず検証する
 */
const MIGRATIONS: Record<number, Migration> = {};

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
    current = step(current);
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

  // 空の状態で上書きして消してしまわないよう、元の値を別のキーに退避する
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

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * 読み込むデータが、現在の確定済みの記録（ベースライン・明細・監査ログ・スナップショット）を
 * 同じ内容のまま先頭に含むかを確かめる（CLAUDE.md 4章の追記のみ）。
 * どちらも validateState で組み立て直した状態なので、キーの順序が揃い JSON の比較で判定できる
 */
export function compareForImport(current: AppState, incoming: AppState): ImportComparison {
  const reasons: string[] = [];
  const prefixOf = <T>(label: string, cur: T[], inc: T[]) => {
    if (inc.length < cur.length) {
      reasons.push(`${label}が${cur.length - inc.length}件少なくなります`);
      return;
    }
    if (!cur.every((x, i) => same(x, inc[i]))) reasons.push(`${label}の内容が現在のデータと違います`);
  };
  prefixOf("確定済みのベースライン", current.baselines, incoming.baselines);
  prefixOf("ベースラインの明細", current.baselineItems, incoming.baselineItems);
  prefixOf("監査ログ", current.auditLogs, incoming.auditLogs);
  prefixOf("週次スナップショット", current.evmSnapshots, incoming.evmSnapshots);
  return reasons.length === 0 ? { kind: "appendOnly" } : { kind: "replaces", reasons };
}
