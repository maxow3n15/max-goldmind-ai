import { describe, it, expect } from "vitest";
import { classifyOanda401, cleanCredential } from "@/lib/brokers/oanda-auth";

describe("OANDA 401 diagnosis", () => {
  it("strips whitespace and line breaks from pasted credentials", () => {
    expect(cleanCredential("  abc-123\n ")).toBe("abc-123");
  });
  it("reports a revoked token when listing accounts also fails", () => {
    expect(classifyOanda401("101-1", 401, [])).toMatch(/invalid or has been revoked/);
  });
  it("reports an account mismatch and lists usable accounts", () => {
    const m = classifyOanda401("101-1", 200, ["101-2", "101-3"]);
    expect(m).toMatch(/isn't on it/);
    expect(m).toContain("101-2, 101-3");
  });
});
