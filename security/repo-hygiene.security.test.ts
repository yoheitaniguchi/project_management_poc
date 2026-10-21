// リポジトリの設定に関するセキュリティテスト（docs/security/checklist.md A・B・F）。
// リポジトリとGitHub Pagesは公開されているため、実データの混入とCIの権限の広がりを機械的に検査する。
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PRODUCTION_CSP } from "../vite.config";

const root = join(import.meta.dirname, "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");

describe("[@security] 実データの混入防止（A）", () => {
  it("[@security] .gitignore がアプリの書き出しファイルと .env を除外し、.env.example だけは残す", () => {
    const lines = read(".gitignore").split("\n").map((l) => l.trim());
    expect(lines).toContain("pmpoc-*");
    expect(lines).toContain(".env*");
    expect(lines).toContain("!.env.example");
  });

  it("[@security] 決められた置き場以外に JSON・CSV がコミットされていない", () => {
    // 設定ファイルと、テスト用の架空データの置き場（src/**/__fixtures__/）だけを許す
    const allowedConfigs = new Set(["package.json", "package-lock.json", "tsconfig.json"]);
    const tracked = execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf8" })
      .split("\n")
      .filter(Boolean);
    const offending = tracked.filter(
      (f) =>
        /\.(json|csv)$/i.test(f) &&
        !allowedConfigs.has(f) &&
        !/^src\/(.+\/)?__fixtures__\//.test(f) &&
        !/^\.claude\/settings(\.local)?\.json$/.test(f),
    );
    expect(offending).toEqual([]);
  });
});

describe("[@security] 外部通信の禁止（B）", () => {
  it("[@security] 本番ビルドのCSPが外部への通信とプラグインを禁止している", () => {
    expect(PRODUCTION_CSP).toContain("connect-src 'none'");
    expect(PRODUCTION_CSP).toContain("default-src 'self'");
    expect(PRODUCTION_CSP).toContain("object-src 'none'");
  });

  it("[@security] index.html が外部のスクリプト・スタイルを読み込んでいない", () => {
    expect(read("index.html")).not.toMatch(/(src|href)="(https?:)?\/\//);
  });
});

describe("[@security] CIの権限（F）", () => {
  const dir = join(root, ".github", "workflows");
  const workflows = readdirSync(dir).filter((f) => /\.ya?ml$/.test(f));

  it("[@security] ワークフローが1つ以上ある", () => {
    expect(workflows.length).toBeGreaterThan(0);
  });

  for (const file of workflows) {
    const text = readFileSync(join(dir, file), "utf8");

    it(`[@security] ${file}：トップレベルの権限が contents: read だけ`, () => {
      expect(text).toMatch(/^permissions:\n {2}contents: read\n(?! )/m);
    });

    it(`[@security] ${file}：pull_request_target を使っていない`, () => {
      expect(text).not.toMatch(/pull_request_target/);
    });

    it(`[@security] ${file}：Actionをコミットshaで固定している`, () => {
      const uses = [...text.matchAll(/uses:\s*(\S+)/g)].map((m) => m[1]);
      const unpinned = uses.filter((u) => !/@[0-9a-f]{40}$/.test(u));
      expect(unpinned).toEqual([]);
    });

    it(`[@security] ${file}：書き込み権限は deploy ジョブだけ`, () => {
      // ジョブ単位に分け、deploy 以外のジョブに write 権限が無いことを確かめる
      const jobsPart = text.split(/^jobs:\n/m)[1] ?? "";
      const jobs = jobsPart.split(/^ {2}(?=[a-z][\w-]*:\n)/m).filter(Boolean);
      for (const job of jobs) {
        const name = job.split(":")[0];
        if (name !== "deploy") {
          expect(job, `${name} ジョブに書き込み権限がある`).not.toMatch(/:\s*write/);
        }
      }
    });
  }
});
