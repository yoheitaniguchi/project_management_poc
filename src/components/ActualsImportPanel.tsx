// 実績工数の取込（独自書式のCSV。CLAUDE.md 8.2・6.2）。1行でも誤りがあれば何も取り込まず、誤りを行番号付きで示す。
// 取込の結果（成功・失敗）は取込履歴に残り、共通ヘッダーに最終取込として出る
import { useRef, useState, type ReactNode } from "react";
import type { AppState } from "../domain/types";
import { importManualCsv, MANUAL_CSV_HEADER, type ImportOutcome } from "../domain/timeImport";
import type { OpResult } from "../domain/proposal";
import { LIMITS } from "../domain/validate";
import { downloadText } from "../files";
import { formatDateTime, SYNC_RESULT_LABELS } from "../labels";

interface Props {
  state: AppState;
  exec: (op: (s: AppState) => OpResult) => boolean;
  newId: () => string;
  /** 取込を反映できなかった理由（読み取り専用など） */
  error: ReactNode;
  onGoToProposal: () => void;
}

type Message = { kind: "success" | "failure"; text: string; items: string[] };

/** 表示する誤り・確かめてほしいことの件数の上限 */
const SHOWN = 20;

// Excel で開いても文字化けしないよう、先頭に BOM を付ける（読み込みでは BOM を除く）
const SAMPLE = `\uFEFF${MANUAL_CSV_HEADER.join(",")}\n`;

const withMore = (items: string[], total: number) =>
  total > items.length ? [...items, `ほか${total - items.length}件。上の行を直して取り込み直すと、残りが表示されます`] : items;

function messageOf(outcome: ImportOutcome): Message {
  if (outcome.result === "failure") {
    return {
      kind: "failure",
      text: `誤りがあるため、何も取り込んでいません（${outcome.errors.length}件）。直してから、もう一度取り込んでください`,
      items: withMore(outcome.errors.slice(0, SHOWN), outcome.errors.length),
    };
  }
  return {
    kind: "success",
    text:
      `取り込みました：新しい実績 ${outcome.added}件、取込済みのため飛ばした行 ${outcome.skipped}件` +
      (outcome.warnings.length > 0 ? `。次の${outcome.warnings.length}件を確かめてください` : ""),
    items: withMore(outcome.warnings.slice(0, SHOWN), outcome.warnings.length),
  };
}

export function ActualsImportPanel({ state, exec, newId, error, onGoToProposal }: Props) {
  const [message, setMessage] = useState<Message | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const selection = useRef(0);
  const hasV1 = state.baselines.some((b) => b.version === 1);
  const hasPm = state.project.pmMemberId !== null;
  const recent = [...state.syncRuns].reverse().slice(0, 5);

  const onFile = async (file: File | undefined) => {
    // ファイル選択を取り消したときは、前の結果を残す
    if (!file) return;
    const mine = ++selection.current;
    setMessage(null);
    // 大きすぎるファイルは読む前に断る
    if (file.size > LIMITS.maxBytes) {
      setMessage({ kind: "failure", text: `ファイルが大きすぎます（上限 ${LIMITS.maxBytes / 1024 / 1024}MB）。取り込んでいません`, items: [] });
      return;
    }
    const text = await file.text();
    if (mine !== selection.current) return;
    const now = new Date();
    // 反映した状態から計算した結果を表示する（取込履歴は成功・失敗とも残す）
    let outcome: ImportOutcome | null = null;
    const applied = exec((s) => {
      outcome = importManualCsv(s, file.name, text, now, newId);
      return { ok: true, state: outcome.state };
    });
    if (fileRef.current) fileRef.current.value = "";
    if (applied && outcome) setMessage(messageOf(outcome));
  };

  return (
    <section aria-labelledby="sec-actuals">
      <h2 id="sec-actuals">実績工数の取込（CSV）</h2>
      {error}
      <p className="hint" id="actuals-format">
        1行目は「{MANUAL_CSV_HEADER.join(",")}」。作業日は YYYY-MM-DD、時間は0.25時間刻み（例：1.5）。実績はPMの実績として記録します。
        同じ作業日・WBSコード・メモの行は、再取込しても二重になりません。1行でも誤りがあれば何も取り込みません。
        作業日がベースラインv1の合意日より前の行（PoC開始前の作業）、フェーズや対象外のWPを指す行、0時間の行は取り込めません。
      </p>
      {!hasV1 ? (
        <p>上の「ベースライン」でv1を確定してから取り込めます。</p>
      ) : !hasPm ? (
        <p>
          体制にPMを登録してから取り込めます（取り込んだ実績はPMの実績として記録します）。{" "}
          <button type="button" className="link-button" onClick={onGoToProposal}>
            企画・目的画面で体制を登録する
          </button>
        </p>
      ) : (
        <p>
          <label htmlFor="actuals-file">実績のCSVを選ぶ</label>{" "}
          <input id="actuals-file" ref={fileRef} type="file" accept=".csv,text/csv" aria-describedby="actuals-format" onChange={(e) => void onFile(e.target.files?.[0])} />{" "}
          <button type="button" className="link-button" onClick={() => downloadText("pmpoc-actuals-template.csv", SAMPLE, "text/csv")}>
            見出しだけのCSVを書き出す
          </button>
        </p>
      )}
      {message && (
        <div className={message.kind === "success" ? "message--info" : "message--error"} role={message.kind === "success" ? "status" : "alert"}>
          <p>{message.text}</p>
          {message.items.length > 0 && (
            <ul>
              {message.items.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      {recent.length > 0 && (
        <table>
          <caption>最近の取込（新しい順に5件）</caption>
          <thead>
            <tr>
              <th scope="col">取り込んだ日時</th>
              <th scope="col">ファイル</th>
              <th scope="col">結果</th>
              <th scope="col">取り込んだ件数</th>
              <th scope="col">誤り（先頭の1件）</th>
            </tr>
          </thead>
          <tbody>
            {recent.map((r) => (
              <tr key={r.id}>
                <td>{formatDateTime(r.importedAt)}</td>
                <td>{r.fileName}</td>
                <td>{SYNC_RESULT_LABELS[r.result]}</td>
                <td>{r.count}件</td>
                <td>{r.error ? r.error.split(" / ")[0].slice(0, 80) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
