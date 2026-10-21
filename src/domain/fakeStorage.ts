// テスト用の localStorage の代わり。容量超過などの失敗も再現できる
import type { KeyValueStorage } from "./persistence";

export class FakeStorage implements KeyValueStorage {
  private readonly map = new Map<string, string>();
  failWrites = false;
  failReads = false;

  get length(): number {
    return this.map.size;
  }

  key(index: number): string | null {
    return [...this.map.keys()][index] ?? null;
  }

  getItem(key: string): string | null {
    if (this.failReads) throw new Error("SecurityError");
    return this.map.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    if (this.failWrites) throw new Error("QuotaExceededError");
    this.map.set(key, value);
  }

  removeItem(key: string): void {
    this.map.delete(key);
  }
}
