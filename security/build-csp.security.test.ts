// 本番ビルドのCSP挿入に関するセキュリティテスト（docs/security/checklist.md B。SEC-002）。
// vite.config.ts の production-csp プラグインが、index.html の <head> の書き方に依らず
// connect-src 'none' を含むCSPのmetaを必ず入れることを確かめる（黙って入らなくなる退行を防ぐ）。
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Plugin, PluginOption } from "vite";
import config from "../vite.config";

const root = join(import.meta.dirname, "..");

type HtmlTransform = (html: string, ctx: unknown) => unknown;

// vite.config.ts の default export（関数）を本番ビルドとして評価し、production-csp プラグインを取り出す
async function findCspPlugin(): Promise<Plugin> {
  const resolved =
    typeof config === "function"
      ? await (config as (env: unknown) => unknown)({
          command: "build",
          mode: "production",
          isPreview: false,
          isSsrBuild: false,
        })
      : config;
  const flatten = async (opts: PluginOption[]): Promise<Plugin[]> => {
    const out: Plugin[] = [];
    for (const o of opts) {
      const v = await o;
      if (!v) continue;
      if (Array.isArray(v)) out.push(...(await flatten(v)));
      else out.push(v as Plugin);
    }
    return out;
  };
  const plugins = await flatten(((resolved as { plugins?: PluginOption[] }).plugins ?? []) as PluginOption[]);
  const plugin = plugins.find((p) => p.name === "production-csp");
  if (!plugin) throw new Error("production-csp プラグインが見つからない");
  return plugin;
}

async function applyTransform(plugin: Plugin, html: string): Promise<string> {
  const hook = plugin.transformIndexHtml as unknown;
  const fn: HtmlTransform | undefined =
    typeof hook === "function"
      ? (hook as HtmlTransform)
      : ((hook as { handler?: HtmlTransform; transform?: HtmlTransform } | undefined)?.handler ??
        (hook as { transform?: HtmlTransform } | undefined)?.transform);
  if (!fn) throw new Error("transformIndexHtml が無い");
  const result = await fn.call({}, html, { path: "/index.html", filename: join(root, "index.html") });
  if (typeof result === "string") return result;
  // { html, tags } やタグ配列を返す実装にも対応する
  if (result && typeof result === "object" && "html" in result) {
    const r = result as { html: string; tags?: unknown[] };
    return r.html + JSON.stringify(r.tags ?? []);
  }
  if (Array.isArray(result)) return html + JSON.stringify(result);
  return html;
}

// <head> 内に、connect-src 'none' を含むCSPのmetaがあるか（タグ記述子の場合はJSON上で確認）
function hasCspMeta(out: string): boolean {
  const headMatch = /<head\b[^>]*>([\s\S]*?)<\/head>/i.exec(out);
  const inHead =
    headMatch !== null &&
    /<meta\s[^>]*http-equiv="Content-Security-Policy"[^>]*content="[^"]*connect-src 'none'[^"]*"/i.test(
      headMatch[1],
    );
  const asTag =
    /"http-equiv":"Content-Security-Policy"/i.test(out) && /connect-src 'none'/.test(out);
  return inHead || asTag;
}

describe("[@security] 本番ビルドのCSP挿入（B / SEC-002）", () => {
  it("[@security] production-csp プラグインが本番ビルドで有効になっている", async () => {
    const plugin = await findCspPlugin();
    expect(plugin.apply === undefined || plugin.apply === "build").toBe(true);
  });

  it("[@security] 実際の index.html に connect-src 'none' を含むCSPのmetaが入る", async () => {
    const plugin = await findCspPlugin();
    const out = await applyTransform(plugin, readFileSync(join(root, "index.html"), "utf8"));
    expect(hasCspMeta(out)).toBe(true);
  });

  it("[@security] 属性付きの <head data-x=\"1\"> でもCSPのmetaが入る", async () => {
    const plugin = await findCspPlugin();
    const html =
      '<!doctype html>\n<html lang="ja">\n  <head data-x="1">\n    <meta charset="UTF-8" />\n    <title>t</title>\n  </head>\n  <body><div id="root"></div></body>\n</html>\n';
    const out = await applyTransform(plugin, html);
    expect(hasCspMeta(out)).toBe(true);
  });

  it("[@security] 大文字の <HEAD> でもCSPのmetaが入る", async () => {
    const plugin = await findCspPlugin();
    const html = "<!doctype html>\n<html>\n<HEAD>\n<title>t</title>\n</HEAD>\n<body></body>\n</html>\n";
    const out = await applyTransform(plugin, html);
    expect(hasCspMeta(out)).toBe(true);
  });
});
