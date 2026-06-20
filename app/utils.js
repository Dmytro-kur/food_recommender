export function getAlternativeText(meal) {
  if (meal.title.toLowerCase().includes("кур")) return "Заміни курку на квасолю, а йогурт — на ложку олії.";
  if (meal.title.toLowerCase().includes("гриб")) return "Заміни гриби на моркву з цибулею, які вже є вдома.";
  return "Продукт, якого бракує, можна пропустити або замінити сезонним овочем.";
}

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

export function parseQuantity(value) {
  const normalized = String(value).toLowerCase().replace(",", ".").trim();
  const numericMatch = normalized.match(/\d+(?:\.\d+)?/);
  const number = normalized.includes("пів") ? 0.5 : Number(numericMatch?.[0]);
  if (!Number.isFinite(number)) return null;

  const units = [
    { pattern: /кг/, dimension: "mass", factor: 1000, unit: "кг" },
    { pattern: /(^|\s)г($|\s)/, dimension: "mass", factor: 1, unit: "г" },
    { pattern: /мл/, dimension: "volume", factor: 1, unit: "мл" },
    { pattern: /(^|\s)л($|\s)/, dimension: "volume", factor: 1000, unit: "л" },
    { pattern: /шт/, dimension: "count", factor: 1, unit: "шт" },
    { pattern: /банк/, dimension: "container", factor: 1, unit: "банка" },
    { pattern: /пуч/, dimension: "bundle", factor: 1, unit: "пучка" },
    { pattern: /скиб/, dimension: "slice", factor: 1, unit: "скибки" },
  ];
  const matchedUnit = units.find((entry) => entry.pattern.test(normalized));
  if (!matchedUnit) return null;

  return {
    ...matchedUnit,
    baseValue: number * matchedUnit.factor,
  };
}

export function formatQuantity(baseValue, quantity) {
  const displayValue = baseValue / quantity.factor;
  const rounded = Math.round(displayValue * 100) / 100;
  return `${String(rounded).replace(".", ",")} ${quantity.unit}`;
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
