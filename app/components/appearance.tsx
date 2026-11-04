import { Form, useLocation } from "react-router";
import { THEMES, type ThemePreference } from "../theme";

/** System / Light / Dark, saved in a cookie on this device (D17). Works without JavaScript. */
export function AppearanceControl({ theme }: { theme: ThemePreference }) {
  const location = useLocation();
  return (
    <Form method="post" action="/theme" className="appearance" preventScrollReset>
      <input type="hidden" name="returnTo" value={location.pathname + location.search} />
      <fieldset>
        <legend className="visually-hidden">Appearance</legend>
        <div className="segmented">
          {THEMES.map((option) => (
            <button key={option.value} type="submit" name="theme" value={option.value} aria-pressed={theme === option.value}>
              {option.label}
            </button>
          ))}
        </div>
      </fieldset>
    </Form>
  );
}
