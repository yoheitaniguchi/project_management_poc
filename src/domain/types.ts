// ドメインの型（CLAUDE.md 4章）。DBは使わず、ブラウザ内の状態として持つ。
// 日付は "YYYY-MM-DD"、日時は ISO 8601（UTC、例 "2026-10-26T09:00:00.000Z"）の文字列で持つ。
import { DEFAULT_ALERT_THRESHOLD_POINTS, DEFAULT_HOLIDAYS } from "../config/holidays";

/** 状態全体のスキーマの版。型を変えたら上げ、persistence.ts に移行関数を足す */
export const CURRENT_SCHEMA_VERSION = 2;

/**
 * WBSテンプレートの必須WP（CLAUDE.md 3.3）。見積漏れを防ぐため、テンプレートから展開したこれらのWPは削除できない
 * （本番リリースが無い案件では「対象外」にして理由を残す）
 */
export const REQUIRED_WP_KEYS = [
  "nfr_definition",
  "threat_analysis",
  "security_test",
  "operation_design",
  "migration_rehearsal",
  "operation_handover",
] as const;
export type RequiredWpKey = (typeof REQUIRED_WP_KEYS)[number];

export type Route = "normal" | "simple";
export type ProjectStatus = "planning" | "executing" | "closed";
export type ProposalStatus = "draft" | "approved" | "returned";
export type Affiliation = "internal" | "vendor";
export type Role = "pm" | "member" | "supervisor" | "viewer" | "vendor";
export type WbsKind = "phase" | "work_package";
export type WorkCategory = "functional" | "non_functional_security" | "operation_transition";

/** 必須WPごとの作業区分（CLAUDE.md 3.3）。必須WPの作業区分は変えられない */
export const REQUIRED_WP_CATEGORY: Record<RequiredWpKey, WorkCategory> = {
  nfr_definition: "non_functional_security",
  threat_analysis: "non_functional_security",
  security_test: "non_functional_security",
  operation_design: "operation_transition",
  migration_rehearsal: "operation_transition",
  operation_handover: "operation_transition",
};

/**
 * WBSコードの形式：英数字で始まり、英数字・ピリオド・アンダースコア・ハイフンだけ。
 * 実績のCSVはWBSコードでWPを指すため、前後の空白や、CSVで数式と解釈される先頭文字（= + - @）を入れない
 */
export const WBS_CODE_PATTERN = /^[0-9A-Za-z][0-9A-Za-z._-]{0,39}$/;
export type TimeEntrySource = "asana_csv" | "manual_csv";
export type SyncResult = "success" | "failure";
export type GateDecision = "approved" | "returned";

export interface Proposal {
  background: string;
  issues: string;
  /** 想定工数（時間） */
  estimatedHours: number | null;
  status: ProposalStatus;
  /** 承認日（G1+2で承認された合意日） */
  approvedOn: string | null;
}

export interface Project {
  name: string;
  scope: string;
  route: Route;
  hasRelease: boolean;
  status: ProjectStatus;
  pmMemberId: string | null;
}

export interface Objective {
  id: string;
  /** 表示用のコード（例 "O1"） */
  code: string;
  content: string;
  metricName: string;
  targetValue: string;
  measurementTiming: string;
}

export interface ObjectiveTrace {
  id: string;
  objectiveId: string;
  wbsNodeId: string;
  contribution: string;
}

export interface Member {
  id: string;
  name: string;
  affiliation: Affiliation;
  asanaUserGid: string | null;
}

export interface ProjectMember {
  id: string;
  memberId: string;
  role: Role;
}

export interface WbsNode {
  id: string;
  code: string;
  name: string;
  kind: WbsKind;
  category: WorkCategory;
  parentId: string | null;
  asanaTaskGid: string | null;
  plannedStart: string | null;
  plannedEnd: string | null;
  /** 手動で完了にした日（CLAUDE.md 5章の一時変更）。未完了は null */
  completedOn: string | null;
  excluded: boolean;
  excludedReason: string;
  /** テンプレートの必須WPなら、その種類（削除できない）。それ以外は null。版2で追加 */
  requiredKey: RequiredWpKey | null;
}

export interface Estimate {
  id: string;
  wbsNodeId: string;
  hours: number;
  basis: string;
  standardId: string | null;
}

export interface EstimationStandard {
  id: string;
  workType: string;
  sizeUnit: string;
  hoursPerUnit: number;
  version: string;
  /** 「仮」の値か（PoCでは仮の値で始める） */
  provisional: boolean;
}

export interface Baseline {
  id: string;
  /** 版番号（1から連番） */
  version: number;
  /** 承認日（実際に合意した日） */
  approvedOn: string;
  approver: string;
  /** 承認者は自己申告（認証が無いため。CLAUDE.md 4章） */
  approverSelfDeclared: true;
  /** 承認ゲート（v1は "G1+2"、改版は "改版"） */
  gate: string;
  comment: string;
  /** 改版理由（v2以降は必須） */
  revisionReason: string | null;
  /** ツールで確定の操作をした日時 */
  operatedAt: string;
}

export interface BaselineItem {
  id: string;
  baselineId: string;
  wbsNodeId: string;
  plannedHours: number;
  plannedStart: string;
  plannedEnd: string;
}

/** G1+2承認・差戻しの記録 */
export interface GateReview {
  id: string;
  decision: GateDecision;
  reviewedOn: string;
  reviewer: string;
  /** 承認者は自己申告（認証が無いため。CLAUDE.md 4章） */
  reviewerSelfDeclared: true;
  comment: string;
  /** 承認でベースラインを確定したときの版。差戻しは null */
  baselineId: string | null;
  operatedAt: string;
}

export interface TimeEntry {
  id: string;
  wbsNodeId: string;
  memberId: string | null;
  workDate: string;
  minutes: number;
  source: TimeEntrySource;
  uniqueKey: string;
}

export interface EvmSnapshot {
  id: string;
  baselineId: string;
  asOf: string;
  pv: number;
  ev: number;
  ac: number;
  bac: number;
  /** 算出できない指標は null（CLAUDE.md 5章） */
  cpi: number | null;
  spi: number | null;
  eac: number | null;
  consumptionRate: number | null;
  progressRate: number | null;
  createdAt: string;
}

export interface SyncRun {
  id: string;
  importedAt: string;
  fileName: string;
  result: SyncResult;
  count: number;
  error: string | null;
}

export interface AuditLog {
  id: string;
  /** 1からの連番。追記のみ */
  seq: number;
  at: string;
  operator: string;
  /** 操作者は自己申告（認証が無いため） */
  operatorSelfDeclared: true;
  targetType: string;
  targetId: string;
  action: string;
  /** 変更前後の値（JSON文字列） */
  before: string | null;
  after: string | null;
}

export interface Settings {
  /** 要対応の閾値（ポイント） */
  alertThresholdPoints: number;
  /** 祝日（"YYYY-MM-DD"） */
  holidays: string[];
}

export interface AppState {
  schemaVersion: typeof CURRENT_SCHEMA_VERSION;
  proposal: Proposal;
  project: Project;
  objectives: Objective[];
  objectiveTraces: ObjectiveTrace[];
  members: Member[];
  projectMembers: ProjectMember[];
  wbsNodes: WbsNode[];
  estimates: Estimate[];
  estimationStandards: EstimationStandard[];
  baselines: Baseline[];
  baselineItems: BaselineItem[];
  gateReviews: GateReview[];
  timeEntries: TimeEntry[];
  evmSnapshots: EvmSnapshot[];
  syncRuns: SyncRun[];
  auditLogs: AuditLog[];
  settings: Settings;
  /** 最後にJSONを書き出した日時 */
  lastExportedAt: string | null;
}

/** 最新の版（版番号が最大のもの）。まだ確定していなければ null（4章：予実差異は常に最新の承認済みベースラインを基準にする） */
export function latestBaselineOf(baselines: readonly Baseline[]): Baseline | null {
  return baselines.reduce<Baseline | null>((a, b) => (a === null || b.version > a.version ? b : a), null);
}

export function createInitialState(): AppState {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    proposal: { background: "", issues: "", estimatedHours: null, status: "draft", approvedOn: null },
    project: { name: "", scope: "", route: "simple", hasRelease: false, status: "planning", pmMemberId: null },
    objectives: [],
    objectiveTraces: [],
    members: [],
    projectMembers: [],
    wbsNodes: [],
    estimates: [],
    estimationStandards: [],
    baselines: [],
    baselineItems: [],
    gateReviews: [],
    timeEntries: [],
    evmSnapshots: [],
    syncRuns: [],
    auditLogs: [],
    settings: { alertThresholdPoints: DEFAULT_ALERT_THRESHOLD_POINTS, holidays: [...DEFAULT_HOLIDAYS] },
    lastExportedAt: null,
  };
}
