import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import "./index.css";
import { applyTheme, readThemePreference } from "./theme";

// 最初の描画の前にテーマを当てて、ちらつきを防ぐ（CSPでインラインスクリプトを使えないため、ここで行う）
applyTheme(readThemePreference());

const root = document.getElementById("root");
if (!root) {
  throw new Error("#root が見つかりません");
}
createRoot(root).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
