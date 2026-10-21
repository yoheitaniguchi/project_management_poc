// テスト用の状態（架空のデータ）。1週目の形のJSONを素材として固定し、以降の週でも読めることを確かめる
import { expect } from "vitest";
import fixture from "./__fixtures__/state-v1.json";
import type { AppState } from "./types";
import { validateState } from "./validate";

/** 素材のJSON（パース済みの値）。テストごとに書き換えてよいよう、毎回複製を返す */
export function fixtureRaw(): Record<string, unknown> {
  return structuredClone(fixture) as Record<string, unknown>;
}

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
