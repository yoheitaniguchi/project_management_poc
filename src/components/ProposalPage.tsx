// 企画・目的画面（CLAUDE.md 7.1）：背景・課題、体制・ルート、目的と成功指標、G1+2承認パネル
import { useState } from "react";
import {
  addMember,
  addObjective,
  changeRole,
  memberRemovalBlocker,
  removeMember,
  removeObjective,
  tracesOfObjective,
  updateMember,
  updateObjective,
  updateProject,
  updateProposal,
  type OpResult,
} from "../domain/proposal";
import type { Affiliation, AppState, Role, Route } from "../domain/types";
import { AFFILIATION_LABELS, PROPOSAL_STATUS_LABELS, ROLE_LABELS, ROUTE_LABELS } from "../labels";
import { GateReviewPanel } from "./GateReviewPanel";
import { Modal } from "./Modal";

export type Run = (op: (state: AppState) => OpResult) => string | null;

interface Props {
  state: AppState;
  run: Run;
  newId: () => string;
  onGoToPlan: () => void;
}

const ROLES = Object.keys(ROLE_LABELS) as Role[];
const ROUTES = Object.keys(ROUTE_LABELS) as Route[];
const AFFILIATIONS = Object.keys(AFFILIATION_LABELS) as Affiliation[];

export function ProposalPage({ state, run, newId, onGoToPlan }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [removingObjective, setRemovingObjective] = useState<string | null>(null);
  const [removingMember, setRemovingMember] = useState<string | null>(null);
  const exec = (op: (s: AppState) => OpResult) => setError(run(op));
  const { proposal, project } = state;

  const objectiveToRemove = state.objectives.find((o) => o.id === removingObjective);
  const memberToRemove = state.members.find((m) => m.id === removingMember);

  return (
    <div className="page">
      <h1>企画・目的</h1>
      {error && (
        <p className="message--error" role="alert">
          {error}
        </p>
      )}

      <section aria-labelledby="sec-proposal">
        <h2 id="sec-proposal">企画</h2>
        <p>状態：{PROPOSAL_STATUS_LABELS[proposal.status]}</p>
        <div className="form-grid">
          <label htmlFor="project-name">案件名</label>
          <input id="project-name" value={project.name} onChange={(e) => exec((s) => updateProject(s, { name: e.target.value }))} />
          <label htmlFor="background">背景</label>
          <textarea id="background" rows={3} value={proposal.background} onChange={(e) => exec((s) => updateProposal(s, { background: e.target.value }))} />
          <label htmlFor="issues">課題</label>
          <textarea id="issues" rows={3} value={proposal.issues} onChange={(e) => exec((s) => updateProposal(s, { issues: e.target.value }))} />
          <label htmlFor="scope">スコープ</label>
          <textarea id="scope" rows={2} value={project.scope} onChange={(e) => exec((s) => updateProject(s, { scope: e.target.value }))} />
          <label htmlFor="estimated">想定工数（時間）</label>
          <input
            id="estimated"
            type="number"
            min={0}
            step={0.5}
            value={proposal.estimatedHours ?? ""}
            onChange={(e) => exec((s) => updateProposal(s, { estimatedHours: e.target.value === "" ? null : Number(e.target.value) }))}
          />
          <label htmlFor="route">ルート</label>
          <select id="route" value={project.route} onChange={(e) => exec((s) => updateProject(s, { route: e.target.value as Route }))}>
            {ROUTES.map((r) => (
              <option key={r} value={r}>
                {ROUTE_LABELS[r]}
              </option>
            ))}
          </select>
          <span id="release-label">本番リリース</span>
          <label>
            <input
              type="checkbox"
              aria-labelledby="release-label"
              checked={project.hasRelease}
              onChange={(e) => exec((s) => updateProject(s, { hasRelease: e.target.checked }))}
            />{" "}
            あり（なしの場合、運用・移行の必須WPは「対象外」にできます）
          </label>
        </div>
      </section>

      <section aria-labelledby="sec-objectives">
        <h2 id="sec-objectives">目的と成功指標</h2>
        {state.objectives.length === 0 ? (
          <p>目的がまだありません。「目的を追加」から登録してください。WPは目的に紐付けないとベースラインを確定できません。</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th scope="col">コード</th>
                <th scope="col">目的・狙う効果</th>
                <th scope="col">成功指標</th>
                <th scope="col">目標値</th>
                <th scope="col">測定時期</th>
                <th scope="col">操作</th>
              </tr>
            </thead>
            <tbody>
              {state.objectives.map((o) => (
                <tr key={o.id}>
                  <th scope="row">{o.code}</th>
                  {(["content", "metricName", "targetValue", "measurementTiming"] as const).map((field) => (
                    <td key={field}>
                      <input
                        aria-label={`${o.code}の${{ content: "目的・狙う効果", metricName: "成功指標", targetValue: "目標値", measurementTiming: "測定時期" }[field]}`}
                        value={o[field]}
                        onChange={(e) => exec((s) => updateObjective(s, o.id, { [field]: e.target.value }))}
                      />
                    </td>
                  ))}
                  <td>
                    <button type="button" onClick={() => setRemovingObjective(o.id)}>
                      削除
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <button type="button" onClick={() => exec((s) => addObjective(s, newId))}>
          目的を追加
        </button>
      </section>

      <section aria-labelledby="sec-members">
        <h2 id="sec-members">体制</h2>
        {state.members.length === 0 ? (
          <p>メンバーがまだいません。「メンバーを追加」から登録してください。最初にPMを登録すると、監査ログの操作者になります。</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th scope="col">氏名</th>
                <th scope="col">所属</th>
                <th scope="col">役割</th>
                <th scope="col">操作</th>
              </tr>
            </thead>
            <tbody>
              {state.members.map((m) => {
                const role = state.projectMembers.find((p) => p.memberId === m.id)?.role ?? "member";
                const blocker = memberRemovalBlocker(state, m.id);
                return (
                  <tr key={m.id}>
                    <td>
                      <input aria-label="氏名" value={m.name} onChange={(e) => exec((s) => updateMember(s, m.id, { name: e.target.value }))} />
                    </td>
                    <td>
                      <select
                        aria-label={`${m.name || "メンバー"}の所属`}
                        value={m.affiliation}
                        onChange={(e) => exec((s) => updateMember(s, m.id, { affiliation: e.target.value as Affiliation }))}
                      >
                        {AFFILIATIONS.map((a) => (
                          <option key={a} value={a}>
                            {AFFILIATION_LABELS[a]}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <select
                        aria-label={`${m.name || "メンバー"}の役割`}
                        value={role}
                        onChange={(e) => exec((s) => changeRole(s, m.id, e.target.value as Role, new Date(), newId))}
                      >
                        {ROLES.map((r) => (
                          <option key={r} value={r}>
                            {ROLE_LABELS[r]}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <button type="button" disabled={blocker !== null} aria-describedby={blocker ? `blocker-${m.id}` : undefined} onClick={() => setRemovingMember(m.id)}>
                        削除
                      </button>
                      {blocker && (
                        <span id={`blocker-${m.id}`} className="hint">
                          {blocker}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        <p className="hint">役割の変更とメンバーの削除は、権限の変更として監査ログに残ります。</p>
        <button
          type="button"
          onClick={() => exec((s) => addMember(s, s.projectMembers.some((p) => p.role === "pm") ? "member" : "pm", new Date(), newId))}
        >
          メンバーを追加
        </button>
      </section>

      <GateReviewPanel state={state} run={run} newId={newId} onGoToPlan={onGoToPlan} />

      {objectiveToRemove && (
        <Modal title={`目的 ${objectiveToRemove.code} を削除しますか`} onClose={() => setRemovingObjective(null)}>
          <p>
            「{objectiveToRemove.content || "（内容が未入力）"}」を削除します。
            {tracesOfObjective(state, objectiveToRemove.id) > 0
              ? `この目的に紐付いている${tracesOfObjective(state, objectiveToRemove.id)}件のWPは、未紐付けに戻ります。`
              : "この目的に紐付いているWPはありません。"}
          </p>
          <div className="modal__actions">
            <button type="button" autoFocus onClick={() => setRemovingObjective(null)}>
              キャンセル
            </button>
            <button
              type="button"
              className="button--danger"
              onClick={() => {
                exec((s) => removeObjective(s, objectiveToRemove.id));
                setRemovingObjective(null);
              }}
            >
              削除する
            </button>
          </div>
        </Modal>
      )}

      {memberToRemove && (
        <Modal title="メンバーを削除しますか" onClose={() => setRemovingMember(null)}>
          <p>「{memberToRemove.name || "（氏名が未入力）"}」を体制から外します。権限の変更として監査ログに残ります。</p>
          <div className="modal__actions">
            <button type="button" autoFocus onClick={() => setRemovingMember(null)}>
              キャンセル
            </button>
            <button
              type="button"
              className="button--danger"
              onClick={() => {
                exec((s) => removeMember(s, memberToRemove.id, new Date(), newId));
                setRemovingMember(null);
              }}
            >
              削除する
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
