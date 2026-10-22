// 計画画面（CLAUDE.md 7.2）：WBSの表、目的に紐付かないWPの強調、見積合計・見積基準の適用件数・未紐付けの件数。
// ベースラインの確定は次の作業（PR-F）で追加する
import { useEffect, useRef, useState, type ReactNode } from "react";
import { REQUIRED_WP_CATEGORY, type AppState, type RequiredWpKey, type WbsNode, type WorkCategory } from "../domain/types";
import {
  addPhase,
  addWorkPackage,
  applyStandard,
  compareCodes,
  expandTemplate,
  isUnlinked,
  planSummary,
  removalImpact,
  removeNode,
  seedProvisionalStandards,
  setEstimate,
  setExcluded,
  setTrace,
  standardResult,
  updateContribution,
  updateNode,
  WBS_TEMPLATE,
} from "../domain/wbs";
import type { OpResult } from "../domain/proposal";
import { CATEGORY_LABELS } from "../labels";
import { Modal } from "./Modal";
import type { Run } from "./ProposalPage";

interface Props {
  state: AppState;
  run: Run;
  newId: () => string;
  onGoToProposal: () => void;
}

const CATEGORIES = Object.keys(CATEGORY_LABELS) as WorkCategory[];

/** 必須WPの標準の名前（集計の警告で、欠けている必須WPを示すため） */
const REQUIRED_WP_NAMES: Record<RequiredWpKey, string> = {
  nfr_definition: "非機能要件の定義",
  threat_analysis: "脅威分析",
  security_test: "セキュリティテスト",
  operation_design: "運用設計",
  migration_rehearsal: "移行・リハーサル",
  operation_handover: "運用引継ぎ",
};

type ErrorPlace = "wbs" | "editor";

function PlaceError({ error, place }: { error: { place: ErrorPlace; message: string } | null; place: ErrorPlace }) {
  if (!error || error.place !== place) return null;
  return (
    <p className="message--error" role="alert">
      {error.message}
    </p>
  );
}

/** WBSを親子の順に並べる（親の後にその子をWBSコード順に） */
function orderedNodes(state: AppState): { node: WbsNode; depth: number }[] {
  const out: { node: WbsNode; depth: number }[] = [];
  const seen = new Set<string>();
  const visit = (parentId: string | null, depth: number) => {
    const children = state.wbsNodes.filter((n) => n.parentId === parentId).sort((a, b) => compareCodes(a.code, b.code));
    for (const n of children) {
      if (seen.has(n.id)) continue;
      seen.add(n.id);
      out.push({ node: n, depth });
      visit(n.id, depth + 1);
    }
  };
  visit(null, 0);
  return out;
}

export function PlanPage({ state, run, newId, onGoToProposal }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<{ place: ErrorPlace; message: string } | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  /** 操作を反映する。反映できなかったら、操作した場所の近くに理由を出す。成功したら true */
  const exec = (place: ErrorPlace, op: (s: AppState) => OpResult): boolean => {
    const message = run(op);
    setError(message === null ? null : { place, message });
    return message === null;
  };
  /** 要素を追加して、そのまま編集できるように選ぶ（追加する要素のIDを先に決めておく） */
  const addAndSelect = (place: ErrorPlace, op: (s: AppState, idFor: () => string) => OpResult) => {
    const id = newId();
    if (exec(place, (s) => op(s, () => id))) setSelectedId(id);
  };

  const summary = planSummary(state);
  const rows = orderedNodes(state);
  const selected = state.wbsNodes.find((n) => n.id === selectedId) ?? null;
  const objectiveCodes = (nodeId: string) =>
    state.objectiveTraces
      .filter((t) => t.wbsNodeId === nodeId)
      .map((t) => state.objectives.find((o) => o.id === t.objectiveId))
      .filter((o) => o !== undefined)
      .map((o) => `${o.code} ${o.content}`.trim());
  const hoursOf = (nodeId: string) => state.estimates.find((e) => e.wbsNodeId === nodeId)?.hours;
  const removingNode = state.wbsNodes.find((n) => n.id === removing);

  return (
    <div className="page">
      <h1 tabIndex={-1}>計画</h1>

      <section aria-labelledby="sec-summary">
        <h2 id="sec-summary">見積の集計</h2>
        <dl className="summary">
          <div>
            <dt>見積合計</dt>
            <dd>
              {summary.totalHours}時間（対象のWP {summary.targetCount}件）
            </dd>
          </div>
          <div>
            <dt>見積基準の適用</dt>
            <dd>{summary.standardAppliedCount}件</dd>
          </div>
          <div>
            <dt>未紐付け</dt>
            <dd className={summary.unlinkedCount > 0 ? "status--error" : undefined}>
              {summary.unlinkedCount}件（対象外 {summary.excludedCount}件を除く）
            </dd>
          </div>
        </dl>
        {rows.length > 0 && summary.missingRequiredKeys.length > 0 && (
          <p className="message--warn">
            テンプレートの必須WPのうち、次がWBSにありません：{summary.missingRequiredKeys.map((k) => REQUIRED_WP_NAMES[k]).join("・")}
            。見積漏れを防ぐため、WPとして追加して、不要なら理由を書いて「対象外」にしてください（作業区分は
            {[...new Set(summary.missingRequiredKeys.map((k) => CATEGORY_LABELS[REQUIRED_WP_CATEGORY[k]]))].join("・")}）。
          </p>
        )}
        {summary.unlinkedCount > 0 && (
          <p className="hint">目的に紐付かないWPがある間は、ベースラインを確定できません。表の「未紐付け」の行を選んで、目的に紐付けてください。</p>
        )}
      </section>

      {state.objectives.length === 0 && (
        <p className="message--warn">
          目的がまだありません。WPは目的に紐付ける必要があります。{" "}
          <button type="button" className="link-button" onClick={onGoToProposal}>
            先に企画・目的画面で目的を登録する
          </button>
        </p>
      )}
      <section aria-labelledby="sec-wbs">
        <h2 id="sec-wbs">WBS</h2>
        <PlaceError error={error} place="wbs" />
        {rows.length === 0 ? (
          <div>
            <p>
              WBSがまだありません。社内の標準テンプレート（版{WBS_TEMPLATE.version}）から展開してください。テンプレートには、見積漏れを防ぐための必須WP
              （非機能要件の定義・脅威分析・セキュリティテスト・運用設計・移行・リハーサル・運用引継ぎ）が含まれます。展開した後に、作業名の変更やWPの追加ができます。
            </p>
            <button type="button" className="button--primary" onClick={() => exec("wbs", (s) => expandTemplate(s, newId))}>
              テンプレートから展開
            </button>
          </div>
        ) : (
          <table className="wbs-table">
            <caption>WBS（目的に紐付かないWPは「状態」の列に「未紐付け」と表示します）</caption>
            <thead>
              <tr>
                <th scope="col">WBSコード</th>
                <th scope="col">作業名</th>
                <th scope="col">作業区分</th>
                <th scope="col">見積工数（時間）</th>
                <th scope="col">紐付く目的</th>
                <th scope="col">計画開始</th>
                <th scope="col">計画終了</th>
                <th scope="col">状態</th>
                <th scope="col">操作</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ node, depth }) => {
                const unlinked = isUnlinked(state, node);
                const wp = node.kind === "work_package";
                return (
                  <tr
                    key={node.id}
                    className={[wp ? "" : "wbs-row--phase", unlinked ? "wbs-row--unlinked" : "", node.excluded ? "wbs-row--excluded" : "", node.id === selectedId ? "wbs-row--selected" : ""].join(" ")}
                  >
                    <th scope="row" style={{ paddingLeft: `${6 + depth * 16}px` }}>
                      {node.code}
                    </th>
                    <td>
                      {node.name || "（作業名が未入力）"}
                      {node.requiredKey && <span className="badge">必須</span>}
                    </td>
                    <td>{CATEGORY_LABELS[node.category]}</td>
                    <td>{wp ? (hoursOf(node.id) ?? "未入力") : ""}</td>
                    <td>{wp ? objectiveCodes(node.id).join("、") || "—" : ""}</td>
                    <td>{wp ? (node.plannedStart ?? "未入力") : ""}</td>
                    <td>{wp ? (node.plannedEnd ?? "未入力") : ""}</td>
                    <td className="wbs-status">{wp ? (node.excluded ? `対象外（${node.excludedReason}）` : unlinked ? "未紐付け" : "") : "フェーズ"}</td>
                    <td>
                      <button
                        type="button"
                        aria-label={`${node.code} ${node.name || "（作業名が未入力）"}を${node.id === selectedId ? "閉じる" : "編集"}`}
                        onClick={() => setSelectedId(node.id === selectedId ? null : node.id)}
                      >
                        {node.id === selectedId ? "閉じる" : "編集"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {rows.length > 0 && (
          <button type="button" onClick={() => addAndSelect("wbs", (s, idFor) => addPhase(s, idFor))}>
            フェーズを追加
          </button>
        )}
        {rows.length > 0 && state.estimationStandards.length === 0 && (
          <p>
            見積基準がありません。{" "}
            <button type="button" onClick={() => exec("wbs", (s) => seedProvisionalStandards(s, newId))}>
              仮の見積基準を入れる
            </button>
          </p>
        )}
      </section>

      {selected && (
        <NodeEditor
          key={selected.id}
          state={state}
          node={selected}
          exec={(op) => exec("editor", op)}
          error={<PlaceError error={error} place="editor" />}
          newId={newId}
          onAddWp={() => addAndSelect("editor", (s, idFor) => addWorkPackage(s, selected.id, idFor))}
          onRemove={() => setRemoving(selected.id)}
        />
      )}

      <section aria-labelledby="sec-baseline">
        <h2 id="sec-baseline">ベースライン</h2>
        {state.baselines.length === 0 ? (
          <p>まだ確定していません（G1+2承認によるベースラインの確定は準備中です）。</p>
        ) : (
          <ul>
            {[...state.baselines]
              .sort((a, b) => a.version - b.version)
              .map((b) => (
                <li key={b.id}>
                  v{b.version}：承認日 {b.approvedOn}、承認者 {b.approver}（自己申告）{b.revisionReason ? `、改版理由 ${b.revisionReason}` : ""}
                </li>
              ))}
          </ul>
        )}
      </section>

      {removingNode && (
        <RemoveDialog
          state={state}
          node={removingNode}
          onClose={() => setRemoving(null)}
          onConfirm={() => {
            exec("wbs", (s) => removeNode(s, removingNode.id));
            setRemoving(null);
            setSelectedId(null);
          }}
        />
      )}
    </div>
  );
}

function RemoveDialog({ state, node, onClose, onConfirm }: { state: AppState; node: WbsNode; onClose: () => void; onConfirm: () => void }) {
  const impact = removalImpact(state, node.id);
  return (
    <Modal title={`${node.code} ${node.name || "（作業名が未入力）"}を削除しますか`} onClose={onClose}>
      {impact.blocker ? (
        <p>{impact.blocker}</p>
      ) : (
        <p>
          WBS要素 {impact.nodes}件（この要素と、その下の要素）を削除します。あわせて見積 {impact.estimates}件、目的の紐付け {impact.traces}件も消えます。
        </p>
      )}
      <div className="modal__actions">
        <button type="button" autoFocus onClick={onClose}>
          キャンセル
        </button>
        {!impact.blocker && (
          <button type="button" className="button--danger" onClick={onConfirm}>
            削除する
          </button>
        )}
      </div>
    </Modal>
  );
}

interface EditorProps {
  state: AppState;
  node: WbsNode;
  exec: (op: (s: AppState) => OpResult) => boolean;
  error: ReactNode;
  newId: () => string;
  onAddWp: () => void;
  onRemove: () => void;
}

/** 選んだ要素の編集。WPなら計画日・見積・目的の紐付け・対象外も編集できる */
function NodeEditor({ state, node, exec, error, newId, onAddWp, onRemove }: EditorProps) {
  const wp = node.kind === "work_package";
  const estimate = state.estimates.find((e) => e.wbsNodeId === node.id);
  const [code, setCode] = useState(node.code);
  const [excludeReason, setExcludeReason] = useState(node.excludedReason);
  const [standardId, setStandardId] = useState(state.estimationStandards[0]?.id ?? "");
  const [quantity, setQuantity] = useState("1");
  const [confirmingStandard, setConfirmingStandard] = useState(false);
  const impact = removalImpact(state, node.id);
  const inBaseline = state.baselineItems.some((b) => b.wbsNodeId === node.id);
  const standard = state.estimationStandards.find((s) => s.id === standardId);
  const doApply = () => exec((s) => applyStandard(s, node.id, standardId, Number(quantity), newId));
  const result = standard ? standardResult(standard, Number(quantity)) : null;
  // 今の見積が、適用した結果と違うなら（手入力の工数や根拠が消えるなら）確認する
  const needsConfirm = estimate !== undefined && result !== null && (estimate.hours !== result.hours || estimate.basis !== result.basis);
  // 開いたら（別の要素を選び直したら）見出しへフォーカスを移し、編集の場所を見せる
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    headingRef.current?.focus();
    headingRef.current?.scrollIntoView?.({ block: "start" });
  }, []);

  return (
    <section aria-labelledby="sec-editor" className="editor">
      <h2 id="sec-editor" tabIndex={-1} ref={headingRef}>
        {wp ? "WP" : "フェーズ"}の編集：{node.code} {node.name || "（作業名が未入力）"}
      </h2>
      {error}
      <div className="form-grid">
        <label htmlFor="node-code">WBSコード</label>
        <span>
          <input id="node-code" value={code} onChange={(e) => setCode(e.target.value)} />{" "}
          <button type="button" disabled={code === node.code} onClick={() => exec((s) => updateNode(s, node.id, { code }))}>
            コードを変更
          </button>
          <span className="hint">（実績のCSVはWBSコードでWPを指すため、変更はボタンで確定します）</span>
        </span>
        <label htmlFor="node-name">作業名</label>
        <input id="node-name" value={node.name} onChange={(e) => exec((s) => updateNode(s, node.id, { name: e.target.value }))} />
        <label htmlFor="node-category">作業区分</label>
        <select
          id="node-category"
          value={node.category}
          disabled={node.requiredKey !== null}
          aria-describedby={node.requiredKey ? "category-locked" : undefined}
          onChange={(e) => exec((s) => updateNode(s, node.id, { category: e.target.value as WorkCategory }))}
        >
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {CATEGORY_LABELS[c]}
            </option>
          ))}
        </select>
        {node.requiredKey && (
          <>
            <span />
            <span id="category-locked" className="hint">
              テンプレートの必須WPのため、作業区分は変えられず、削除もできません（不要なら「対象外」にします）。
            </span>
          </>
        )}
        {wp && (
          <>
            <label htmlFor="node-start">計画開始日</label>
            <input
              id="node-start"
              type="date"
              value={node.plannedStart ?? ""}
              onChange={(e) => exec((s) => updateNode(s, node.id, { plannedStart: e.target.value || null }))}
            />
            <label htmlFor="node-end">計画終了日</label>
            <input
              id="node-end"
              type="date"
              value={node.plannedEnd ?? ""}
              onChange={(e) => exec((s) => updateNode(s, node.id, { plannedEnd: e.target.value || null }))}
            />
          </>
        )}
      </div>

      {wp && (
        <>
          <h3>見積</h3>
          <div className="form-grid">
            <label htmlFor="est-hours">見積工数（時間）</label>
            <input
              id="est-hours"
              type="number"
              min={0}
              step={0.5}
              value={estimate?.hours ?? ""}
              onChange={(e) =>
                exec((s) => setEstimate(s, node.id, { hours: e.target.value === "" ? null : Number(e.target.value), basis: estimate?.basis ?? "" }, newId))
              }
            />
            <label htmlFor="est-basis">見積根拠</label>
            <input
              id="est-basis"
              value={estimate?.basis ?? ""}
              disabled={estimate === undefined}
              aria-describedby={estimate === undefined ? "basis-hint" : undefined}
              onChange={(e) => exec((s) => setEstimate(s, node.id, { hours: estimate?.hours ?? null, basis: e.target.value }, newId))}
            />
            {estimate === undefined && (
              <>
                <span />
                <span id="basis-hint" className="hint">
                  先に見積工数を入れると、見積根拠を書けます。
                </span>
              </>
            )}
          </div>
          {state.estimationStandards.length > 0 && (
            <fieldset>
              <legend>見積基準を適用する（工数 ＝ 単位あたり工数 × 数量）</legend>
              <label>
                見積基準{" "}
                <select value={standardId} onChange={(e) => setStandardId(e.target.value)}>
                  {state.estimationStandards.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.workType}：{s.hoursPerUnit}時間/{s.sizeUnit}
                      {s.provisional ? "（仮）" : ""}
                    </option>
                  ))}
                </select>
              </label>{" "}
              <label>
                数量 <input type="number" min={0} step={1} value={quantity} onChange={(e) => setQuantity(e.target.value)} style={{ width: "6em" }} />
                {standard?.sizeUnit}
              </label>{" "}
              <button type="button" onClick={() => (needsConfirm ? setConfirmingStandard(true) : doApply())}>
                適用
              </button>
              {standard?.provisional && <p className="hint">この見積基準は仮の値です。PoCの結果を見て見直します。</p>}
            </fieldset>
          )}

          <h3>目的の紐付け</h3>
          {state.objectives.length === 0 ? (
            <p>目的がまだありません。先に企画・目的画面で目的を登録してください。</p>
          ) : (
            <ul className="trace-list">
              {state.objectives.map((o) => {
                const trace = state.objectiveTraces.find((t) => t.wbsNodeId === node.id && t.objectiveId === o.id);
                return (
                  <li key={o.id}>
                    <label>
                      <input type="checkbox" checked={trace !== undefined} onChange={(e) => exec((s) => setTrace(s, node.id, o.id, e.target.checked, newId))} />{" "}
                      {o.code} {o.content || "（内容が未入力）"}
                    </label>
                    {trace && (
                      <label className="trace-contribution">
                        貢献の内容{" "}
                        <input value={trace.contribution} onChange={(e) => exec((s) => updateContribution(s, trace.id, e.target.value))} />
                      </label>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          <h3>対象外</h3>
          {node.excluded ? (
            <p>
              対象外（理由：{node.excludedReason}）{" "}
              <button type="button" onClick={() => exec((s) => setExcluded(s, node.id, false, ""))}>
                対象に戻す
              </button>
            </p>
          ) : (
            <div>
              <label htmlFor="exclude-reason">対象外にする理由</label>{" "}
              <input id="exclude-reason" value={excludeReason} onChange={(e) => setExcludeReason(e.target.value)} placeholder="例：本番リリースなし" />{" "}
              <button
                type="button"
                disabled={excludeReason.trim() === "" || inBaseline}
                aria-describedby={excludeReason.trim() === "" || inBaseline ? "exclude-hint" : undefined}
                onClick={() => exec((s) => setExcluded(s, node.id, true, excludeReason))}
              >
                対象外にする
              </button>
              {inBaseline ? (
                <span id="exclude-hint" className="hint">
                  確定済みのベースラインに含まれるWPのため、対象外にできません。
                </span>
              ) : (
                excludeReason.trim() === "" && (
                  <span id="exclude-hint" className="hint">
                    理由を入力すると対象外にできます。対象外のWPは見積・紐付け・ベースラインの対象から外れます。
                  </span>
                )
              )}
            </div>
          )}
        </>
      )}

      <div className="editor__actions">
        {!wp && (
          <button type="button" onClick={onAddWp}>
            このフェーズにWPを追加
          </button>
        )}
        <button
          type="button"
          className="button--danger"
          disabled={impact.blocker !== null}
          aria-describedby={impact.blocker ? "remove-blocker" : undefined}
          onClick={onRemove}
        >
          削除
        </button>
        {impact.blocker && (
          <span id="remove-blocker" className="hint">
            {impact.blocker}
          </span>
        )}
      </div>

      {confirmingStandard && (
        <Modal title="今の見積を置き換えますか" onClose={() => setConfirmingStandard(false)}>
          <p>
            見積工数 {estimate?.hours}時間 を {result?.hours}時間 に、見積根拠「{estimate?.basis || "（未入力）"}」を「{result?.basis}」に置き換えます。
            手で書いた見積根拠は残りません。
          </p>
          <div className="modal__actions">
            <button type="button" autoFocus onClick={() => setConfirmingStandard(false)}>
              キャンセル
            </button>
            <button
              type="button"
              className="button--primary"
              onClick={() => {
                doApply();
                setConfirmingStandard(false);
              }}
            >
              置き換える
            </button>
          </div>
        </Modal>
      )}
    </section>
  );
}
