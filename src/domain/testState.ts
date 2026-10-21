// テスト用の状態（架空のデータ）。1週目の形のJSONを素材として固定し、以降の週でも読めることを確かめる
import fixture from "./__fixtures__/state-v1.json";

/** 素材のJSON（パース済みの値）。テストごとに書き換えてよいよう、毎回複製を返す */
export function fixtureRaw(): Record<string, unknown> {
  return structuredClone(fixture) as Record<string, unknown>;
}

export function fixtureText(): string {
  return JSON.stringify(fixture);
}
