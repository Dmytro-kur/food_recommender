export function parseLines(value) {
  return String(value)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

export function normalizeIngredientName(name) {
  return String(name)
    .toLowerCase()
    .replaceAll("’", "")
    .replaceAll("'", "")
    .replace(/\s+/g, " ")
    .trim();
}

export function pluralize(number, one, few, many) {
  const mod10 = number % 10;
  const mod100 = number % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

export function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
