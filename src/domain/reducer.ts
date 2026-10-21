// 状態を変える操作（action）。4章のルールは src/domain/ のドメイン関数で守らせ、
// reducer はそれを呼ぶだけにする。画面ごとの操作はPR-D以降で足す。
import { compareForImport } from "./persistence";
import { createInitialState, type AppState } from "./types";
import { validateState } from "./validate";

export type Action =
  /**
   * JSONの読み込みによる置き換え。reducer の中で検証と比較をやり直し、
   * 検証に通らないデータ、または確定済みの記録を変えるデータ（allowReplace が無いとき）は受け付けない
   */
  | { type: "replaceState"; state: AppState; allowReplace?: boolean }
  | { type: "markExported"; at: Date }
  /** 「このブラウザの保存データを消去」と同時に、画面の状態も初期化する */
  | { type: "reset" };

/** 置き換えを受け付けるかを判定し、受け付けるなら検証済みの状態を返す */
export function acceptReplacement(current: AppState, incoming: AppState, allowReplace: boolean): AppState | null {
  const checked = validateState(structuredClone(incoming));
  if (!checked.ok) return null;
  if (!allowReplace && compareForImport(current, checked.state).kind !== "appendOnly") return null;
  return checked.state;
}

export function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case "replaceState":
      return acceptReplacement(state, action.state, action.allowReplace === true) ?? state;
    case "markExported":
      return { ...state, lastExportedAt: action.at.toISOString() };
    case "reset":
      return createInitialState();
  }
}
