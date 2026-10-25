// 「その他」メニュー（CR-007）。使う頻度が低い操作と、取り消せない操作をたたんでおく。
// 開いたらメニューの最初の項目にフォーカスし、Esc・外側のクリックで閉じる。項目を押したら閉じる
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Icon } from "./Icon";

interface Props {
  label: string;
  children: ReactNode;
}

export function MenuButton({ label, children }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    ref.current?.querySelector<HTMLButtonElement>(".menu__list button:not(:disabled)")?.focus();
    const onPointer = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      buttonRef.current?.focus();
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="menu" ref={ref}>
      <button ref={buttonRef} type="button" className="button--icon" aria-expanded={open} onClick={() => setOpen((v) => !v)} title={label}>
        <Icon name="more" />
        <span className="visually-hidden">{label}</span>
      </button>
      {open && (
        // 項目のボタンを押したら閉じる（押した操作自体はそのまま動く）
        <div className="menu__list" onClick={(e) => (e.target as HTMLElement).closest("button") && setOpen(false)}>
          {children}
        </div>
      )}
    </div>
  );
}
