import { configDefaults, defineConfig, type Plugin } from "vitest/config";
import react from "@vitejs/plugin-react";

// 本番ビルドだけに入れるContent-Security-Policy（docs/security/checklist.md B）。
// connect-src 'none' で、アプリから外部への通信（Asana APIを含む。CLAUDE.md 6.2）をブラウザ側でも禁止する。
// 開発サーバーはHMRのためにインラインスクリプトやWebSocketを使うので、開発時には入れない。
export const PRODUCTION_CSP = [
  "default-src 'self'",
  "connect-src 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join("; ");

function productionCsp(): Plugin {
  return {
    name: "production-csp",
    apply: "build",
    transformIndexHtml(html) {
      return html.replace(
        "<head>",
        `<head>\n    <meta http-equiv="Content-Security-Policy" content="${PRODUCTION_CSP}" />`,
      );
    },
  };
}

// GitHub Pages（プロジェクトサイト）は https://<owner>.github.io/<repo>/ 配下で配信されるため、
// build成果物とその動作確認（vite preview）ではアセットパスの先頭にリポジトリ名を付ける
export default defineConfig(({ command, isPreview }) => ({
  plugins: [react(), productionCsp()],
  base: command === "build" || isPreview ? "/project_management_poc/" : "/",
  // 開発サーバーを外部に公開しない（docs/security/checklist.md F）
  server: { host: "localhost" },
  preview: { host: "localhost" },
  test: {
    exclude: [...configDefaults.exclude],
  },
}));
