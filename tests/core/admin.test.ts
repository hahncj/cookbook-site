import { describe, expect, it } from "vitest";
import { isAdminEmail, parseAdminEmails } from "../../server/core/admin";

describe("admin allow-list (D5)", () => {
  it("parses a comma-separated list, normalizing case and whitespace", () => {
    expect(parseAdminEmails(" A@Example.com, b@example.com ,, ")).toEqual(["a@example.com", "b@example.com"]);
    expect(parseAdminEmails(undefined)).toEqual([]);
  });

  it("accepts only listed emails, case-insensitively", () => {
    const admins = parseAdminEmails("a@example.com,b@example.com");
    expect(isAdminEmail("A@EXAMPLE.COM", admins)).toBe(true);
    expect(isAdminEmail("b@example.com", admins)).toBe(true);
    expect(isAdminEmail("c@example.com", admins)).toBe(false);
    expect(isAdminEmail(null, admins)).toBe(false);
    expect(isAdminEmail("", admins)).toBe(false);
  });
});
