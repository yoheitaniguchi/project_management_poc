// 保存に関する警告。一時的な通知ではなく、問題が続く間は画面の上部に出し続ける。
import type { StorageStatus } from "../state/usePersistedState";

export function StorageBanner({ status }: { status: StorageStatus }) {
  const messages: string[] = [];
  if (status.corrupt) {
    messages.push(
      "このブラウザに保存されていたデータを読めなかったため、自動保存を止めています。" +
        (status.corrupt.backupKey ? "元のデータは別の場所に退避しました。" : "") +
        "最後に書き出したJSONを読み込んでください。",
    );
  }
  if (status.saveError) {
    messages.push(`${status.saveError}。このままではページを再読み込みすると入力が消えます。`);
  }
  if (status.changedInOtherTab) {
    messages.push("別のタブでデータが変更されました。このタブは読み取り専用です。ページを再読み込みしてください。");
  }
  if (messages.length === 0) return null;
  return (
    <div className="banner banner--warn" role="alert">
      {messages.map((m) => (
        <p key={m}>{m}</p>
      ))}
    </div>
  );
}
