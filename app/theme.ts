// Viewer theme preference (D17): System (default), Light, or Dark.
// Stored in a cookie so the server renders the right theme with no flash.

export type ThemePreference = "system" | "light" | "dark";

export const THEME_COOKIE = "theme";
export const THEMES: { value: ThemePreference; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

export function isTheme(value: unknown): value is ThemePreference {
  return value === "system" || value === "light" || value === "dark";
}

export function readTheme(cookieHeader: string | null): ThemePreference {
  if (!cookieHeader) return "system";
  for (const part of cookieHeader.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === THEME_COOKIE) {
      const value = decodeURIComponent(rest.join("="));
      return isTheme(value) ? value : "system";
    }
  }
  return "system";
}

export function themeCookie(theme: ThemePreference, secure: boolean): string {
  const attributes = [`${THEME_COOKIE}=${theme}`, "Path=/", "Max-Age=31536000", "SameSite=Lax"];
  if (secure) attributes.push("Secure");
  return attributes.join("; ");
}

/** Only same-site relative paths are allowed as a return location. */
export function safeReturnPath(value: unknown, fallback = "/"): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return fallback;
  return value;
}
