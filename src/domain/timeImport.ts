// 実績工数の取込（独自書式のCSV、取込元 manual_csv。CLAUDE.md 8.2・6.2・4章）。
// - 書式：1行目は見出し「作業日,WBSコード,時間,メモ」。時間は時間単位（0.25刻み）で、分にして保存する
// - 一意キー：manual_csv:作業日:WPのID:メモ。同じキーで時間も同じ行は取込済みとして飛ばす（冪等）。
//   時間が違う行があれば、黙って上書きせず、ファイル全体を取り込まない
// - 1行でも誤りがあれば何も取り込まない。成功・失敗とも取込履歴（SyncRun）に残す
// - 人間の判断（2026-10-22）：作業日がv1の合意日より前の行（PoC開始前の作業はACに含めない）、0時間の行、
//   phase を指す行、最初から対象外だったWP（どの版にも含まれたことのない対象外のWP）を指す行は受け付けない。
//   ベースラインの後に足したWPの実績は受け付ける
import { latestBaselineOf, type AppState, type SyncRun, type TimeEntry } from "./types";
import { localDate } from "./calendar";
import { parseCsv } from "./csv";
import { isValidDate, LIMITS } from "./validate";

export const MANUAL_CSV_HEADER = ["作業日", "WBSコード", "時間", "メモ"] as const;
const MAX_HOURS_PER_ROW = 24;
const MAX_MEMO_LENGTH = 500;
/** 取込履歴に残すエラーの件数の上限（残りは件数だけ書く） */
const MAX_ERRORS_SHOWN = 20;

export interface ImportOutcome {
  /** 取込履歴を足した状態（失敗したときも履歴は残す） */
  state: AppState;
  result: SyncRun["result"];
  added: number;
  skipped: number;
  errors: string[];
}

const manualKey = (workDate: string, wbsNodeId: string, memo: string) => `manual_csv:${workDate}:${wbsNodeId}:${memo}`;

function syncRun(fileName: string, now: Date, newId: () => string, result: SyncRun["result"], count: number, errors: string[]): SyncRun {
  const shown = errors.slice(0, MAX_ERRORS_SHOWN);
  const more = errors.length > shown.length ? `（ほか${errors.length - shown.length}件）` : "";
  const error = errors.length === 0 ? null : (shown.join(" / ") + more).slice(0, LIMITS.maxStringLength);
  return { id: newId(), importedAt: now.toISOString(), fileName: fileName.slice(0, 200), result, count, error };
}

/** 実績のCSVを取り込む。成功しても失敗しても、取込履歴を足した状態を返す */
export function importManualCsv(state: AppState, fileName: string, text: string, now: Date, newId: () => string): ImportOutcome {
  const failWith = (errors: string[]): ImportOutcome => ({
    state: { ...state, syncRuns: [...state.syncRuns, syncRun(fileName, now, newId, "failure", 0, errors)] },
    result: "failure",
    added: 0,
    skipped: 0,
    errors,
  });

  const v1 = state.baselines.find((b) => b.version === 1);
  if (!v1 || !latestBaselineOf(state.baselines)) return failWith(["ベースラインv1を確定してから取り込んでください"]);
  const memberId = state.project.pmMemberId;
  if (memberId === null) return failWith(["体制にPMが登録されていません（取り込んだ実績はPMの実績として記録します）"]);

  const parsed = parseCsv(text);
  if (!parsed.ok) return failWith([parsed.error]);
  const [header, ...rows] = parsed.rows;
  if (!header || header.length !== MANUAL_CSV_HEADER.length || header.some((h, i) => h.trim() !== MANUAL_CSV_HEADER[i])) {
    return failWith([`1行目の見出しは「${MANUAL_CSV_HEADER.join(",")}」にしてください`]);
  }
  if (rows.length === 0) return failWith(["取り込む行がありません"]);

  const today = localDate(now);
  const nodeByCode = new Map(state.wbsNodes.map((n) => [n.code, n]));
  const everBaselined = new Set(state.baselineItems.map((x) => x.wbsNodeId));
  const existing = new Map(state.timeEntries.map((t) => [t.uniqueKey, t]));
  const seen = new Map<string, number>();
  const errors: string[] = [];
  const added: TimeEntry[] = [];
  let skipped = 0;

  rows.forEach((cols, i) => {
    const line = i + 2;
    const err = (msg: string) => errors.push(`${line}行目：${msg}`);
    if (cols.length !== MANUAL_CSV_HEADER.length) return err(`列の数が${MANUAL_CSV_HEADER.length}ではありません`);
    const [workDate, code, hoursText, memo] = cols.map((c) => c.trim());
    if (!isValidDate(workDate)) return err("作業日は YYYY-MM-DD で書いてください");
    if (workDate < v1.approvedOn) return err(`作業日がベースラインv1の合意日（${v1.approvedOn}）より前です（PoC開始前の作業は実績に含めません）`);
    if (workDate > today) return err("作業日が未来の日付です");
    const node = nodeByCode.get(code);
    if (!node) return err(`WBSコード「${code.slice(0, 40)}」が見つかりません`);
    if (node.kind !== "work_package") return err(`${code} はフェーズです。実績はWPに付けてください`);
    if (node.excluded && !everBaselined.has(node.id)) return err(`${code} は対象外のWPです`);
    if (!/^\d+(\.\d+)?$/.test(hoursText)) return err("時間は数値で書いてください");
    const hours = Number(hoursText);
    if (hours <= 0 || hours > MAX_HOURS_PER_ROW) return err(`時間は0より大きく、${MAX_HOURS_PER_ROW}以下にしてください`);
    if (!Number.isInteger(hours * 4)) return err("時間は0.25刻みで書いてください");
    if (memo.length > MAX_MEMO_LENGTH) return err(`メモは${MAX_MEMO_LENGTH}文字以内にしてください`);
    const minutes = Math.round(hours * 60);
    const key = manualKey(workDate, node.id, memo);
    const prev = seen.get(key);
    if (prev !== undefined) return err(`${prev}行目と同じ作業日・WBSコード・メモの行です（1行にまとめてください）`);
    seen.set(key, line);
    const old = existing.get(key);
    if (old) {
      if (old.minutes === minutes) {
        skipped++;
        return;
      }
      return err(`取込済みの実績（${old.minutes / 60}時間）と時間が違います。直すときはメモを変えずに、取込済みの実績を消すか、ファイルの値を合わせてください`);
    }
    added.push({ id: newId(), wbsNodeId: node.id, memberId, workDate, minutes, source: "manual_csv", uniqueKey: key });
  });

  if (errors.length === 0 && state.timeEntries.length + added.length > LIMITS.maxItems) errors.push("実績の件数が上限を超えます");
  if (errors.length > 0) return failWith(errors);
  return {
    state: { ...state, timeEntries: [...state.timeEntries, ...added], syncRuns: [...state.syncRuns, syncRun(fileName, now, newId, "success", added.length, [])] },
    result: "success",
    added: added.length,
    skipped,
    errors: [],
  };
}
