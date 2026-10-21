// 状態を変える操作（action）。4章のルールは src/domain/ のドメイン関数で守らせ、
// reducer はそれを呼ぶだけにする。画面ごとの操作はPR-D以降で足す。
import { compareForImport, frozenRecordChanges } from "./persistence";
import { createInitialState, type AppState } from "./types";
import { validateState } from "./validate";

export type Action =
  /**
   * JSONの読み込みによる置き換え。reducer の中で検証と比較をやり直し、
   * 検証に通らないデータ、または確定済みの記録を変えるデータ（allowReplace が無いとき）は受け付けない
   */
  | { type: "replaceState"; state: AppState; allowReplace?: boolean }
  /**
   * 画面の操作の結果（src/domain/ のドメイン関数が作った次の状態）を反映する。
   * 念のため、検証に通らない状態や、確定済みの記録を追記以外で変える状態は受け付けない
   */
  | { type: "commit"; next: AppState }
  /**
   * 画面の操作。ドメイン関数を reducer の時点の状態に当てて反映する（描画時の古い状態から作った結果で上書きしないため）。
   * 結果は commit と同じ判定を通す
   */
  | { type: "apply"; op: (state: AppState) => { ok: true; state: AppState } | { ok: false; error: string } }
  | { type: "markExported"; at: Date }
  /** 「このブラウザの保存データを消去」と同時に、画面の状態も初期化する */
  | { type: "reset" };

/** 画面の操作の結果を受け付けるか（検証に通り、確定済みの記録を追記しかしていない） */
export function acceptCommit(current: AppState, next: AppState): boolean {
  return validateState(next).ok && frozenRecordChanges(current, next).length === 0;
}

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
    case "commit":
      return acceptCommit(state, action.next) ? action.next : state;
    case "apply": {
      const r = action.op(state);
      return r.ok && acceptCommit(state, r.state) ? r.state : state;
    }
    case "markExported":
      return { ...state, lastExportedAt: action.at.toISOString() };
    case "reset":
      return createInitialState();
  }
}
