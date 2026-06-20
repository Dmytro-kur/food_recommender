import { STARTER_DATA_VERSION, defaultState, cookingGuides } from "./data.js";
import {
  getAlternativeText,
  normalizeIngredientName,
  parseLines,
  parseQuantity,
  formatQuantity,
} from "./utils.js";

export { getAlternativeText };

export function normalizeProductId(value) {
  const numeric = Number(value);
  return Number.isInteger(numeric) ? numeric : null;
}

export function findCatalogProduct(target, catalog = []) {
  const productId = normalizeProductId(typeof target === "object" ? target?.productId : null);
  if (productId !== null) {
    const exactMatch = catalog.find((item) => item.id === productId);
    if (exactMatch) return exactMatch;
  }

  const name = typeof target === "string" ? target : target?.name;
  if (!name) return null;
  const normalized = normalizeIngredientName(name);
  return catalog.find((item) => normalizeIngredientName(item.name) === normalized) || null;
}

function getProductKey(target, catalog = []) {
  const catalogMatch = findCatalogProduct(target, catalog);
  const explicitProductId = normalizeProductId(typeof target === "object" ? target?.productId : null);
  const productId = explicitProductId ?? catalogMatch?.id ?? null;

  if (productId !== null) return `product:${productId}`;

  const name = typeof target === "string" ? target : target?.name;
  if (!name) return "";
  return `name:${normalizeIngredientName(name)}`;
}

export function sameProduct(left, right, catalog = []) {
  const leftKey = getProductKey(left, catalog);
  const rightKey = getProductKey(right, catalog);
  return Boolean(leftKey && rightKey && leftKey === rightKey);
}

function attachProductLink(entry, catalog) {
  if (!entry?.name) return entry;
  if (normalizeProductId(entry.productId) !== null) return entry;

  const catalogMatch = findCatalogProduct(entry, catalog);
  if (!catalogMatch) return entry;
  return {
    ...entry,
    productId: catalogMatch.id,
  };
}

export function linkStateProducts(nextState) {
  const catalog = Array.isArray(nextState.productCatalog) ? nextState.productCatalog : [];
  const linkIngredients = (collection) =>
    Array.isArray(collection)
      ? collection.map((meal) => ({
          ...meal,
          ingredients: Array.isArray(meal.ingredients) ? meal.ingredients.map((ingredient) => attachProductLink(ingredient, catalog)) : [],
        }))
      : [];

  return {
    ...nextState,
    pantry: Array.isArray(nextState.pantry) ? nextState.pantry.map((item) => attachProductLink(item, catalog)) : [],
    shopping: Array.isArray(nextState.shopping) ? nextState.shopping.map((item) => attachProductLink(item, catalog)) : [],
    meals: linkIngredients(nextState.meals),
    recipeCatalog: linkIngredients(nextState.recipeCatalog),
  };
}

function mergeStarterCatalog(savedCatalog, starterCatalog) {
  const saved = Array.isArray(savedCatalog) ? savedCatalog : [];
  const merged = [...saved];

  starterCatalog.forEach((starterItem) => {
    const exists = merged.some(
      (item) =>
        item.id === starterItem.id ||
        normalizeIngredientName(item.name || item.title) === normalizeIngredientName(starterItem.name || starterItem.title),
    );
    if (!exists) merged.push(structuredClone(starterItem));
  });

  return merged;
}

export function normalizeMeal(meal) {
  const steps = Array.isArray(meal.steps) && meal.steps.length ? meal.steps : cookingGuides[meal.title];

  return {
    ...meal,
    ingredients: Array.isArray(meal.ingredients)
      ? meal.ingredients.map((ingredient) => ({
          ...ingredient,
          missing: typeof ingredient.missing === "boolean" ? ingredient.missing : true,
        }))
      : [],
    steps: steps?.length
      ? steps
      : [
          "Підготуй усі інгредієнти та кухонне приладдя.",
          "Приготуй основні продукти до готовності, орієнтуючись на їхню текстуру.",
          "З’єднай усе разом, додай сіль і спеції на смак та подавай гарячим.",
        ],
  };
}

export function hydrateState(saved) {
  const base = structuredClone(defaultState);
  const source = saved || {};
  const hydrated = {
    ...base,
    ...source,
    meals: Array.isArray(source.meals) ? source.meals : base.meals,
    shopping: Array.isArray(source.shopping) ? source.shopping : base.shopping,
    pantry: Array.isArray(source.pantry) ? source.pantry : base.pantry,
    productCatalog: mergeStarterCatalog(source.productCatalog, base.productCatalog),
    recipeCatalog: mergeStarterCatalog(source.recipeCatalog, base.recipeCatalog),
    dataVersion: STARTER_DATA_VERSION,
  };

  hydrated.meals = hydrated.meals.map(normalizeMeal);
  hydrated.recipeCatalog = hydrated.recipeCatalog.map(normalizeMeal);
  hydrated.selectedDay = Math.min(Math.max(Number(hydrated.selectedDay) || 0, 0), Math.max(hydrated.meals.length - 1, 0));
  return linkStateProducts(hydrated);
}

export function remainingItems(state) {
  return state.shopping.filter((item) => !item.checked);
}

export function shoppingTotal(state) {
  return state.shopping.reduce((sum, item) => sum + item.price, 0);
}

export function checkedTotal(state) {
  return state.shopping.filter((item) => item.checked).reduce((sum, item) => sum + item.price, 0);
}

export function getSortedSuggestions(state) {
  return state.meals
    .slice(1)
    .map((meal) => ({
      ...meal,
      available: meal.ingredients.filter((ingredient) => !ingredient.missing).length,
      total: meal.ingredients.length,
    }))
    .sort((a, b) => {
      if (state.priority === "price") return a.price - b.price || a.time - b.time;
      if (state.priority === "time") return a.time - b.time || a.price - b.price;
      return a.price + a.time * 1.8 - (b.price + b.time * 1.8);
    })
    .slice(0, 3);
}

export function findPantryIngredient(target, pantry, catalog = []) {
  const productKey = getProductKey(target, catalog);
  if (productKey) {
    const exactMatch = pantry.find((item) => getProductKey(item, catalog) === productKey);
    if (exactMatch) return exactMatch;
  }

  const name = typeof target === "string" ? target : target?.name;
  if (!name) return null;
  const normalized = normalizeIngredientName(name);
  return pantry.find((item) => {
    const pantryName = normalizeIngredientName(item.name);
    return pantryName.includes(normalized) || normalized.includes(pantryName);
  });
}

export function hasPantryIngredient(target, pantry, catalog = []) {
  return Boolean(findPantryIngredient(target, pantry, catalog));
}

export function parseIngredients(value, state) {
  return parseLines(value).map((line) => {
    const [rawName, ...rawAmount] = line.split("|");
    const name = rawName.trim();
    const amount = rawAmount.join("|").trim() || "за смаком";

    return {
      name,
      amount,
      missing: !hasPantryIngredient(name, state.pantry, state.productCatalog),
    };
  });
}

export function syncIngredientAvailability(state) {
  [...state.meals, ...state.recipeCatalog].forEach((meal) => {
    meal.ingredients.forEach((ingredient) => {
      ingredient.missing = !hasPantryIngredient(ingredient, state.pantry, state.productCatalog);
    });
  });
}

export function consumePantryAmount(state, itemId, usedAmount) {
  const index = state.pantry.findIndex((item) => item.id === itemId);
  if (index < 0) return;

  const item = state.pantry[index];
  const available = parseQuantity(item.amount);
  const used = parseQuantity(usedAmount);

  if (!available || !used || available.dimension !== used.dimension) {
    item.low = true;
    return;
  }

  const remaining = available.baseValue - used.baseValue;
  if (remaining <= 0.0001) {
    state.pantry.splice(index, 1);
    return;
  }

  item.amount = formatQuantity(remaining, available);
  item.low = remaining / available.baseValue <= 0.35 || (available.dimension === "count" && remaining <= 2);
}

export function inferCategory(target, productCatalog = []) {
  const catalogMatch = findCatalogProduct(target, productCatalog);
  if (catalogMatch) return catalogMatch.category;

  const name = typeof target === "string" ? target : target?.name || "";
  const normalized = name.toLowerCase();
  if (["йогурт", "сир", "молоко", "вершки"].some((word) => normalized.includes(word))) return "Молочне";
  if (["кур", "м’яс", "риба"].some((word) => normalized.includes(word))) return "М’ясо та риба";
  if (["булгур", "греч", "хліб", "рис", "макарон"].some((word) => normalized.includes(word))) return "Бакалія";
  return "Овочі";
}

export function estimatePrice(target, productCatalog = []) {
  const catalogMatch = findCatalogProduct(target, productCatalog);
  if (catalogMatch) return catalogMatch.price;

  const name = typeof target === "string" ? target : target?.name;
  const prices = {
    "Куряче філе": 96,
    Йогурт: 31,
    Печериці: 42,
    Зелень: 22,
    Хліб: 36,
  };
  return prices[name] || 35;
}

export function syncMealDates(state) {
  const shortDays = ["Нд", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];
  const fullDays = ["Неділя", "Понеділок", "Вівторок", "Середа", "Четвер", "П’ятниця", "Субота"];
  const today = new Date();
  today.setHours(12, 0, 0, 0);

  state.meals = state.meals.map((meal, index) => {
    const date = new Date(today);
    date.setDate(today.getDate() + index);
    return {
      ...meal,
      day: index === 0 ? "Сьогодні" : index === 1 ? "Завтра" : fullDays[date.getDay()],
      shortDay: shortDays[date.getDay()],
      date: date.getDate(),
    };
  });
}
