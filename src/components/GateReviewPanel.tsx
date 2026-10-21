// G1+2承認パネル（CLAUDE.md 7.1）。承認はベースラインの確定と同じ操作なので、計画画面で行う（ここは表示のみ）。
// 差戻しはここで記録する（取り消せないので確認してから記録する）
import { useState } from "react";
import { operatorName, recordGateReturn } from "../domain/proposal";
import type { AppState } from "../domain/types";
import { formatDateTime, GATE_DECISION_LABELS } from "../labels";
import { Modal } from "./Modal";
import type { Run } from "./ProposalPage";

interface Props {
  state: AppState;
  run: Run;
  newId: () => string;
  onGoToPlan: () => void;
}

function todayLocal(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function GateReviewPanel({ state, run, newId, onGoToPlan }: Props) {
  const [reviewer, setReviewer] = useState(() => (state.project.pmMemberId ? operatorName(state) : ""));
  const [reviewedOn, setReviewedOn] = useState(todayLocal);
  const [comment, setComment] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const latest = state.baselines.reduce<number | null>((v, b) => (v === null || b.version > v ? b.version : v), null);

  const submit = () => {
    const err = run((s) => recordGateReturn(s, { reviewer, reviewedOn, comment }, new Date(), newId));
    setError(err);
    setConfirming(false);
    if (err === null) {
      setComment("");
      setDone("差戻しを記録しました。");
    }
  };

  return (
    <section aria-labelledby="sec-gate">
      <h2 id="sec-gate">G1+2承認</h2>
      <p>
        {latest === null ? "まだ承認されていません。" : `承認済み（ベースラインv${latest}まで確定）。`}
        承認はベースラインの確定と同じ操作です。{" "}
        <button type="button" className="link-button" onClick={onGoToPlan}>
          計画画面で承認・確定する
        </button>
      </p>

      {state.gateReviews.length > 0 && (
        <table>
          <caption>承認・差戻しの記録</caption>
          <thead>
            <tr>
              <th scope="col">結果</th>
              <th scope="col">日付</th>
              <th scope="col">承認者</th>
              <th scope="col">コメント</th>
              <th scope="col">記録した日時</th>
            </tr>
          </thead>
          <tbody>
            {state.gateReviews.map((g) => (
              <tr key={g.id}>
                <td>{GATE_DECISION_LABELS[g.decision]}</td>
                <td>{g.reviewedOn}</td>
                <td>{g.reviewer}（自己申告）</td>
                <td>{g.comment}</td>
                <td>{formatDateTime(g.operatedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h3>差戻しを記録する</h3>
      <div className="form-grid">
        <label htmlFor="return-reviewer">承認者</label>
        <input id="return-reviewer" value={reviewer} onChange={(e) => setReviewer(e.target.value)} />
        <label htmlFor="return-date">差戻しの日付</label>
        <input id="return-date" type="date" value={reviewedOn} onChange={(e) => setReviewedOn(e.target.value)} />
        <label htmlFor="return-comment">コメント（差戻しの理由）</label>
        <textarea id="return-comment" rows={2} value={comment} onChange={(e) => setComment(e.target.value)} />
      </div>
      <button type="button" onClick={() => setConfirming(true)}>
        差戻しを記録する
      </button>
      {error && (
        <p className="message--error" role="alert">
          {error}
        </p>
      )}
      {done && <p role="status">{done}</p>}

      {confirming && (
        <Modal title="差戻しを記録しますか" onClose={() => setConfirming(false)}>
          <p>
            {reviewedOn} に {reviewer || "（承認者が未入力）"} が差し戻した記録を残します。記録は後から変更・削除できません。
            承認者は自己申告として記録され、監査ログにも残ります。
          </p>
          <div className="modal__actions">
            <button type="button" autoFocus onClick={() => setConfirming(false)}>
              キャンセル
            </button>
            <button type="button" className="button--primary" onClick={submit}>
              記録する
            </button>
          </div>
        </Modal>
      )}
    </section>
  );
}
