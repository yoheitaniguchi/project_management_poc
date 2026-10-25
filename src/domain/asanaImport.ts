// Asana から書き出したCSVの取込（取込元 asana_csv。CLAUDE.md 6.2・8.4・5章）。
// Asana のCSVは、実績がタスクごとの累計（列「Actual time」、時間:分）で、作業日ごとの明細が無い。
// 人間の判断（2026-10-25）：
// - 差分方式：取り込むたびに、タスクごとの「今回の累計 − 前回までに取り込んだ累計」を新しい実績にする。
//   一意キーは asana_csv:タスクGID:今回の累計（分）。同じファイルを取り込み直しても増えない（冪等）。累計が減っていたら何も取り込まない
// - 差分の作業日は、取込の画面で入れる「CSVを書き出した日」
// - Asana の取込を始めたら手入力のCSVは使わない（同じWPに両方の実績があれば警告する）
// - 完了：Asana で完了ならその完了日を使い、手動の設定より優先する。Asana で未完了なら手動の完了はそのまま残す
//   （前回 Asana の完了として取り込んだWPが、Asana で未完了に戻っていれば、完了を取り消す）
// - 対応付け：タスクGIDを記録したWPがあればそれを使い、無ければタスク名の先頭のWBSコードで照合して、タスクGIDをWPに記録する。
//   対応するWPが無いタスクは、実績が無ければ飛ばして警告し、実績があれば誤り（ファイル全体を取り込まない）
// 1行でも誤りがあれば何も取り込まない。成功・失敗とも取込履歴（SyncRun）に残す
import { localDate } from "./calendar";
import { clearCompleted, setCompleted } from "./completion";
import { parseCsv } from "./csv";
import { syncRun, type ImportOutcome } from "./timeImport";
import type { AppState, TimeEntry, WbsNode } from "./types";
import { ASANA_GID_PATTERN, ASANA_KEY_PATTERN, isValidDate, LIMITS } from "./validate";

/** 取込に使う列（Asana のCSVの見出し）。ほかの列は読まない */
export const ASANA_COLUMNS = { gid: "Task ID", name: "Name", completedAt: "Completed At", actual: "Actual time" } as const;

export const asanaKey = (gid: string, cumulativeMinutes: number) => `asana_csv:${gid}:${cumulativeMinutes}`;

export interface AsanaImportOutcome extends ImportOutcome {
  /** Asana の完了を取り込んで完了にしたWP（完了日・出どころが変わったもの） */
  completed: number;
  /** 前回 Asana の完了として取り込み、Asana で未完了に戻ったため完了を取り消したWP */
  reopened: number;
  /** 新しくタスクGIDを記録したWP */
  linked: number;
}

/** 「時間:分」（例 5:00、12:30）を分にする。空は0。読めなければ null */
export function parseAsanaDuration(text: string): number | null {
  const t = text.trim();
  if (t === "") return 0;
  const m = /^(\d{1,5}):([0-5]\d)$/.exec(t);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** 完了日（YYYY-MM-DD、または日時の先頭が YYYY-MM-DD）。空は null。読めなければ undefined */
function parseCompletedAt(text: string): string | null | undefined {
  const t = text.trim();
  if (t === "") return null;
  const d = t.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}($|[T ])/.test(t) && isValidDate(d) ? d : undefined;
}

/** WBSコード：タスク名の先頭（最初の空白まで）。Asana 用のCSVの書き出しは「WBSコード 作業名」の形にしている */
const codeOfName = (name: string) => name.trim().split(/[\s\u3000]/)[0] ?? "";

/**
 * Asana のCSVを取り込む。exportedOn は CSV を書き出した日（差分の実績の作業日）。
 * 成功しても失敗しても、取込履歴を足した状態を返す
 */
export function importAsanaCsv(state: AppState, fileName: string, text: string, exportedOn: string, now: Date, newId: () => string): AsanaImportOutcome {
  const failWith = (errors: string[]): AsanaImportOutcome => ({
    state: { ...state, syncRuns: [...state.syncRuns, syncRun(fileName, now, newId, "failure", 0, errors)] },
    result: "failure",
    added: 0,
    skipped: 0,
    completed: 0,
    reopened: 0,
    linked: 0,
    errors,
    warnings: [],
  });

  const v1 = state.baselines.find((b) => b.version === 1);
  if (!v1) return failWith(["ベースラインv1を確定してから取り込んでください"]);
  const memberId = state.project.pmMemberId;
  if (memberId === null) return failWith(["体制にPMが登録されていません（取り込んだ実績はPMの実績として記録します）"]);
  const today = localDate(now);
  if (typeof exportedOn !== "string" || !isValidDate(exportedOn)) return failWith(["CSVを書き出した日を入力してください"]);
  if (exportedOn > today) return failWith(["CSVを書き出した日に未来の日付は入れられません"]);
  if (exportedOn < v1.approvedOn) return failWith([`CSVを書き出した日が、ベースラインv1の合意日（${v1.approvedOn}）より前です`]);

  const parsed = parseCsv(text);
  if (!parsed.ok) return failWith([parsed.error]);
  const [header, ...rows] = parsed.rows;
  const indexOf = (name: string) => (header ?? []).findIndex((h) => h.trim() === name);
  const col = { gid: indexOf(ASANA_COLUMNS.gid), name: indexOf(ASANA_COLUMNS.name), completedAt: indexOf(ASANA_COLUMNS.completedAt), actual: indexOf(ASANA_COLUMNS.actual) };
  const missing = (Object.keys(col) as (keyof typeof col)[]).filter((k) => col[k] < 0).map((k) => `「${ASANA_COLUMNS[k]}」`);
  if (missing.length > 0) {
    return failWith([`Asana のCSVに、列${missing.join("・")}がありません（Asana のプロジェクトの「CSVを書き出す」で書き出したファイルを選んでください。実績を取り込むには、タイムトラッキングを有効にしてください）`]);
  }
  if (rows.length === 0) return failWith(["取り込む行がありません"]);

  const nodeByGid = new Map(state.wbsNodes.filter((n) => n.asanaTaskGid !== null).map((n) => [n.asanaTaskGid as string, n]));
  const nodeByCode = new Map(state.wbsNodes.map((n) => [n.code, n]));
  const everBaselined = new Set(state.baselineItems.map((x) => x.wbsNodeId));
  const withManual = new Set(state.timeEntries.filter((t) => t.source === "manual_csv").map((t) => t.wbsNodeId));
  // タスクごとの、取込済みの累計と最後の作業日
  const imported = new Map<string, { cumulative: number; lastDate: string }>();
  for (const t of state.timeEntries) {
    const m = t.source === "asana_csv" ? ASANA_KEY_PATTERN.exec(t.uniqueKey) : null;
    if (!m) continue;
    const prev = imported.get(m[1]);
    imported.set(m[1], { cumulative: Math.max(prev?.cumulative ?? 0, Number(m[2])), lastDate: prev && prev.lastDate > t.workDate ? prev.lastDate : t.workDate });
  }

  const errors: string[] = [];
  const warnings: string[] = [];
  const added: TimeEntry[] = [];
  const links = new Map<string, string>(); // WPのID → タスクGID（新しく記録するもの）
  const completions: { node: WbsNode; completedOn: string }[] = [];
  const reopens: WbsNode[] = [];
  const seenGid = new Map<string, number>();
  const seenNode = new Map<string, number>();
  let skipped = 0;

  rows.forEach((cols, i) => {
    const line = parsed.lines[i + 1];
    const err = (msg: string) => errors.push(`${line}行目：${msg}`);
    const warn = (msg: string) => warnings.push(`${line}行目：${msg}`);
    const cell = (k: keyof typeof col) => (cols[col[k]] ?? "").trim();
    const gid = cell("gid");
    const name = cell("name");
    const label = name.slice(0, 60) || "（タスク名なし）";
    if (!ASANA_GID_PATTERN.test(gid)) return err(`「${ASANA_COLUMNS.gid}」が数字ではありません（${label}）`);
    const prevLine = seenGid.get(gid);
    if (prevLine !== undefined) return err(`${prevLine}行目と同じタスクです`);
    seenGid.set(gid, line);
    const actual = parseAsanaDuration(cell("actual"));
    if (actual === null) return err(`「${ASANA_COLUMNS.actual}」は「時間:分」（例 5:00）で書いてください（${label}）`);
    if (actual > LIMITS.maxHours * 60) return err(`「${ASANA_COLUMNS.actual}」が上限（${LIMITS.maxHours}時間）を超えています（${label}）`);
    const completedAt = parseCompletedAt(cell("completedAt"));
    if (completedAt === undefined) return err(`「${ASANA_COLUMNS.completedAt}」は日付（YYYY-MM-DD）で書いてください（${label}）`);

    const code = codeOfName(name);
    const byGid = nodeByGid.get(gid);
    const node = byGid ?? nodeByCode.get(code);
    if (!node) {
      if (actual > 0) return err(`対応するWPがありません（タスク名の先頭のWBSコード「${code.slice(0, 40)}」が見つかりません。${label}）`);
      return warn(`対応するWPが無いため飛ばしました（${label}）`);
    }
    // 実績も完了も無い行は、対応付けに迷う行でも飛ばす（Asana 側で複製したタスクなど。対応するWPが無いタスクと同じ扱い）
    const empty = actual === 0 && completedAt === null;
    if (!byGid && node.asanaTaskGid !== null) {
      if (empty) return warn(`${node.code} は別のAsanaタスクに対応付け済みのため飛ばしました（${label}）`);
      return err(`${node.code} は別のAsanaタスク（${node.asanaTaskGid}）に対応付け済みです（${label}）`);
    }
    if (node.kind !== "work_package") {
      if (actual > 0) return err(`${node.code} はフェーズです。実績はWPのタスクに付けてください`);
      return warn(`${node.code} はフェーズのため飛ばしました`);
    }
    const nodeLine = seenNode.get(node.id);
    if (nodeLine !== undefined) {
      if (empty) return warn(`${nodeLine}行目と同じWP（${node.code}）を指しているため飛ばしました（${label}）`);
      return err(`${nodeLine}行目と同じWP（${node.code}）を指しています`);
    }
    seenNode.set(node.id, line);
    if (node.excluded && !everBaselined.has(node.id)) {
      if (actual > 0 || completedAt !== null) return err(`${node.code} は対象外のWPです`);
      return warn(`${node.code} は対象外のWPのため飛ばしました`);
    }
    if (node.asanaTaskGid === null) links.set(node.id, gid);

    // 実績：前回までに取り込んだ累計との差分
    const prev = imported.get(gid);
    const delta = actual - (prev?.cumulative ?? 0);
    if (delta < 0) {
      return err(`${node.code} の実績の累計（${actual / 60}時間）が、前回までに取り込んだ累計（${(prev?.cumulative ?? 0) / 60}時間）より減っています。取込済みの実績は直せないため、Asana の記録を確かめてください`);
    }
    if (delta === 0) {
      if (actual > 0) skipped++;
    } else {
      if (prev && exportedOn < prev.lastDate) return err(`CSVを書き出した日が、${node.code} の前回の取込（${prev.lastDate}）より前です`);
      if (withManual.has(node.id)) warn(`${node.code} には手入力のCSVの実績もあります（同じ作業を両方で入れていないか確かめてください）`);
      added.push({ id: newId(), wbsNodeId: node.id, memberId, workDate: exportedOn, minutes: delta, source: "asana_csv", uniqueKey: asanaKey(gid, actual) });
    }

    // 完了：Asana の完了を優先する。Asana で未完了なら、前回 Asana から取り込んだ完了だけを取り消す
    if (completedAt !== null) {
      if (completedAt > today) return err(`${node.code} の完了日が未来の日付です`);
      // 改版で外した（対象外の）WPは完了にできないので、完了だけを飛ばす（実績は取り込む）
      if (node.excluded) return warn(`${node.code} は対象外のWPのため、Asana の完了は取り込みませんでした`);
      if (node.completedOn !== completedAt || node.completionSource !== "asana") completions.push({ node, completedOn: completedAt });
    } else if (node.completionSource === "asana") {
      reopens.push(node);
    }
  });

  if (errors.length === 0 && state.timeEntries.length + added.length > LIMITS.maxItems) errors.push("実績の件数が上限を超えます");
  if (errors.length > 0) return failWith(errors);

  let next: AppState = {
    ...state,
    wbsNodes: state.wbsNodes.map((n) => (links.has(n.id) ? { ...n, asanaTaskGid: links.get(n.id) as string } : n)),
    timeEntries: [...state.timeEntries, ...added],
  };
  // 完了の反映（監査ログに残す）。反映できないものが1件でもあれば、何も取り込まない
  for (const c of completions) {
    const r = setCompleted(next, c.node.id, c.completedOn, now, newId, "asana");
    if (!r.ok) return failWith([`${c.node.code} の完了を取り込めません：${r.error}`]);
    next = r.state;
  }
  for (const n of reopens) {
    const r = clearCompleted(next, n.id, now, newId);
    if (!r.ok) return failWith([`${n.code} の完了を取り消せません：${r.error}`]);
    next = r.state;
    warnings.push(`${n.code} は Asana で未完了に戻っていたため、完了を取り消しました`);
  }
  return {
    state: { ...next, syncRuns: [...next.syncRuns, syncRun(fileName, now, newId, "success", added.length, [])] },
    result: "success",
    added: added.length,
    skipped,
    completed: completions.length,
    reopened: reopens.length,
    linked: links.size,
    errors: [],
    warnings,
  };
}
