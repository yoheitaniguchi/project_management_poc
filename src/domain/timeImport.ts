// 実績工数の取込（独自書式のCSV、取込元 manual_csv。CLAUDE.md 8.2・6.2・4章）。
// - 書式：1行目は見出し「作業日,WBSコード,時間,メモ」。時間は時間単位（0.25刻み）で、分にして保存する
// - 一意キー：manual_csv:作業日:WPのID:メモ。同じキーで時間も同じ行は取込済みとして飛ばす（冪等）。
//   時間が違う行があれば、黙って上書きせず、ファイル全体を取り込まない
// - 1行でも誤りがあれば何も取り込まない。成功・失敗とも取込履歴（SyncRun）に残す
// - 人間の判断（2026-10-22）：作業日がv1の合意日より前の行（PoC開始前の作業はACに含めない）、0時間の行、
//   phase を指す行、最初から対象外だったWP（どの版にも含まれたことのない対象外のWP）を指す行は受け付けない。
//   ベースラインの後に足したWPの実績は受け付ける
import type { AppState, SyncRun, TimeEntry } from "./types";
import { localDate } from "./calendar";
import { parseCsv } from "./csv";
import { isValidDate, LIMITS } from "./validate";

export const MANUAL_CSV_HEADER = ["作業日", "WBSコード", "時間", "メモ"] as const;
const MAX_HOURS_PER_ROW = 24;
/** 1日の実績の合計の上限（分）。取込済みの実績と合わせて数える */
const MAX_MINUTES_PER_DAY = 24 * 60;
const MAX_MEMO_LENGTH = 500;
/** 取込履歴に残すエラーの件数と長さの上限（残りは件数だけ書く） */
const MAX_ERRORS_SHOWN = 20;
const MAX_ERROR_LENGTH = 2000;

export interface ImportOutcome {
  /** 取込履歴を足した状態（失敗したときも履歴は残す） */
  state: AppState;
  result: SyncRun["result"];
  added: number;
  skipped: number;
  errors: string[];
  /** 取り込んだが、確かめてほしいこと（メモだけが違う取込済みの実績がある、など） */
  warnings: string[];
}

/** 一意キー（人間の判断：作業日・WPのID・メモ）。読み込み時の検証でも同じ形を確かめる */
export const manualKey = (workDate: string, wbsNodeId: string, memo: string) => `manual_csv:${workDate}:${wbsNodeId}:${memo}`;

export function syncRun(fileName: string, now: Date, newId: () => string, result: SyncRun["result"], count: number, errors: string[]): SyncRun {
  const shown = errors.slice(0, MAX_ERRORS_SHOWN);
  const more = errors.length > shown.length ? `（ほか${errors.length - shown.length}件）` : "";
  const error = errors.length === 0 ? null : (shown.join(" / ") + more).slice(0, MAX_ERROR_LENGTH);
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
    warnings: [],
  });

  const v1 = state.baselines.find((b) => b.version === 1);
  if (!v1) return failWith(["ベースラインv1を確定してから取り込んでください"]);
  const memberId = state.project.pmMemberId;
  if (memberId === null) return failWith(["体制にPMが登録されていません（取り込んだ実績はPMの実績として記録します）"]);

  const parsed = parseCsv(text);
  if (!parsed.ok) return failWith([parsed.error]);
  const [header, ...rows] = parsed.rows;
  if (!header || header.length !== MANUAL_CSV_HEADER.length || header.some((h, i) => h.trim() !== MANUAL_CSV_HEADER[i])) {
    return failWith([
      `1行目の見出しは「${MANUAL_CSV_HEADER.join(",")}」にしてください（Excel で保存するときは「CSV UTF-8（コンマ区切り）」を選んでください）`,
    ]);
  }
  if (rows.length === 0) return failWith(["取り込む行がありません"]);

  const today = localDate(now);
  const nodeByCode = new Map(state.wbsNodes.map((n) => [n.code, n]));
  const everBaselined = new Set(state.baselineItems.map((x) => x.wbsNodeId));
  const existing = new Map(state.timeEntries.map((t) => [t.uniqueKey, t]));
  // 1日の合計（取込済みの手入力の実績を含む。Asana の差分は作業日が書き出した日になるので数えない）と、同じ作業日・WPの取込済みのメモ
  const minutesOfDay = new Map<string, number>();
  const memosOf = new Map<string, Set<string>>();
  for (const t of state.timeEntries) {
    if (t.source !== "manual_csv") continue;
    minutesOfDay.set(t.workDate, (minutesOfDay.get(t.workDate) ?? 0) + t.minutes);
    const k = `${t.workDate}:${t.wbsNodeId}`;
    memosOf.set(k, (memosOf.get(k) ?? new Set()).add(t.uniqueKey));
  }
  const withAsana = new Set(state.timeEntries.filter((t) => t.source === "asana_csv").map((t) => t.wbsNodeId));
  const seen = new Map<string, number>();
  const errors: string[] = [];
  const warnings: string[] = [];
  const added: TimeEntry[] = [];
  let skipped = 0;

  rows.forEach((cols, i) => {
    const line = parsed.lines[i + 1];
    const err = (msg: string) => errors.push(`${line}行目：${msg}`);
    if (cols.length !== MANUAL_CSV_HEADER.length) return err(`列の数が${MANUAL_CSV_HEADER.length}ではありません`);
    const [workDate, code, hoursText, memo] = cols.map((c) => c.trim());
    if (!isValidDate(workDate)) return err("作業日は YYYY-MM-DD で書いてください");
    const node = nodeByCode.get(code);
    if (!node) return err(`WBSコード「${code.slice(0, 40)}」が見つかりません`);
    if (node.kind !== "work_package") return err(`${code} はフェーズです。実績はWPに付けてください`);
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
    // 取込済みの行は、その後のWPの状態に関わらず飛ばす（同じファイルの再取込を冪等にするため）
    const old = existing.get(key);
    if (old) {
      if (old.minutes === minutes) {
        skipped++;
        return;
      }
      return err(
        `取込済みの実績（${old.minutes / 60}時間）と時間が違います。取込済みの実績は直せないため、この行の時間を取込済みと同じにしてから取り込んでください`,
      );
    }
    if (workDate < v1.approvedOn) return err(`作業日がベースラインv1の合意日（${v1.approvedOn}）より前です（PoC開始前の作業は実績に含めません）`);
    if (workDate > today) return err("作業日が未来の日付です");
    if (node.excluded && !everBaselined.has(node.id)) return err(`${code} は対象外のWPです`);
    const dayTotal = (minutesOfDay.get(workDate) ?? 0) + minutes;
    if (dayTotal > MAX_MINUTES_PER_DAY) return err(`${workDate} の実績の合計が24時間を超えます（取込済みを含む）`);
    minutesOfDay.set(workDate, dayTotal);
    // 人間の判断（2026-10-25）：Asana の取込を始めたら手入力のCSVは使わない。両方の実績があれば二重になっていないか確かめてもらう
    if (withAsana.has(node.id)) warnings.push(`${line}行目：${code} には Asana から取り込んだ実績もあります（同じ作業を両方で入れていないか確かめてください）`);
    if (memosOf.has(`${workDate}:${node.id}`)) warnings.push(`${line}行目：同じ作業日・WBSコードで、メモが違う取込済みの実績があります（二重になっていないか確かめてください）`);
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
    warnings,
  };
}
