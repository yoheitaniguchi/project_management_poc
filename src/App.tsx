// 画面の本体。PR-C の時点では保存の仕組みだけで、各画面は PR-D 以降で作る
import { StorageBanner } from "./components/StorageBanner";
import { usePersistedState } from "./state/usePersistedState";

export default function App() {
  const { status } = usePersistedState();
  return (
    <>
      <StorageBanner status={status} />
      <main className="app">
        <h1>PM支援ツールPoC</h1>
        <p>準備中です。企画・目的画面、計画画面、週次監視画面を順に追加します。</p>
      </main>
    </>
  );
}
