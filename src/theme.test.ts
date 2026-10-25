import { describe, expect, it } from "vitest";
import { parseThemePreference, resolveTheme, THEME_KEY } from "./theme";

describe("表示テーマ（CR-007）", () => {
  it("保存値は light・dark だけを受け付け、それ以外は「端末に合わせる」にする", () => {
    expect(parseThemePreference("light")).toBe("light");
    expect(parseThemePreference("dark")).toBe("dark");
    for (const v of [null, undefined, "", "system", "DARK", "<script>", 1, {}]) expect(parseThemePreference(v)).toBe("system");
  });

  it("「端末に合わせる」は端末の設定で決まり、明示した設定は端末の設定より優先する", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });

  it("保存先のキーはアプリの名前空間の中にある（保存データの消去で一緒に消える）", () => {
    expect(THEME_KEY).toBe("project_management_poc:theme");
  });
});
