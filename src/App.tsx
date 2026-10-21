// 画面の本体。3画面の切り替えと、保存・読み込みの操作をまとめる。
// 状態を変える処理は src/domain/ のドメイン関数に任せ、ここは結果を reducer に渡すだけにする
import { useState } from "react";
import { AppHeader } from "./components/AppHeader";
import { ImportDialog } from "./components/ImportDialog";
import { Modal } from "./components/Modal";
import { ProposalPage, type Run } from "./components/ProposalPage";
import { StorageBanner } from "./components/StorageBanner";
import { exportReminder } from "./domain/exportReminder";
import { exportFileName, serializeState } from "./domain/persistence";
import { acceptCommit } from "./domain/reducer";
import type { AppState } from "./domain/types";
import { downloadText } from "./files";
import { usePersistedState } from "./state/usePersistedState";

type Tab = "proposal" | "plan" | "monitor";
const TABS: { id: Tab; label: string }[] = [
  { id: "proposal", label: "企画・目的" },
  { id: "plan", label: "計画" },
  { id: "monitor", label: "週次監視" },
];

const newId = () => crypto.randomUUID();

export default function App() {
  const { state, dispatch, clearSavedData, readCorruptBackups, status } = usePersistedState();
  const [tab, setTab] = useState<Tab>("proposal");
  const [importing, setImporting] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const run: Run = (op) => {
    const r = op(state);
    if (!r.ok) return r.error;
    // reducer でも同じ判定で拒否されるが、黙って何も起きない状態にしないよう、ここで理由を返す
    if (!acceptCommit(state, r.state)) return "この操作はデータの整合性を保てないため反映しませんでした。操作の手順を記録して報告してください";
    dispatch({ type: "commit", next: r.state });
    return null;
  };

  const exportCurrent = () => {
    const now = new Date();
    // 書き出したファイルにも書き出し日時が入るように、記録してから書き出す
    const exported: AppState = { ...state, lastExportedAt: now.toISOString() };
    downloadText(exportFileName(now), serializeState(exported));
    dispatch({ type: "markExported", at: now });
    setNotice(`JSONを書き出しました（${exportFileName(now)}）。PCの、このリポジトリのフォルダの外に保存してください。`);
  };

  const backups = readCorruptBackups();
  const exportBackups =
    backups.length === 0
      ? null
      : () => {
          for (const [i, b] of backups.entries()) downloadText(`pmpoc-corrupt-backup-${i + 1}.json`, b.text, "text/plain");
          setNotice("退避したデータを書き出しました。中身は壊れているため、このアプリでは読み込めません。調べる用です。");
        };

  const isEmpty = exportReminder(state, new Date()).kind === "nothingYet";

  return (
    <>
      <StorageBanner status={status} />
      <AppHeader
        state={state}
        now={new Date()}
        onGoToProposal={() => setTab("proposal")}
        onExport={exportCurrent}
        onImport={() => setImporting(true)}
        onExportBackups={exportBackups}
        onClear={() => setClearing(true)}
      />
      <nav className="tabs" aria-label="画面">
        {TABS.map((t) => (
          <button key={t.id} type="button" className="tabs__tab" aria-current={tab === t.id ? "page" : undefined} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </nav>
      {notice && (
        <p className="message--info" role="status">
          {notice}{" "}
          <button type="button" className="link-button" onClick={() => setNotice(null)}>
            閉じる
          </button>
        </p>
      )}

      <main className="app">
        {isEmpty && tab === "proposal" && (
          <section className="onboarding" aria-labelledby="onboarding-title">
            <h2 id="onboarding-title">はじめに</h2>
            <p>このツールのデータは、このブラウザとPCにだけ保存されます。どちらから始めるか選んでください。</p>
            <ul>
              <li>新しく始める：下の「企画」から案件名・背景・目的を入力してください。入力は自動で保存されます。</li>
              <li>
                続きから始める：以前に書き出したJSONを{" "}
                <button type="button" onClick={() => setImporting(true)}>
                  読み込む
                </button>
              </li>
            </ul>
          </section>
        )}
        {tab === "proposal" && <ProposalPage state={state} run={run} newId={newId} onGoToPlan={() => setTab("plan")} />}
        {tab === "plan" && (
          <div className="page">
            <h1>計画</h1>
            <p>準備中です。WBS・目的の紐付け・見積と、G1+2承認によるベースラインの確定は、次の作業（PR-E・PR-F）で追加します。</p>
          </div>
        )}
        {tab === "monitor" && (
          <div className="page">
            <h1>週次監視</h1>
            <p>準備中です（3週目に追加します）。ベースラインの確定と実績の入力の後に使います。</p>
          </div>
        )}
      </main>

      {importing && (
        <ImportDialog
          current={state}
          onExportCurrent={exportCurrent}
          onClose={() => setImporting(false)}
          onImport={(next, allowReplace) => {
            dispatch({ type: "replaceState", state: next, allowReplace });
            setNotice("JSONを読み込みました。");
            return true;
          }}
        />
      )}

      {clearing && (
        <Modal title="このブラウザの保存データを消去しますか" onClose={() => setClearing(false)}>
          <p>
            このブラウザに保存されている、このアプリのデータ（退避したデータを含む）をすべて消し、画面も空の状態に戻します。元に戻せません。
            残しておきたい場合は、先にJSONを書き出してください。
          </p>
          <div className="modal__actions">
            <button type="button" autoFocus onClick={() => setClearing(false)}>
              キャンセル
            </button>
            <button type="button" onClick={exportCurrent}>
              先にJSONを書き出す
            </button>
            <button
              type="button"
              className="button--danger"
              onClick={() => {
                clearSavedData();
                setClearing(false);
                setNotice("このブラウザの保存データを消去しました。");
              }}
            >
              消去する
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
