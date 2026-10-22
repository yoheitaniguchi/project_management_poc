// 全画面の上部に出す共通ヘッダー（CLAUDE.md 7章）：案件の目的、最終取込日時と結果、JSONの書き出しの状況とメニュー
import type { AppState } from "../domain/types";
import { exportReminder, STALE_DAYS } from "../domain/exportReminder";
import { formatDateTime, SYNC_RESULT_LABELS } from "../labels";

interface Props {
  state: AppState;
  now: Date;
  onGoToProposal: () => void;
  onExport: () => void;
  onImport: () => void;
  onExportBackups: (() => void) | null;
  onClear: () => void;
  /** 他のタブで変更されて読み取り専用のとき、消去を止める理由 */
  readOnlyReason: string | null;
}

export function AppHeader({ state, now, onGoToProposal, onExport, onImport, onExportBackups, onClear, readOnlyReason }: Props) {
  const lastSync = state.syncRuns.at(-1);
  const reminder = exportReminder(state, now);
  const reminderText =
    reminder.kind === "never"
      ? "まだ一度もJSONを書き出していません"
      : reminder.kind === "stale"
        ? `最後にJSONを書き出してから${reminder.days}日たっています（${STALE_DAYS}日以上）`
        : reminder.kind === "afterRecord"
          ? `${reminder.record}の後に、JSONを書き出していません`
          : reminder.kind === "futureExport"
            ? "最終書き出しの日時が今より後になっています（端末の時計を確認してください）"
            : null;

  return (
    <header className="app-header">
      <div className="app-header__row">
        <p className="app-header__title">{state.project.name || "PM支援ツールPoC"}</p>
        <nav className="app-header__menu" aria-label="データの保存">
          <button type="button" onClick={onExport}>
            JSONを書き出す
          </button>
          <button type="button" onClick={onImport} disabled={readOnlyReason !== null} aria-describedby={readOnlyReason ? "readonly-reason" : undefined}>
            JSONを読み込む
          </button>
          {onExportBackups && (
            <button type="button" onClick={onExportBackups}>
              退避したデータを書き出す
            </button>
          )}
          <button
            type="button"
            className="button--danger"
            onClick={onClear}
            disabled={readOnlyReason !== null}
            aria-describedby={readOnlyReason ? "readonly-reason" : undefined}
          >
            このブラウザの保存データを消去
          </button>
        </nav>
      </div>
      {readOnlyReason && (
        <p id="readonly-reason" className="hint">
          {readOnlyReason}
        </p>
      )}

      <section aria-label="案件の目的" className="app-header__objectives">
        {state.objectives.length === 0 ? (
          <p>
            目的が未登録です。{" "}
            <button type="button" className="link-button" onClick={onGoToProposal}>
              企画・目的画面で登録する
            </button>
          </p>
        ) : (
          <ul>
            {state.objectives.map((o) => (
              <li key={o.id}>
                <strong>{o.code}</strong> {o.content || "（内容が未入力）"}
              </li>
            ))}
          </ul>
        )}
      </section>

      <dl className="app-header__status">
        <div>
          <dt>最終取込</dt>
          <dd>
            {lastSync ? (
              <span className={lastSync.result === "failure" ? "status--error" : undefined}>
                {formatDateTime(lastSync.importedAt)} {SYNC_RESULT_LABELS[lastSync.result]}
                {lastSync.result === "failure" && lastSync.error ? `（${lastSync.error}）` : ""}
              </span>
            ) : (
              "未取込（実績の取込は2週目に追加します）"
            )}
          </dd>
        </div>
        <div>
          <dt>最終書き出し</dt>
          <dd>{state.lastExportedAt ? formatDateTime(state.lastExportedAt) : "なし"}</dd>
        </div>
      </dl>
      {reminderText && (
        <p className="app-header__reminder" role="status">
          <strong>書き出しのお願い：</strong>
          {reminderText}。正式な記録として、JSONを書き出してPCに保存してください。{" "}
          <button type="button" onClick={onExport}>
            今すぐ書き出す
          </button>
        </p>
      )}
    </header>
  );
}
