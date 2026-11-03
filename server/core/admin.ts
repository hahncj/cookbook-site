// Admin allow-list rules (decision D5). Pure logic: no framework or host imports.

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function parseAdminEmails(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map(normalizeEmail)
    .filter((email) => email.length > 0);
}

export function isAdminEmail(email: string | null | undefined, adminEmails: readonly string[]): boolean {
  if (!email) return false;
  return adminEmails.includes(normalizeEmail(email));
}
