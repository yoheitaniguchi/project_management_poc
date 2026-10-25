// 実績工数の取込（CLAUDE.md 8.2・8.4・6.2）：Asana から書き出したCSV（差分方式）と、独自書式の手入力のCSV。
// 1行でも誤りがあれば何も取り込まず、誤りを行番号付きで示す。取込の結果（成功・失敗）は取込履歴に残り、共通ヘッダーに最終取込として出る
import { useRef, useState, type ReactNode } from "react";
import { ASANA_COLUMNS, importAsanaCsv, type AsanaImportOutcome } from "../domain/asanaImport";
import { localDate } from "../domain/calendar";
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

function messageOfAsana(outcome: AsanaImportOutcome, exportedOn: string): Message {
  if (outcome.result === "failure") return messageOf(outcome);
  // 0件の項目は省く（新しい実績の件数は、0件でも必ず示す）
  const parts = [
    `新しい実績 ${outcome.added}件（${exportedOn} の実績として記録）`,
    outcome.skipped > 0 ? `累計が前回と同じため飛ばしたタスク ${outcome.skipped}件` : "",
    outcome.completed > 0 ? `Asana の完了を取り込んだWP ${outcome.completed}件` : "",
    outcome.reopened > 0 ? `完了を取り消したWP ${outcome.reopened}件` : "",
    outcome.linked > 0 ? `タスクを対応付けたWP ${outcome.linked}件` : "",
  ].filter(Boolean);
  return {
    kind: "success",
    text: `取り込みました：${parts.join("、")}` + (outcome.warnings.length > 0 ? `。次の${outcome.warnings.length}件を確かめてください` : ""),
    items: withMore(outcome.warnings.slice(0, SHOWN), outcome.warnings.length),
  };
}

function MessageBox({ message }: { message: Message | null }) {
  if (!message) return null;
  return (
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
  );
}

/** ファイルを読む（大きすぎるファイルは読む前に断る）。読めなければ失敗のメッセージを返す */
async function readFile(file: File): Promise<{ text: string } | { message: Message }> {
  if (file.size > LIMITS.maxBytes) {
    return { message: { kind: "failure", text: `ファイルが大きすぎます（上限 ${LIMITS.maxBytes / 1024 / 1024}MB）。取り込んでいません`, items: [] } };
  }
  return { text: await file.text() };
}

export function ActualsImportPanel({ state, exec, newId, error, onGoToProposal }: Props) {
  const [message, setMessage] = useState<Message | null>(null);
  const [asanaMessage, setAsanaMessage] = useState<Message | null>(null);
  const [exportedOn, setExportedOn] = useState(() => localDate(new Date()));
  const fileRef = useRef<HTMLInputElement>(null);
  const asanaFileRef = useRef<HTMLInputElement>(null);
  const selection = useRef(0);
  const v1 = state.baselines.find((b) => b.version === 1);
  const hasV1 = v1 !== undefined;
  const hasAsana = state.timeEntries.some((t) => t.source === "asana_csv");
  const hasPm = state.project.pmMemberId !== null;
  const recent = [...state.syncRuns].reverse().slice(0, 5);

  const onFile = async (file: File | undefined) => {
    // ファイル選択を取り消したときは、前の結果を残す
    if (!file) return;
    const mine = ++selection.current;
    setMessage(null);
    setAsanaMessage(null);
    const read = await readFile(file);
    if (mine !== selection.current) return;
    if ("message" in read) return setMessage(read.message);
    const text = read.text;
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

  const onAsanaFile = async (file: File | undefined) => {
    if (!file) return;
    const mine = ++selection.current;
    setAsanaMessage(null);
    setMessage(null);
    const read = await readFile(file);
    if (mine !== selection.current) return;
    if ("message" in read) return setAsanaMessage(read.message);
    const now = new Date();
    let outcome: AsanaImportOutcome | null = null;
    const applied = exec((s) => {
      outcome = importAsanaCsv(s, file.name, read.text, exportedOn, now, newId);
      return { ok: true, state: outcome.state };
    });
    if (asanaFileRef.current) asanaFileRef.current.value = "";
    if (applied && outcome) setAsanaMessage(messageOfAsana(outcome, exportedOn));
  };

  return (
    <section aria-labelledby="sec-actuals">
      <h2 id="sec-actuals">実績工数の取込（CSV）</h2>
      {error}
      {!hasV1 ? (
        <p>上の「ベースライン」でv1を確定してから取り込めます。</p>
      ) : (
        !hasPm && (
          <p>
            体制にPMを登録してから取り込めます（取り込んだ実績はPMの実績として記録します）。{" "}
            <button type="button" className="link-button" onClick={onGoToProposal}>
              企画・目的画面で体制を登録する
            </button>
          </p>
        )
      )}
      <h3>Asana から書き出したCSV</h3>
      <p className="hint" id="asana-format">
        Asana のプロジェクトで「CSVを書き出す」で書き出したファイルを選びます（列「{Object.values(ASANA_COLUMNS).join("」「")}」を使います）。
        Asana の実績はタスクごとの累計なので、前回までに取り込んだ累計との差を、下の「CSVを書き出した日」の実績として記録します（同じファイルを取り込み直しても増えません）。
        タスク名の先頭のWBSコードでWPに対応付け、2回目からはタスクで対応付けます。Asana で完了のタスクは、その完了日で完了にします（手動の設定より優先します）。
        Asana の取込を始めたら、手入力のCSVは使わないでください（同じ作業が二重になります）。
      </p>
      {hasV1 && hasPm && (
        <>
          <p>
            <label htmlFor="asana-exported-on">CSVを書き出した日</label>{" "}
            <input
              id="asana-exported-on"
              type="date"
              value={exportedOn}
              min={v1.approvedOn}
              max={localDate(new Date())}
              aria-describedby="asana-exported-on-hint"
              onChange={(e) => setExportedOn(e.target.value)}
            />{" "}
            <span id="asana-exported-on-hint" className="hint">
              Asana でCSVを書き出した日を入れてください。今回増えた分は、すべてこの日の実績になり、後から直せません
            </span>
          </p>
          <p>
            <label htmlFor="asana-file">Asana のCSVを選ぶ</label>{" "}
            <input
              id="asana-file"
              ref={asanaFileRef}
              type="file"
              accept=".csv,text/csv"
              aria-describedby={exportedOn === "" ? "asana-format asana-date-missing" : "asana-format"}
              disabled={exportedOn === ""}
              onChange={(e) => void onAsanaFile(e.target.files?.[0])}
            />
            {exportedOn === "" && (
              <span id="asana-date-missing" className="hint">
                {" "}
                先に「CSVを書き出した日」を入れてください
              </span>
            )}
          </p>
        </>
      )}
      <MessageBox message={asanaMessage} />
      <h3>手入力のCSV（独自書式）</h3>
      <p className="hint" id="actuals-format">
        1行目は「{MANUAL_CSV_HEADER.join(",")}」。作業日は YYYY-MM-DD、時間は0.25時間刻み（例：1.5）。実績はPMの実績として記録します。
        同じ作業日・WBSコード・メモの行は、再取込しても二重になりません。1行でも誤りがあれば何も取り込みません。
        作業日がベースラインv1の合意日より前の行（PoC開始前の作業）、フェーズや対象外のWPを指す行、0時間の行は取り込めません。
      </p>
      {hasAsana && (
        <p className="message--warn">
          Asana から実績を取り込んでいます。同じ作業を手入力のCSVでも入れると二重になるので、手入力のCSVは Asana で管理していない作業だけに使ってください。
        </p>
      )}
      {hasV1 && hasPm && (
        <p>
          <label htmlFor="actuals-file">実績のCSVを選ぶ</label>{" "}
          <input id="actuals-file" ref={fileRef} type="file" accept=".csv,text/csv" aria-describedby="actuals-format" onChange={(e) => void onFile(e.target.files?.[0])} />{" "}
          <button type="button" className="link-button" onClick={() => downloadText("pmpoc-actuals-template.csv", SAMPLE, "text/csv")}>
            見出しだけのCSVを書き出す
          </button>
        </p>
      )}
      <MessageBox message={message} />
      {recent.length > 0 && (
        <table>
          <caption>最近の取込（Asana・手入力の両方。新しい順に5件。件数は新しく記録した実績の件数）</caption>
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
