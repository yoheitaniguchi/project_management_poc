// 実データの混入防止に関するセキュリティテスト（docs/security/checklist.md A。SEC-003）。
// Asanaが付けた名前のCSV・TSVや、表計算ソフトのファイルがリポジトリに入らないことを確かめる。
// テスト用の架空データの置き場（src/**/__fixtures__/）だけを例外とする。
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(import.meta.dirname, "..");

// git check-ignore --no-index：.gitignore の規則だけで判定する（終了コード0＝除外、1＝除外されない）
function isIgnored(path: string): boolean {
  try {
    execFileSync("git", ["check-ignore", "--no-index", "-q", path], { cwd: root, stdio: "ignore" });
    return true;
  } catch (e) {
    if ((e as { status?: number }).status === 1) return false;
    throw e;
  }
}

describe("[@security] .gitignore による実データの除外（A / SEC-003）", () => {
  const realDataPaths = [
    "Asana_PM支援ツールPoC.csv",
    "docs/asana-export-2026-11-06.csv",
    "src/domain/actuals.csv",
    "Asana_PM支援ツールPoC.tsv",
    "data/time-entries.tsv",
  ];
  for (const p of realDataPaths) {
    it(`[@security] 置き場以外の ${p} は .gitignore で除外される`, () => {
      expect(isIgnored(p)).toBe(true);
    });
  }

  const fixturePaths = [
    "src/domain/__fixtures__/manual-sample.csv",
    "src/domain/__fixtures__/asana-sample.tsv",
    "src/__fixtures__/sample.csv",
  ];
  for (const p of fixturePaths) {
    it(`[@security] テスト素材の置き場の ${p} は除外されない（例外）`, () => {
      expect(isIgnored(p)).toBe(false);
    });
  }
});

describe("[@security] 追跡ファイルの検査（A / SEC-003）", () => {
  it("[@security] 置き場以外に CSV・TSV・XLSX/XLS がコミットされていない", () => {
    const tracked = execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf8" })
      .split("\n")
      .filter(Boolean);
    const offending = tracked.filter(
      (f) => /\.(csv|tsv|xlsx|xls)$/i.test(f) && !/^src\/(.+\/)?__fixtures__\//.test(f),
    );
    expect(offending).toEqual([]);
  });
});
