// 自動保存してよいかの判定（docs/security/checklist.md E）。画面から切り離してテストできるよう純粋な関数にする
export interface AutosaveConditions {
  /** このブラウザで保存領域を使えるか */
  storageAvailable: boolean;
  /** 起動時に保存データを読めなかったか（読めなかったなら、元の値を空の状態で上書きしないよう止める） */
  corruptAtStart: boolean;
  /** 起動後に、検証済みのデータを読み込んだか、保存データを消去したか（壊れた値を正しいデータで置き換えてよい） */
  recovered: boolean;
  /** 他のタブで保存データが変わったか（このタブの古い状態で上書きしない） */
  changedInOtherTab: boolean;
}

export function shouldAutosave(c: AutosaveConditions): boolean {
  return c.storageAvailable && !c.changedInOtherTab && (!c.corruptAtStart || c.recovered);
}
