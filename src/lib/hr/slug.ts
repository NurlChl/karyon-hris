/** Combining diacritical marks, U+0300–U+036F. */
const COMBINING_MARKS = /[\u0300-\u036f]/g;

/**
 * Builds a URL-safe slug.
 *
 * `normalize("NFD")` splits accented characters into a base letter plus a
 * combining mark, which the regex then strips — so "Akuntansi Möller" yields
 * "akuntansi-moller" rather than dropping the accented letter entirely.
 */
export function slugify(value: string, maxLength = 60): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(COMBINING_MARKS, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLength);
}

/**
 * Slug for a job vacancy. The suffix keeps two openings with the same title
 * distinct without exposing a database id in the URL.
 */
export function slugifyVacancy(title: string, suffix: string): string {
  const base = slugify(title);
  return `${base || "lowongan"}-${suffix}`;
}
