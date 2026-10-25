// 週次監視画面（CLAUDE.md 7.3）：最新のスナップショットの指標のカード、要対応、残りのWP・実績が未入力のWP、
// PV・EV・ACの推移、スナップショットの作成とCSV出力。スナップショットは作成後に変更できないので、作成の前にプレビューと確認を挟む
import { useEffect, useRef, useState } from "react";
import { currentViewer, personalActuals } from "../domain/access";
import { localDate } from "../domain/calendar";
import { isOutdatedSnapshot, remainingWps, unavailableReason, wpsWithoutActuals, type IndicatorKey, type SnapshotWp } from "../domain/monitor";
import {
  createSnapshot,
  defaultAsOf,
  latestSnapshot,
  previewSnapshot,
  snapshotAsOfError,
  snapshotCsv,
  snapshotCsvFileName,
  sortedSnapshots,
  versionOfSnapshot,
} from "../domain/snapshot";
import { latestBaselineOf, type AppState, type EvmSnapshot } from "../domain/types";
import type { EvmResult } from "../domain/evm";
import { downloadText } from "../files";
import { formatDateTime, ROLE_LABELS, SYNC_RESULT_LABELS } from "../labels";
import { Modal } from "./Modal";
import type { Run } from "./ProposalPage";
import { TrendChart } from "./TrendChart";

interface Props {
  state: AppState;
  run: Run;
  newId: () => string;
  onGoToPlan: () => void;
  onGoToProposal: () => void;
  onExport: () => void;
}

/** 時間：小数2桁まで（不要な0は付けない） */
const hours = (v: number) => `${Math.round(v * 100) / 100}時間`;
/** CPI・SPI：小数2桁 */
const ratio = (v: number) => v.toFixed(2);
/** 率：%で小数1桁 */
const percent = (v: number) => `${(Math.round(v * 1000) / 10).toFixed(1)}%`;

type Values = Pick<EvmSnapshot, IndicatorKey | "ac" | "pv" | "ev" | "bac">;

function Indicator({ values, k, label, format }: { values: Values; k: IndicatorKey; label: string; format: (v: number) => string }) {
  const v = values[k];
  return (
    <div className="card">
      <dt>{label}</dt>
      <dd>{v === null ? <span className="card__na">算出不可（{unavailableReason(values, k)}）</span> : <span className="card__value">{format(v)}</span>}</dd>
    </div>
  );
}

function Cards({ values }: { values: Values }) {
  return (
    <dl className="cards">
      <Indicator values={values} k="cpi" label="CPI（EV÷AC）" format={ratio} />
      <Indicator values={values} k="spi" label="SPI（EV÷PV）" format={ratio} />
      <Indicator values={values} k="consumptionRate" label="工数消化率（AC÷BAC）" format={percent} />
      <Indicator values={values} k="progressRate" label="進捗率（EV÷BAC）" format={percent} />
      <div className="card">
        <dt>BAC・PV・EV・AC</dt>
        <dd>
          {(["bac", "pv", "ev", "ac"] as const).map((k) => (
            <span key={k} className="card__line">
              {k.toUpperCase()} {hours(values[k])}
            </span>
          ))}
        </dd>
      </div>
      <Indicator values={values} k="eac" label="EAC（BAC÷CPI）" format={hours} />
    </dl>
  );
}

/** ずれと要対応（色だけに頼らず文言で示す） */
function Gap({ gap, threshold, alert }: { gap: number | null; threshold: number; alert: boolean }) {
  if (gap === null) return <p>ずれ：算出不可（BACが0のため）</p>;
  if (alert) {
    return (
      <p className="alert-box">
        <strong>要対応：</strong>工数消化率と進捗率のずれが {gap}ポイントで、閾値 {threshold}ポイントを {gap - threshold}ポイント超えています。実績と進み具合を確かめてください。
      </p>
    );
  }
  return (
    <p>
      ずれ {gap}ポイント（閾値 {threshold}ポイント以下のため、要対応ではありません）
    </p>
  );
}

/** 作成前に、実績が未入力のWPを示す（取込漏れのまま正式な記録にしないため） */
function MissingActuals({ items }: { items: SnapshotWp[] }) {
  if (items.length === 0) return <p>実績が未入力のWP：なし</p>;
  return (
    <p className="message--warn">
      実績が未入力のWPが{items.length}件あります（計画開始日が基準日以前で、基準日までの実績が0件）：
      {items.map((x) => `${x.node.code} ${x.node.name}`.trim()).join("、")}
    </p>
  );
}

function WpList({ items, empty, caption }: { items: SnapshotWp[]; empty: string; caption: string }) {
  if (items.length === 0) return <p>{empty}</p>;
  return (
    <table>
      <caption>{caption}</caption>
      <thead>
        <tr>
          <th scope="col">WBSコード</th>
          <th scope="col">作業名</th>
          <th scope="col">計画開始日</th>
          <th scope="col">計画終了日</th>
        </tr>
      </thead>
      <tbody>
        {items.map((x) => (
          <tr key={x.node.id}>
            <td>{x.node.code}</td>
            <td>{x.node.name || "（作業名が未入力）"}</td>
            <td>{x.plannedStart}</td>
            <td>{x.plannedEnd}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function MonitorPage({ state, run, newId, onGoToPlan, onGoToProposal, onExport }: Props) {
  const now = new Date();
  const [asOf, setAsOf] = useState(() => defaultAsOf(new Date()));
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** 作成したスナップショットの基準日（作成の結果とJSONの書き出しのお願いを出す） */
  const [created, setCreated] = useState<string | null>(null);
  const [csvDone, setCsvDone] = useState<string | null>(null);
  const doneRef = useRef<HTMLDivElement>(null);
  // 作成の後は、確認ダイアログのボタンが消えるので、結果の表示へフォーカスを移す
  useEffect(() => {
    if (created) doneRef.current?.focus();
  }, [created]);

  const latest = latestSnapshot(state);
  const latestBaseline = latestBaselineOf(state.baselines);
  const snapshots = sortedSnapshots(state);
  const asOfError = snapshotAsOfError(state, asOf, now);
  const preview = previewSnapshot(state, asOf, now);
  const lastSync = state.syncRuns.at(-1);
  const remaining = latest ? remainingWps(state, latest) : [];
  const withoutActuals = latest ? wpsWithoutActuals(state, latest) : [];
  const previewWithoutActuals = preview.ok ? wpsWithoutActuals(state, { asOf, baselineId: preview.evm.baselineId }) : [];
  // 作成した直後は、同じ基準日が「作成済み」になるのは当然なので、警告ではなく案内として出す
  const justCreated = created !== null && created === asOf;

  const create = () => {
    const message = run((s) => createSnapshot(s, asOf, new Date(), newId));
    setConfirming(false);
    setError(message);
    if (message === null) setCreated(asOf);
  };

  const exportCsv = () => {
    const at = new Date();
    // Excel で開いても文字化けしないよう、先頭に BOM を付ける
    downloadText(snapshotCsvFileName(at), `\uFEFF${snapshotCsv(state)}`, "text/csv");
    setCsvDone(`${snapshotCsvFileName(at)} を書き出しました（${snapshots.length}件）。PCの、このリポジトリのフォルダの外に保存してください。`);
  };

  return (
    <div className="page">
      <h1 tabIndex={-1}>週次監視</h1>
      <p className="hint">
        表示は、記録した週次スナップショットの値です（作成後は変わりません）。CPI・SPI は小数2桁、率は%、ずれは整数のポイント、工数は時間で示します。
      </p>

      {created && (
        <div ref={doneRef} tabIndex={-1} className="message--info" role="status">
          <p>
            基準日 {created} の週次スナップショットを作成しました。
            {latest && latest.asOf !== created && `表示中の最新は基準日 ${latest.asOf} です。作成した値は「PV・EV・AC の推移」の一覧にあります。`}
          </p>
          <p>
            正式な記録として、JSONを書き出してPCに保存してください。{" "}
            <button type="button" onClick={onExport}>
              今すぐJSONを書き出す
            </button>
          </p>
          <button type="button" className="link-button" onClick={() => setCreated(null)}>
            閉じる
          </button>
        </div>
      )}

      <section aria-labelledby="sec-latest">
        <h2 id="sec-latest">{latest ? `最新のスナップショット（基準日 ${latest.asOf}・ベースラインv${versionOfSnapshot(state, latest)}）` : "最新のスナップショット"}</h2>
        {!latest ? (
          <p>まだスナップショットがありません。下の「スナップショットの作成」で作成してください。</p>
        ) : (
          <>
            <p className="hint">作成：{formatDateTime(latest.createdAt)}</p>
            {isOutdatedSnapshot(state, latest) && latestBaseline && (
              <p className="message--warn">
                このスナップショットは古い版（v{versionOfSnapshot(state, latest)}）を基準にしています。最新の版はv{latestBaseline.version}です。改版後の値を見るには、新しい版でスナップショットを作成してください。
              </p>
            )}
            <Gap gap={latest.gapPoints} threshold={latest.thresholdPoints} alert={latest.alert} />
            <Cards values={latest} />
            {latest.thresholdPoints !== state.settings.alertThresholdPoints && (
              <p className="hint">
                要対応は、作成したときの閾値（{latest.thresholdPoints}ポイント）で判定しています。今の閾値は{state.settings.alertThresholdPoints}ポイントです。
              </p>
            )}
          </>
        )}
      </section>

      {latest && (
        <section aria-labelledby="sec-wps">
          <h2 id="sec-wps">WPの状況（基準日 {latest.asOf}・ベースラインv{versionOfSnapshot(state, latest)}）</h2>
          <p className="hint">
            完了と実績は今のデータで判定します（作成した後に完了を取り消したり、過去の作業日の実績を取り込んだりすると、上のカードの値と合わないことがあります）。
          </p>
          <h3>残りのWP（未完了）：{remaining.length}件</h3>
          <WpList items={remaining} empty="なし（すべて完了）" caption="基準日の時点で完了していないWP" />
          <h3>実績が未入力のWP：{withoutActuals.length}件</h3>
          <p className="hint">計画開始日が基準日以前なのに、基準日までの実績工数が0件のWPです（完了していても含めます）。</p>
          <WpList items={withoutActuals} empty="なし" caption="基準日までの実績が0件のWP" />
          {withoutActuals.length > 0 && (
            <p>
              <button type="button" className="link-button" onClick={onGoToPlan}>
                計画画面の「実績工数の取込」で実績を取り込む
              </button>
            </p>
          )}
        </section>
      )}

      {latest && <PersonalActualsSection state={state} asOf={latest.asOf} onGoToProposal={onGoToProposal} />}

      <section aria-labelledby="sec-trend">
        <h2 id="sec-trend">PV・EV・AC の推移</h2>
        {snapshots.length === 0 ? (
          <p>スナップショットを作成すると、ここに推移が出ます。</p>
        ) : (
          <>
            {snapshots.length === 1 && <p className="hint">スナップショットが1件のため、点だけを示します。2件目から線になります。</p>}
            <TrendChart points={snapshots.map((e) => ({ asOf: e.asOf, version: versionOfSnapshot(state, e), pv: e.pv, ev: e.ev, ac: e.ac }))} />
            <table>
              <caption>スナップショットの一覧（基準日の順）</caption>
              <thead>
                <tr>
                  <th scope="col">基準日</th>
                  <th scope="col">版</th>
                  <th scope="col">BAC</th>
                  <th scope="col">PV</th>
                  <th scope="col">EV</th>
                  <th scope="col">AC</th>
                  <th scope="col">CPI</th>
                  <th scope="col">SPI</th>
                  <th scope="col">ずれ</th>
                  <th scope="col">要対応</th>
                </tr>
              </thead>
              <tbody>
                {snapshots.map((e) => (
                  <tr key={e.id}>
                    <td>{e.asOf}</td>
                    <td>v{versionOfSnapshot(state, e)}</td>
                    <td>{hours(e.bac)}</td>
                    <td>{hours(e.pv)}</td>
                    <td>{hours(e.ev)}</td>
                    <td>{hours(e.ac)}</td>
                    <td>{e.cpi === null ? "算出不可" : ratio(e.cpi)}</td>
                    <td>{e.spi === null ? "算出不可" : ratio(e.spi)}</td>
                    <td>{e.gapPoints === null ? "算出不可" : `${e.gapPoints}ポイント`}</td>
                    <td>{e.alert ? "要対応" : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </section>

      <section aria-labelledby="sec-create">
        <h2 id="sec-create">スナップショットの作成</h2>
        {!latestBaseline ? (
          <p>
            ベースラインが未確定です。{" "}
            <button type="button" className="link-button" onClick={onGoToPlan}>
              計画画面でベースラインを確定する
            </button>
          </p>
        ) : (
          <>
            <p className="hint">
              毎週、その週の実績を取り込んでから作成し、作成後にJSONを書き出してPCに保存してください（正式な記録）。作成した記録は後から変更・削除できません。
            </p>
            <p>
              <label htmlFor="snapshot-asof">基準日</label>{" "}
              <input
                id="snapshot-asof"
                type="date"
                value={asOf}
                min={latestBaseline.approvedOn}
                max={localDate(now)}
                aria-describedby={asOfError ? "snapshot-asof-error" : undefined}
                onChange={(e) => setAsOf(e.target.value)}
              />{" "}
              <span className="hint">初期値は直近の金曜日です</span>
            </p>
            {asOfError ? (
              <p id="snapshot-asof-error" className={justCreated ? "message--info" : "message--warn"}>
                {justCreated ? `基準日 ${asOf} は作成しました。次の週は、その週の金曜日を基準日にして作成してください。` : asOfError}
              </p>
            ) : (
              preview.ok && (
                <div className="preview">
                  <h3>プレビュー（未記録）：基準日 {asOf}・ベースラインv{preview.evm.version}</h3>
                  <Gap gap={preview.evm.gapPoints} threshold={state.settings.alertThresholdPoints} alert={preview.evm.alert} />
                  <Cards values={preview.evm} />
                  <MissingActuals items={previewWithoutActuals} />
                </div>
              )
            )}
            {error && (
              <p className="message--error" role="alert">
                {error}
              </p>
            )}
            <button
              type="button"
              className="button--primary"
              disabled={asOfError !== null}
              aria-describedby={asOfError ? "snapshot-asof-error" : undefined}
              onClick={() => {
                setError(null);
                setConfirming(true);
              }}
            >
              基準日 {asOf || "（未入力）"} で作成する…
            </button>
          </>
        )}
      </section>

      <section aria-labelledby="sec-csv">
        <h2 id="sec-csv">スナップショットのCSV出力</h2>
        <p className="hint" id="snapshot-csv-hint">
          {snapshots.length === 0
            ? "スナップショットがまだ無いため、書き出せません。"
            : `記録したスナップショット ${snapshots.length}件を、基準日の順に書き出します（現状値の採取用）。算出できない値は空欄にします。`}
        </p>
        <button type="button" disabled={snapshots.length === 0} aria-describedby="snapshot-csv-hint" onClick={exportCsv}>
          CSVを書き出す
        </button>
        {csvDone && (
          <p className="message--info" role="status">
            {csvDone}
          </p>
        )}
      </section>

      {confirming && preview.ok && (
        <ConfirmDialog asOf={asOf} evm={preview.evm} withoutActuals={previewWithoutActuals} threshold={state.settings.alertThresholdPoints} lastSync={lastSync} onCancel={() => setConfirming(false)} onCreate={create} />
      )}
    </div>
  );
}

/** メンバー別の実績工数（4章：本人とPMのみ。権限の判定を通したものだけを出す） */
function PersonalActualsSection({ state, asOf, onGoToProposal }: { state: AppState; asOf: string; onGoToProposal: () => void }) {
  const viewer = currentViewer(state);
  const viewerName = viewer === null ? "（PM未設定）" : state.members.find((m) => m.id === viewer)?.name || "（氏名が未入力）";
  const rows = personalActuals(state, viewer, asOf);
  return (
    <section aria-labelledby="sec-personal">
      <h2 id="sec-personal">メンバー別の実績工数（基準日 {asOf} まで）</h2>
      <p className="hint">
        実績工数はプロジェクト管理にのみ使い、人事評価には使いません。個人別の値は、本人とPMだけが見られます。閲覧者：{viewerName}（PMとして自己申告。認証はありません）
      </p>
      {viewer === null ? (
        <p>
          PMが未設定のため、個人別の値は表示しません。{" "}
          <button type="button" className="link-button" onClick={onGoToProposal}>
            企画・目的画面で体制にPMを登録する
          </button>
        </p>
      ) : rows.length === 0 ? (
        <p>基準日までの実績工数はありません。</p>
      ) : (
        <>
          <p className="hint">今のデータで合計します（作成した後に過去の作業日の実績を取り込むと、上のカードの AC と合わないことがあります）。</p>
          <table>
            <caption>メンバー別の実績工数の合計</caption>
            <thead>
              <tr>
                <th scope="col">メンバー</th>
                <th scope="col">役割</th>
                <th scope="col">実績工数</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.memberId ?? "none"}>
                  <td>{r.name}</td>
                  <td>{r.role ? ROLE_LABELS[r.role] : "—"}</td>
                  <td>{hours(r.hours)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}

function ConfirmDialog({
  asOf,
  evm,
  withoutActuals,
  threshold,
  lastSync,
  onCancel,
  onCreate,
}: {
  asOf: string;
  evm: EvmResult;
  withoutActuals: SnapshotWp[];
  threshold: number;
  lastSync: AppState["syncRuns"][number] | undefined;
  onCancel: () => void;
  onCreate: () => void;
}) {
  // 基準日までの実績を取り込み終えていない恐れ：取込が無い、最後の取込が失敗、最後の取込が基準日より前
  const syncWarning = !lastSync
    ? "実績工数をまだ一度も取り込んでいません。"
    : lastSync.result === "failure"
      ? "最後の取込が失敗しています。"
      : localDate(new Date(lastSync.importedAt)) < asOf
        ? "最後の取込が基準日より前です。"
        : null;
  return (
    <Modal title={`基準日 ${asOf} の週次スナップショットを作成しますか`} onClose={onCancel}>
      <p>
        <strong>作成した記録は後から変更・削除できません。</strong>基準日までの実績を取り込み終えてから作成してください。
      </p>
      <p>
        最終取込：{lastSync ? `${formatDateTime(lastSync.importedAt)} ${SYNC_RESULT_LABELS[lastSync.result]}` : "なし"}
      </p>
      {syncWarning && <p className="message--warn">{syncWarning}このまま作成すると、実績が足りない値が正式な記録として残ります。</p>}
      <MissingActuals items={withoutActuals} />
      <dl className="summary">
        <div>
          <dt>基準にする版</dt>
          <dd>ベースラインv{evm.version}</dd>
        </div>
        <div>
          <dt>BAC・PV・EV・AC</dt>
          <dd>
            {hours(evm.bac)}・{hours(evm.pv)}・{hours(evm.ev)}・{hours(evm.ac)}
          </dd>
        </div>
        <div>
          <dt>CPI・SPI</dt>
          <dd>
            {evm.cpi === null ? "算出不可" : ratio(evm.cpi)}・{evm.spi === null ? "算出不可" : ratio(evm.spi)}
          </dd>
        </div>
        <div>
          <dt>ずれ</dt>
          <dd>
            {evm.gapPoints === null ? "算出不可" : `${evm.gapPoints}ポイント（閾値 ${threshold}ポイント${evm.alert ? "を超えるため要対応" : "以下"}）`}
          </dd>
        </div>
      </dl>
      <div className="modal__actions">
        <button type="button" autoFocus onClick={onCancel}>
          キャンセル
        </button>
        <button type="button" className="button--primary" onClick={onCreate}>
          基準日 {asOf} で作成する
        </button>
      </div>
    </Modal>
  );
}
