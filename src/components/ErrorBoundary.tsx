// 画面の描画中の例外で白い画面にしないための境界。
// 保存データは localStorage に残っているので、再読み込みで戻れることを伝える。
import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      return (
        <main className="app" role="alert">
          <h1>画面の表示中に問題が起きました</h1>
          <p>
            保存したデータは消えていません。ページを再読み込みしてください。
            繰り返し起きる場合は、操作の手順を記録して報告してください。
          </p>
          <button type="button" onClick={() => window.location.reload()}>
            再読み込みする
          </button>
        </main>
      );
    }
    return this.props.children;
  }
}
