// 状態を useReducer で持ち、変わるたびに localStorage へ自動保存する。
// - 起動時に保存データを検証し、壊れていたら自動保存を止める（空の状態で上書きしない）
// - 他のタブで保存データが変わったら、このタブを読み取り専用にする（監査ログ等を失わないため）
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { loadFromStorage, saveToStorage, STORAGE_KEY, type LoadResult } from "../domain/persistence";
import { reducer, type Action } from "../domain/reducer";
import { createInitialState, type AppState } from "../domain/types";

export interface StorageStatus {
  /** 起動時に保存データを読めなかった（自動保存は止まっている） */
  corrupt: { errors: string[]; backupKey: string | null } | null;
  /** 直近の自動保存の失敗 */
  saveError: string | null;
  /** 他のタブで保存データが変わった（このタブは読み取り専用） */
  changedInOtherTab: boolean;
}

function getStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function usePersistedState() {
  const [initial] = useState<{ load: LoadResult; state: AppState }>(() => {
    const storage = getStorage();
    if (!storage) {
      return { load: { kind: "corrupt", errors: ["このブラウザでは保存領域を使えません"], backupKey: null }, state: createInitialState() };
    }
    const load = loadFromStorage(storage, new Date());
    return { load, state: load.kind === "ok" ? load.state : createInitialState() };
  });

  const [state, dispatchRaw] = useReducer(reducer, initial.state);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [changedInOtherTab, setChangedInOtherTab] = useState(false);
  const autosaveEnabled = initial.load.kind !== "corrupt";
  const isFirstRender = useRef(true);

  useEffect(() => {
    // 起動直後の状態は保存し直さない（読み込んだものと同じため）
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    if (!autosaveEnabled || changedInOtherTab) return;
    const storage = getStorage();
    if (!storage) return;
    const result = saveToStorage(storage, state);
    setSaveError(result.ok ? null : result.error);
  }, [state, autosaveEnabled, changedInOtherTab]);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY || e.key === null) setChangedInOtherTab(true);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const dispatch = useCallback(
    (action: Action) => {
      // 読み取り専用のタブでは状態を変えない
      if (!changedInOtherTab) dispatchRaw(action);
    },
    [changedInOtherTab],
  );

  const status: StorageStatus = {
    corrupt: initial.load.kind === "corrupt" ? { errors: initial.load.errors, backupKey: initial.load.backupKey } : null,
    saveError,
    changedInOtherTab,
  };
  return { state, dispatch, status };
}
