// 状態を useReducer で持ち、変わるたびに localStorage へ自動保存する。
// - 起動時に保存データを検証し、壊れていたら自動保存を止める（空の状態で上書きしない）。
//   検証済みのデータを読み込むか、保存データを消去したら再開する
// - 他のタブで保存データが変わったら、このタブを読み取り専用にする（監査ログ等を失わないため）
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { shouldAutosave } from "../domain/autosave";
import { clearStorage, listCorruptBackups, loadFromStorage, saveToStorage, STORAGE_KEY, type LoadResult } from "../domain/persistence";
import { reducer, type Action } from "../domain/reducer";
import { createInitialState, type AppState } from "../domain/types";

export interface StorageStatus {
  /** このブラウザで保存領域を使えない（プライベートモードの制限など） */
  unavailable: boolean;
  /** 起動時に保存データを読めなかった（回復するまで自動保存は止まっている） */
  corrupt: { errors: string[]; backupKey: string | null } | null;
  /** 起動後に正しいデータを読み込む・消去するなどして、自動保存を再開した */
  recovered: boolean;
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
  const [initial] = useState<{ load: LoadResult | null; state: AppState }>(() => {
    const storage = getStorage();
    if (!storage) return { load: null, state: createInitialState() };
    const load = loadFromStorage(storage, new Date());
    return { load, state: load.kind === "ok" ? load.state : createInitialState() };
  });

  const [state, dispatchRaw] = useReducer(reducer, initial.state);
  const stateRef = useRef(state);
  stateRef.current = state;
  const [saveError, setSaveError] = useState<string | null>(null);
  const [changedInOtherTab, setChangedInOtherTab] = useState(false);
  const [recovered, setRecovered] = useState(false);
  const isFirstRender = useRef(true);

  const autosave = shouldAutosave({
    storageAvailable: initial.load !== null,
    corruptAtStart: initial.load?.kind === "corrupt",
    recovered,
    changedInOtherTab,
  });

  useEffect(() => {
    // 起動直後の状態は保存し直さない（読み込んだものと同じため）
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    if (!autosave) return;
    const storage = getStorage();
    if (!storage) return;
    const result = saveToStorage(storage, state);
    setSaveError(result.ok ? null : result.error);
  }, [state, autosave]);

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
      if (changedInOtherTab) return;
      // 読み込みが受け付けられたら（状態が変わったら）、壊れた保存データを置き換えてよい
      if (action.type === "replaceState" && reducer(stateRef.current, action) !== stateRef.current) setRecovered(true);
      dispatchRaw(action);
    },
    [changedInOtherTab],
  );

  /** 「このブラウザの保存データを消去」。画面の状態も初期化し、消した後にメモリ上の状態を書き戻さない */
  const clearSavedData = useCallback(() => {
    const storage = getStorage();
    if (storage) clearStorage(storage);
    setRecovered(true);
    dispatchRaw({ type: "reset" });
  }, []);

  /** 退避した壊れた保存データ（書き出して調べる用） */
  const readCorruptBackups = useCallback((): { key: string; text: string }[] => {
    const storage = getStorage();
    if (!storage) return [];
    return listCorruptBackups(storage).flatMap((key) => {
      const text = storage.getItem(key);
      return text === null ? [] : [{ key, text }];
    });
  }, []);

  const status: StorageStatus = {
    unavailable: initial.load === null,
    corrupt:
      initial.load?.kind === "corrupt" ? { errors: initial.load.errors, backupKey: initial.load.backupKey } : null,
    recovered,
    saveError,
    changedInOtherTab,
  };
  return { state, dispatch, clearSavedData, readCorruptBackups, status };
}
