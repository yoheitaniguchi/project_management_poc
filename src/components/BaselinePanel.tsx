// ベースライン（F07、CLAUDE.md 7.2・4章）。v1 の確定は G1+2 承認と同じ操作。計画を変えるときは改版する。
// 確定できない理由は、ボタンの近くに常に出す（未紐付けのWPなどがある間は押せない）
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  applyExclusions,
  bacOf,
  baselineBlockers,
  confirmBaseline,
  hasBlockers,
  itemsOf,
  latestBaseline,
  reviseBaseline,
  type Blockers,
  type Exclusion,
} from "../domain/baseline";
import { localDate } from "../domain/calendar";
import type { OpResult } from "../domain/proposal";
import type { AppState } from "../domain/types";
import { targetWorkPackages } from "../domain/wbs";
import { formatDateTime } from "../labels";
import { Modal } from "./Modal";

interface Props {
  state: AppState;
  exec: (op: (s: AppState) => OpResult) => boolean;
  newId: () => string;
  error: ReactNode;
  /** 古いエラーを消す（ダイアログを閉じたとき） */
  onClearError: () => void;
}

function BlockerList({ blockers, id }: { blockers: Blockers; id: string }) {
  if (!hasBlockers(blockers)) return null;
  return (
    <div id={id} className="message--warn">
      <p>次の理由で、まだ確定できません。</p>
      <ul>
        {blockers.general.map((g) => (
          <li key={g}>{g}</li>
        ))}
        {blockers.workPackages.map((b) => (
          <li key={b.node.id}>
            {b.node.code} {b.node.name || "（作業名が未入力）"}：{b.reasons.join("、")}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function BaselinePanel({ state, exec, newId, error, onClearError }: Props) {
  const [dialog, setDialog] = useState<"confirm" | "revise" | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  // 確定・改版の後は、押したボタンが消えることがあるので、この区画の見出しへフォーカスを移す
  useEffect(() => {
    if (done) headingRef.current?.focus();
  }, [done]);
  const latest = latestBaseline(state);
  const blockers = baselineBlockers(state);
  const blocked = hasBlockers(blockers);
  const ordered = [...state.baselines].sort((a, b) => a.version - b.version);

  return (
    <section aria-labelledby="sec-baseline">
      <h2 id="sec-baseline" tabIndex={-1} ref={headingRef}>
        ベースライン
      </h2>
      {!dialog && error}
      {done && (
        <p className="message--info" role="status">
          {done}
        </p>
      )}
      {ordered.length === 0 ? (
        <p>まだ確定していません。G1+2承認と同時に、その時点の計画（対象のWPの計画工数・計画開始日・計画終了日）をv1として凍結します。</p>
      ) : (
        <table>
          <caption>確定した版（後から変更・削除できません）</caption>
          <thead>
            <tr>
              <th scope="col">版</th>
              <th scope="col">合意日</th>
              <th scope="col">承認者</th>
              <th scope="col">WP件数</th>
              <th scope="col">計画工数の合計（BAC）</th>
              <th scope="col">改版理由</th>
              <th scope="col">コメント</th>
              <th scope="col">確定した日時</th>
            </tr>
          </thead>
          <tbody>
            {ordered.map((b) => (
              <tr key={b.id}>
                <th scope="row">
                  v{b.version}
                  {b.id === latest?.id && <span className="badge">最新</span>}
                </th>
                <td>{b.approvedOn}</td>
                <td>{b.approver}（自己申告）</td>
                <td>{itemsOf(state, b.id).length}件</td>
                <td>{bacOf(state, b.id)}時間</td>
                <td>{b.revisionReason ?? "—"}</td>
                <td>{b.comment || "—"}</td>
                <td>{formatDateTime(b.operatedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {latest === null ? (
        <>
          <BlockerList blockers={blockers} id="baseline-blockers" />
          <button
            type="button"
            className="button--primary"
            disabled={blocked}
            aria-describedby={blocked ? "baseline-blockers" : undefined}
            onClick={() => {
              setDone(null);
              setDialog("confirm");
            }}
          >
            G1+2承認してベースラインを確定
          </button>
        </>
      ) : (
        <>
          <BlockerList blockers={blockers} id="baseline-blockers" />
          <p className="hint">
            計画（見積・計画日・WPの構成）を変えたら、改版して新しい版を確定します。予実の差異は常に最新の版を基準に計算します。
            最新の版に含まれるWPを外すときも、改版の中で理由を付けて外します。
          </p>
          <button type="button" aria-describedby={blocked ? "baseline-blockers" : undefined} onClick={() => setDialog("revise")}>
            改版する（v{latest.version + 1}を確定）
          </button>
        </>
      )}

      {dialog && (
        <ApprovalDialog
          state={state}
          mode={dialog}
          onClose={() => {
            onClearError();
            setDialog(null);
          }}
          onSubmit={(op, version) => {
            if (exec(op)) {
              setDialog(null);
              setDone(`ベースラインv${version}を確定しました。上部の「JSONを書き出す」で、PCに保存してください（正式な記録です）。`);
            }
          }}
          newId={newId}
          error={error}
        />
      )}
    </section>
  );
}

interface DialogProps {
  state: AppState;
  mode: "confirm" | "revise";
  onClose: () => void;
  onSubmit: (op: (s: AppState) => OpResult, version: number) => void;
  newId: () => string;
  /** 確定できなかった理由（ダイアログの中に出す） */
  error: ReactNode;
}

function ApprovalDialog({ state, mode, onClose, onSubmit, newId, error }: DialogProps) {
  const pmName = state.members.find((m) => m.id === state.project.pmMemberId)?.name.trim() ?? "";
  const latest = latestBaseline(state);
  const [approver, setApprover] = useState(pmName);
  const [approvedOn, setApprovedOn] = useState(() => localDate(new Date()));
  const [comment, setComment] = useState("");
  const [revisionReason, setRevisionReason] = useState("");
  const [excludeReasons, setExcludeReasons] = useState<Record<string, string>>({});
  const [checked, setChecked] = useState<Set<string>>(new Set());

  // 最新の版に含まれ、今は対象のWP（改版で外せるもの）
  const latestIds = new Set(latest ? itemsOf(state, latest.id).map((x) => x.wbsNodeId) : []);
  const removable = targetWorkPackages(state).filter((n) => latestIds.has(n.id));
  const exclusions: Exclusion[] = [...checked].map((wbsNodeId) => ({ wbsNodeId, reason: excludeReasons[wbsNodeId] ?? "" }));

  // 外した後の計画で、確定できるか・何を凍結するかを示す
  const preview = mode === "revise" ? applyExclusions(state, exclusions.map((x) => ({ ...x, reason: x.reason || "（確認用）" }))) : null;
  const planned = preview && preview.ok ? preview.state : state;
  const blockers = baselineBlockers(planned);
  const targets = targetWorkPackages(planned);
  const bac = Math.round(targets.reduce((s, n) => s + (planned.estimates.find((e) => e.wbsNodeId === n.id)?.hours ?? 0), 0) * 100) / 100;

  const missing = [
    approver.trim() === "" ? "承認者" : null,
    approvedOn === "" ? "合意日" : approvedOn > localDate(new Date()) ? "今日以前の合意日" : latest && approvedOn < latest.approvedOn ? `v${latest.version}の合意日以降の合意日` : null,
    mode === "revise" && revisionReason.trim() === "" ? "改版理由" : null,
    ...exclusions.filter((x) => x.reason.trim() === "").map((x) => `${state.wbsNodes.find((n) => n.id === x.wbsNodeId)?.code ?? ""} を外す理由`),
  ].filter((x): x is string => x !== null);
  const blocked = hasBlockers(blockers);
  const version = (latest?.version ?? 0) + 1;

  const submit = () =>
    onSubmit(
      (s) =>
      mode === "confirm"
        ? confirmBaseline(s, { approver, approvedOn, comment }, new Date(), newId)
        : reviseBaseline(s, { approver, approvedOn, comment, revisionReason, exclusions }, new Date(), newId),
      version,
    );

  return (
    <Modal title={mode === "confirm" ? "G1+2承認してベースラインv1を確定しますか" : `改版してベースラインv${version}を確定しますか`} onClose={onClose}>
      <p>
        対象のWP {targets.length}件、計画工数の合計（BAC）{bac}時間を、v{version}として凍結します。確定した版は後から変更・削除できません。
        {mode === "confirm" && "企画は承認済みになり、承認の記録と監査ログが残ります。"}
      </p>
      {latest && (
        <p>
          前の版との比較：v{latest.version} {itemsOf(state, latest.id).length}件・{bacOf(state, latest.id)}時間 → v{version} {targets.length}件・{bac}時間
        </p>
      )}
      <div className="form-grid">
        <label htmlFor="approval-approver">承認者（自己申告）</label>
        <input id="approval-approver" autoFocus value={approver} onChange={(e) => setApprover(e.target.value)} />
        <label htmlFor="approval-date">合意日</label>
        <span>
          <input id="approval-date" type="date" value={approvedOn} max={localDate(new Date())} onChange={(e) => setApprovedOn(e.target.value)} />{" "}
          <span className="hint">実際に計画に合意した日で、承認日として記録します（操作した日時は別に記録します）{latest ? `。v${latest.version}の合意日 ${latest.approvedOn} 以降` : ""}</span>
        </span>
        {mode === "revise" && (
          <>
            <label htmlFor="approval-reason">改版理由</label>
            <textarea id="approval-reason" rows={2} value={revisionReason} onChange={(e) => setRevisionReason(e.target.value)} />
          </>
        )}
        <label htmlFor="approval-comment">コメント</label>
        <textarea id="approval-comment" rows={2} value={comment} onChange={(e) => setComment(e.target.value)} />
      </div>

      {mode === "revise" && removable.length > 0 && (
        <fieldset>
          <legend>この版から外すWP（外したWPは対象外になります）</legend>
          <ul className="trace-list">
            {removable.map((n) => (
              <li key={n.id}>
                <label>
                  <input
                    type="checkbox"
                    checked={checked.has(n.id)}
                    onChange={(e) => {
                      const next = new Set(checked);
                      if (e.target.checked) next.add(n.id);
                      else next.delete(n.id);
                      setChecked(next);
                    }}
                  />{" "}
                  {n.code} {n.name || "（作業名が未入力）"}
                </label>
                {checked.has(n.id) && (
                  <label className="trace-contribution">
                    外す理由{" "}
                    <input value={excludeReasons[n.id] ?? ""} onChange={(e) => setExcludeReasons({ ...excludeReasons, [n.id]: e.target.value })} />
                  </label>
                )}
              </li>
            ))}
          </ul>
        </fieldset>
      )}

      <BlockerList blockers={blockers} id="approval-blockers" />
      {error}
      {missing.length > 0 && (
        <p id="approval-missing" className="hint">
          {missing.join("・")}を入力すると確定できます。
        </p>
      )}
      <div className="modal__actions">
        <button type="button" onClick={onClose}>
          キャンセル
        </button>
        <button
          type="button"
          className="button--primary"
          disabled={missing.length > 0 || blocked}
          aria-describedby={[missing.length > 0 ? "approval-missing" : "", blocked ? "approval-blockers" : ""].join(" ").trim() || undefined}
          onClick={submit}
        >
          {mode === "confirm" ? "承認して確定する" : `v${version}を確定する`}
        </button>
      </div>
    </Modal>
  );
}
