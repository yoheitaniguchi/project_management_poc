// 状態を変える操作（action）。4章のルールは src/domain/ のドメイン関数で守らせ、
// reducer はそれを呼ぶだけにする。画面ごとの操作はPR-D以降で足す。
import type { AppState } from "./types";

export type Action =
  /** JSONの読み込み。読み込む前に persistence.ts の parseStateText・compareForImport を通すこと */
  | { type: "replaceState"; state: AppState }
  | { type: "markExported"; at: string };

export function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case "replaceState":
      return action.state;
    case "markExported":
      return { ...state, lastExportedAt: action.at };
  }
}
