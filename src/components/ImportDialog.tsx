// JSONの読み込み。現在のデータと並べて見せ、確定済みの記録を変える（置き換えになる）場合は確認を求める。
// 置き換えは取り消せないので、先に現在のデータを書き出せるようにする
import { useState } from "react";
import { compareForImport, parseStateText, summarize, type ImportComparison, type StateSummary } from "../domain/persistence";
import type { AppState } from "../domain/types";
import { formatDateTime } from "../labels";
import { Modal } from "./Modal";

interface Props {
  current: AppState;
  onImport: (state: AppState, allowReplace: boolean) => boolean;
  onExportCurrent: () => void;
  onClose: () => void;
}

type Loaded = { fileName: string; state: AppState; comparison: ImportComparison };

function SummaryRows({ s }: { s: StateSummary }) {
  return (
    <>
      <td>{s.projectName || "（未入力）"}</td>
      <td>{s.latestBaselineVersion === null ? "未確定" : `v${s.latestBaselineVersion}`}</td>
      <td>{s.auditLogCount}件</td>
      <td>{s.lastExportedAt ? formatDateTime(s.lastExportedAt) : "なし"}</td>
    </>
  );
}

export function ImportDialog({ current, onImport, onExportCurrent, onClose }: Props) {
  const [errors, setErrors] = useState<string[]>([]);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [exported, setExported] = useState(false);

  const onFile = async (file: File | undefined) => {
    setLoaded(null);
    setConfirmed(false);
    if (!file) return;
    const result = parseStateText(await file.text());
    if (!result.ok) {
      setErrors(result.errors.slice(0, 10));
      return;
    }
    setErrors([]);
    setLoaded({ fileName: file.name, state: result.state, comparison: compareForImport(current, result.state) });
  };

  const replaces = loaded?.comparison.kind === "replaces";
  const canImport = loaded !== null && (!replaces || confirmed);

  return (
    <Modal title="JSONを読み込む" onClose={onClose}>
      <p>このアプリで書き出したJSONファイルを選んでください。読み込むと、今このブラウザにあるデータと入れ替わります。</p>
      <p>
        <label>
          ファイル：{" "}
          <input type="file" accept="application/json,.json" onChange={(e) => void onFile(e.target.files?.[0])} />
        </label>
      </p>

      {errors.length > 0 && (
        <div className="message--error" role="alert">
          <p>このファイルは読み込めません。現在のデータは変わっていません。</p>
          <ul>
            {errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </div>
      )}

      {loaded && (
        <>
          <table>
            <caption>読み込むデータと現在のデータ</caption>
            <thead>
              <tr>
                <th scope="col"></th>
                <th scope="col">案件名</th>
                <th scope="col">最新のベースライン</th>
                <th scope="col">監査ログ</th>
                <th scope="col">書き出し日時</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row">読み込むファイル（{loaded.fileName}）</th>
                <SummaryRows s={summarize(loaded.state)} />
              </tr>
              <tr>
                <th scope="row">現在のデータ</th>
                <SummaryRows s={summarize(current)} />
              </tr>
            </tbody>
          </table>
          {loaded.comparison.kind === "replaces" && (
            <div className="message--warn" role="alert">
              <p>
                <strong>注意：</strong>このファイルを読み込むと、現在のデータの記録が失われます。古いファイルではないか確認してください。
              </p>
              <ul>
                {loaded.comparison.reasons.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
              <label>
                <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />{" "}
                現在のデータが失われることを理解したうえで、置き換えます
              </label>
            </div>
          )}
        </>
      )}

      <div className="modal__actions">
        <button type="button" autoFocus onClick={onClose}>
          キャンセル
        </button>
        <button
          type="button"
          onClick={() => {
            onExportCurrent();
            setExported(true);
          }}
        >
          {exported ? "現在のデータを書き出しました" : "先に現在のデータを書き出す"}
        </button>
        <button
          type="button"
          className="button--primary"
          disabled={!canImport}
          aria-describedby={!canImport ? "import-disabled-reason" : undefined}
          onClick={() => {
            if (loaded && onImport(loaded.state, replaces)) onClose();
          }}
        >
          読み込む
        </button>
      </div>
      {!canImport && (
        <p id="import-disabled-reason" className="hint">
          {loaded === null ? "ファイルを選ぶと読み込めます。" : "置き換えの確認にチェックを入れると読み込めます。"}
        </p>
      )}
    </Modal>
  );
}
