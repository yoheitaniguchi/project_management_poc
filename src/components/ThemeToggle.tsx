// 表示テーマの切替（CR-007）：端末に合わせる／ライト／ダーク
import { useEffect, useState } from "react";
import { applyTheme, readThemePreference, THEME_OPTIONS, watchSystemTheme, writeThemePreference, type ThemePreference } from "../theme";
import { Icon, type IconName } from "./Icon";

const ICONS: Record<ThemePreference, IconName> = { system: "monitor", light: "sun", dark: "moon" };

export function ThemeToggle() {
  const [pref, setPref] = useState<ThemePreference>(readThemePreference);
  useEffect(() => {
    applyTheme(pref);
    if (pref !== "system") return;
    return watchSystemTheme(() => applyTheme("system"));
  }, [pref]);

  return (
    <div className="segmented" role="group" aria-label="表示テーマ">
      {THEME_OPTIONS.map((o) => (
        <button
          key={o.id}
          type="button"
          className="segmented__item"
          aria-pressed={pref === o.id}
          title={o.label}
          onClick={() => {
            setPref(o.id);
            writeThemePreference(o.id);
          }}
        >
          <Icon name={ICONS[o.id]} />
          <span className="visually-hidden">{o.label}</span>
        </button>
      ))}
    </div>
  );
}
