// テスト用の状態（架空のデータ）。1週目の形のJSONを素材として固定し、以降の週でも読めることを確かめる
import { expect } from "vitest";
import fixture from "./__fixtures__/state-v1.json";
import { migrate } from "./persistence";
import type { AppState } from "./types";
import { validateState } from "./validate";

/**
 * 素材のJSONを今の版に移行した値。テストごとに書き換えてよいよう、毎回複製を返す。
 * 素材そのもの（版1）は fixtureText で読み、移行の回帰テストに使う
 */
export function fixtureRaw(): Record<string, unknown> {
  const r = migrate(structuredClone(fixture));
  if (!r.ok) throw new Error(r.error);
  return r.value as Record<string, unknown>;
}

/** 1週目に書き出した形（版1）のJSON文字列 */
export function fixtureText(): string {
  return JSON.stringify(fixture);
}

/**
 * ドメイン関数・action の結果が、次回の起動・読み込みで拒否されないことを確かめる。
 * 状態を変える関数のテストでは必ず通すこと（検証のルールと矛盾した状態を作らないため）
 */
export function expectValidState(state: AppState): void {
  const r = validateState(state);
  expect(r.ok ? [] : r.errors).toEqual([]);
}
