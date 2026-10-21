// G1+2承認パネル（CLAUDE.md 7.1）。承認はベースラインの確定と同じ操作なので、計画画面で行う（ここは表示のみ）。
// 差戻しはここで記録する。取り消せない記録なので、入力が揃うまで押せず、確認してから記録する
import { useState } from "react";
import { recordGateReturn } from "../domain/proposal";
import type { AppState } from "../domain/types";
import { isValidDate } from "../domain/validate";
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
  // 承認者の初期値はPMの氏名（入力されている場合だけ）。利用者が書き換えるまではPMの氏名に追従する
  const pmName = state.members.find((m) => m.id === state.project.pmMemberId)?.name.trim() ?? "";
  const [reviewerInput, setReviewerInput] = useState<string | null>(null);
  const reviewer = reviewerInput ?? pmName;
  const [reviewedOn, setReviewedOn] = useState(todayLocal);
  const [comment, setComment] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const latest = state.baselines.reduce<number | null>((v, b) => (v === null || b.version > v ? b.version : v), null);

  // 記録する前提（入力が揃っているか）。揃うまではボタンを押せず、理由を常に見せる
  const missing = [
    reviewer.trim() === "" ? "承認者" : null,
    !isValidDate(reviewedOn) ? "差戻しの日付" : null,
    comment.trim() === "" ? "コメント（差戻しの理由）" : null,
  ].filter((x): x is string => x !== null);

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
          計画画面で承認・確定する（準備中）
        </button>
      </p>

      {state.gateReviews.length === 0 ? (
        <p>承認・差戻しの記録はまだありません。WBSと見積を作ったら、計画画面で承認してベースラインを確定します。</p>
      ) : (
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

      <details>
        <summary>差戻しを記録する（承認者が計画を差し戻した場合）</summary>
        <p className="hint">差戻しの記録は後から変更・削除できません。{latest !== null && "承認済みのため、企画の状態は承認済みのまま、記録だけを残します。"}</p>
        <div className="form-grid">
          <label htmlFor="return-reviewer">承認者</label>
          <input id="return-reviewer" value={reviewer} onChange={(e) => setReviewerInput(e.target.value)} />
          <label htmlFor="return-date">差戻しの日付</label>
          <input id="return-date" type="date" value={reviewedOn} onChange={(e) => setReviewedOn(e.target.value)} />
          <label htmlFor="return-comment">コメント（差戻しの理由）</label>
          <textarea id="return-comment" rows={2} value={comment} onChange={(e) => setComment(e.target.value)} />
        </div>
        <button
          type="button"
          disabled={missing.length > 0}
          aria-describedby={missing.length > 0 ? "return-missing" : undefined}
          onClick={() => setConfirming(true)}
        >
          差戻しを記録する
        </button>
        {missing.length > 0 && (
          <p id="return-missing" className="hint">
            {missing.join("・")}を入力すると記録できます。
          </p>
        )}
        {error && (
          <p className="message--error" role="alert">
            {error}
          </p>
        )}
        {done && <p role="status">{done}</p>}
      </details>

      {confirming && (
        <Modal title="差戻しを記録しますか" onClose={() => setConfirming(false)}>
          <p>
            {reviewedOn} に {reviewer} が差し戻した記録を残します（理由：{comment}）。記録は後から変更・削除できません。
            承認者は自己申告として記録され、監査ログにも残ります。
          </p>
          <div className="modal__actions">
            <button type="button" autoFocus onClick={() => setConfirming(false)}>
              キャンセル
            </button>
            <button type="button" className="button--danger" onClick={submit}>
              記録する
            </button>
          </div>
        </Modal>
      )}
    </section>
  );
}
