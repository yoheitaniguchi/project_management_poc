import { describe, expect, it } from "vitest";
import { appendAuditLog } from "./auditLog";
import { createInitialState } from "./types";
import { validateState } from "./validate";

const input = { operator: "テスト太郎", targetType: "proposal", targetId: "p", action: "proposal.update", before: { a: 1 }, after: { a: 2 } };

describe("appendAuditLog（追記のみ）", () => {
  it("連番を振って末尾に足し、元の一覧は変えない", () => {
    const s0 = createInitialState();
    let n = 0;
    const s1 = appendAuditLog(s0, input, new Date("2030-01-01T00:00:00.000Z"), () => `a${++n}`);
    const s2 = appendAuditLog(s1, input, new Date("2030-01-01T00:01:00.000Z"), () => `a${++n}`);
    expect(s0.auditLogs).toEqual([]);
    expect(s1.auditLogs).toHaveLength(1);
    expect(s2.auditLogs.map((a) => a.seq)).toEqual([1, 2]);
    expect(s2.auditLogs[0]).toBe(s1.auditLogs[0]);
    expect(s2.auditLogs[1]).toMatchObject({ operatorSelfDeclared: true, before: '{"a":1}', after: '{"a":2}' });
    expect(validateState(s2).ok).toBe(true);
  });

  it("端末の時計が戻っても、日時は前のログより前にならない", () => {
    const s1 = appendAuditLog(createInitialState(), input, new Date("2030-01-02T00:00:00.000Z"), () => "a1");
    const s2 = appendAuditLog(s1, input, new Date("2030-01-01T00:00:00.000Z"), () => "a2");
    expect(s2.auditLogs[1].at).toBe("2030-01-02T00:00:00.000Z");
    expect(validateState(s2).ok).toBe(true);
  });
});
