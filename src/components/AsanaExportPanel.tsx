// WPを Asana の CSV インポート用に書き出す（CLAUDE.md 6.2・8.2）。Asana へは通信せず、ファイルを端末に保存するだけ
import { useState } from "react";
import { asanaImportCsv } from "../domain/asanaExport";
import { localDate } from "../domain/calendar";
import type { AppState } from "../domain/types";
import { targetWorkPackages } from "../domain/wbs";
import { downloadText } from "../files";

export function AsanaExportPanel({ state }: { state: AppState }) {
  const [done, setDone] = useState<string | null>(null);
  const count = targetWorkPackages(state).length;

  const exportCsv = () => {
    const fileName = `pmpoc-asana-import-${localDate(new Date()).replace(/-/g, "")}.csv`;
    downloadText(fileName, asanaImportCsv(state), "text/csv");
    setDone(`${fileName} を書き出しました（WP ${count}件）。PCの、このリポジトリのフォルダの外に保存してください。`);
  };

  return (
    <section aria-labelledby="sec-asana-export">
      <h2 id="sec-asana-export">Asana への書き出し（CSV）</h2>
      <div className="hint" id="asana-export-hint">
        <p>
          今の計画画面の内容（ベースラインではありません）から、対象のWP（対象外を除く）を Asana の CSV
          インポートで読み込めるCSVに書き出します。Asana の取込画面で、列を次の項目に対応させてください（日付は YYYY-MM-DD の形式です）。
        </p>
        <ul>
          <li>Name → タスク名（WBSコードと作業名）</li>
          <li>Description → 説明（作業区分・紐付く目的・見積工数）</li>
          <li>Start Date → 開始日、Due Date → 期日</li>
          <li>Section → セクション（フェーズ名）</li>
        </ul>
        <p>
          注意：同じCSVを2回取り込むと、Asana にタスクが重複して作られます。タスク名の先頭のWBSコードは、実績を対応付けるために使うので Asana
          で変えないでください。Excel で開くと文字化けすることがありますが、Asana への取込には影響しません。
        </p>
      </div>
      <button type="button" disabled={count === 0} aria-describedby={count === 0 ? "asana-export-hint asana-export-empty" : "asana-export-hint"} onClick={exportCsv}>
        Asana 用のCSVを書き出す
      </button>
      {count === 0 && (
        <p className="hint" id="asana-export-empty">
          書き出す対象のWPがありません。上の WBS の表で、テンプレートを展開するか、WPを追加してください。
        </p>
      )}
      {done && (
        <p className="message--info" role="status">
          {done}
        </p>
      )}
    </section>
  );
}
