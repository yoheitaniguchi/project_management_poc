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
      <p className="hint" id="asana-export-hint">
        対象のWP（対象外を除く）を、Asana の CSV インポートで読み込めるCSVに書き出します。列は Name（WBSコードと作業名）・Description（作業区分・紐付く目的・見積工数）・Start
        Date・Due Date・Section（フェーズ名）です。Asana の取込画面で、列と項目の対応を選んでください。
      </p>
      <button type="button" disabled={count === 0} aria-describedby="asana-export-hint" onClick={exportCsv}>
        Asana 用のCSVを書き出す
      </button>
      {count === 0 && <p className="hint">書き出す対象のWPがありません。</p>}
      {done && (
        <p className="message--info" role="status">
          {done}
        </p>
      )}
    </section>
  );
}
