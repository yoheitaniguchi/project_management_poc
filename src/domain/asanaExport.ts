// WPを Asana の CSV インポート用に書き出す（CLAUDE.md 6.2・8.2。Asana API へは通信しない）。
// 列：Name（WBSコードと作業名）・Description（作業区分・紐付く目的・見積工数）・Start Date・Due Date・Section（フェーズ名。空ならフェーズのコード）。
// 対象外のWPは書き出さない。列と Asana の項目の対応は、Asana の取込画面で選ぶ（4週目に実物で確かめる）
import { CATEGORY_LABELS } from "../labels";
import { toCsv } from "./csvWrite";
import type { AppState } from "./types";
import { compareCodes, targetWorkPackages } from "./wbs";

export const ASANA_IMPORT_HEADER = ["Name", "Description", "Start Date", "Due Date", "Section"] as const;

export function asanaImportRows(state: AppState): string[][] {
  const nodeById = new Map(state.wbsNodes.map((n) => [n.id, n]));
  return targetWorkPackages(state)
    .slice()
    .sort((a, b) => compareCodes(a.code, b.code))
    .map((n) => {
      const objectives = state.objectiveTraces
        .filter((t) => t.wbsNodeId === n.id)
        .map((t) => state.objectives.find((o) => o.id === t.objectiveId))
        .filter((o) => o !== undefined)
        .map((o) => `${o.code} ${o.content}`.trim());
      const hours = state.estimates.find((e) => e.wbsNodeId === n.id)?.hours;
      const description = [
        `作業区分：${CATEGORY_LABELS[n.category]}`,
        `紐付く目的：${objectives.join("、") || "なし"}`,
        `見積工数：${hours === undefined ? "未入力" : `${hours}時間`}`,
      ].join("\n");
      const phase = n.parentId === null ? undefined : nodeById.get(n.parentId);
      return [`${n.code} ${n.name}`.trim(), description, n.plannedStart ?? "", n.plannedEnd ?? "", phase === undefined ? "" : phase.name.trim() || phase.code];
    });
}

/** Asana の CSV インポート用の文字列（UTF-8。先頭に BOM は付けない） */
export function asanaImportCsv(state: AppState): string {
  return toCsv([[...ASANA_IMPORT_HEADER], ...asanaImportRows(state)]);
}
