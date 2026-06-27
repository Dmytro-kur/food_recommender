import { STARTER_DATA_VERSION, defaultState } from "./data.js";
import {
  normalizeIngredientName,
  parseLines,
} from "./utils.js";

function normalizeProductId(value) {
  const numeric = Number(value);
  return Number.isInteger(numeric) ? numeric : null;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isEntityArray(value) {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((item) => isPlainObject(item) && Object.hasOwn(item, "id"))
  );
}

function canonicalizeValue(value) {
  if (Array.isArray(value)) return value.map(canonicalizeValue);
  if (!isPlainObject(value)) return value;

  return Object.keys(value)
    .sort()
    .reduce((result, key) => {
      if (value[key] !== undefined) {
        result[key] = canonicalizeValue(value[key]);
      }
      return result;
    }, {});
}

function cloneValue(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function mergeScalarValue(baseValue, localValue, remoteValue) {
  const localChanged = !areStatesEqual(localValue, baseValue);
  const remoteChanged = !areStatesEqual(remoteValue, baseValue);

  if (localChanged && !remoteChanged) return cloneValue(localValue);
  if (!localChanged && remoteChanged) return cloneValue(remoteValue);
  if (localChanged && remoteChanged) return cloneValue(localValue);

  if (remoteValue !== undefined) return cloneValue(remoteValue);
  if (localValue !== undefined) return cloneValue(localValue);
  return cloneValue(baseValue);
}

function mergeObjectValue(baseValue, localValue, remoteValue) {
  const keys = new Set([
    ...Object.keys(baseValue || {}),
    ...Object.keys(localValue || {}),
    ...Object.keys(remoteValue || {}),
  ]);
  const merged = {};

  keys.forEach((key) => {
    const nextValue = mergeStateValue(baseValue?.[key], localValue?.[key], remoteValue?.[key]);
    if (nextValue !== undefined) {
      merged[key] = nextValue;
    }
  });

  return merged;
}

function mergeEntityRecord(baseValue, localValue, remoteValue) {
  const merged = mergeObjectValue(baseValue, localValue, remoteValue);
  merged.id = localValue?.id ?? remoteValue?.id ?? baseValue?.id;
  return merged;
}

function mergeEntityArray(baseValue = [], localValue = [], remoteValue = []) {
  const baseMap = new Map(baseValue.map((item) => [item.id, item]));
  const localMap = new Map(localValue.map((item) => [item.id, item]));
  const remoteMap = new Map(remoteValue.map((item) => [item.id, item]));
  const mergedMap = new Map();
  const allIds = new Set([...baseMap.keys(), ...localMap.keys(), ...remoteMap.keys()]);

  allIds.forEach((id) => {
    const baseItem = baseMap.get(id);
    const localItem = localMap.get(id);
    const remoteItem = remoteMap.get(id);

    if (!baseItem) {
      if (localItem && remoteItem) {
        mergedMap.set(id, mergeEntityRecord({}, localItem, remoteItem));
      } else if (localItem) {
        mergedMap.set(id, cloneValue(localItem));
      } else if (remoteItem) {
        mergedMap.set(id, cloneValue(remoteItem));
      }
      return;
    }

    const localDeleted = !localItem;
    const remoteDeleted = !remoteItem;
    const localChanged = localItem ? !areStatesEqual(localItem, baseItem) : false;
    const remoteChanged = remoteItem ? !areStatesEqual(remoteItem, baseItem) : false;

    if (localDeleted && remoteDeleted) return;
    if (localDeleted && !remoteChanged) return;
    if (remoteDeleted && !localChanged) return;
    if (localDeleted && remoteChanged) {
      mergedMap.set(id, cloneValue(remoteItem));
      return;
    }
    if (remoteDeleted && localChanged) {
      mergedMap.set(id, cloneValue(localItem));
      return;
    }

    mergedMap.set(id, mergeEntityRecord(baseItem, localItem, remoteItem));
  });

  const orderedIds = [];
  const seen = new Set();
  const pushIds = (items) => {
    items.forEach((item) => {
      if (!item || seen.has(item.id) || !mergedMap.has(item.id)) return;
      seen.add(item.id);
      orderedIds.push(item.id);
    });
  };

  pushIds(localValue);
  pushIds(remoteValue);
  pushIds(baseValue);
  mergedMap.forEach((_, id) => {
    if (!seen.has(id)) orderedIds.push(id);
  });

  return orderedIds.map((id) => mergedMap.get(id));
}

function mergeStateValue(baseValue, localValue, remoteValue) {
  const treatAsEntityArray = isEntityArray(baseValue) || isEntityArray(localValue) || isEntityArray(remoteValue);
  if (treatAsEntityArray) {
    return mergeEntityArray(baseValue || [], localValue || [], remoteValue || []);
  }

  if (isPlainObject(baseValue) || isPlainObject(localValue) || isPlainObject(remoteValue)) {
    return mergeObjectValue(baseValue || {}, localValue || {}, remoteValue || {});
  }

  if (Array.isArray(baseValue) || Array.isArray(localValue) || Array.isArray(remoteValue)) {
    return mergeScalarValue(baseValue || [], localValue || [], remoteValue || []);
  }

  return mergeScalarValue(baseValue, localValue, remoteValue);
}

function normalizeActiveView(value) {
  if (value === "pantry") return "pantry";
  if (value === "requests" || value === "shopping") return "requests";
  return "recipes";
}

function dedupeByIdentity(items = []) {
  const seenIds = new Set();
  const seenNames = new Set();
  const deduped = [];

  items.forEach((item) => {
    const id = normalizeProductId(item?.id);
    const identity = normalizeIngredientName(item?.title || item?.name || "");
    if ((id !== null && seenIds.has(id)) || (identity && seenNames.has(identity))) {
      return;
    }

    if (id !== null) seenIds.add(id);
    if (identity) seenNames.add(identity);
    deduped.push(item);
  });

  return deduped;
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

export function normalizeRecipe(recipe) {
  const steps = Array.isArray(recipe?.steps)
    ? recipe.steps.map((step) => String(step).trim()).filter(Boolean)
    : [];

  return {
    id: normalizeProductId(recipe?.id) ?? Date.now(),
    title: String(recipe?.title || "").trim(),
    time: Math.max(Number(recipe?.time) || 0, 0),
    price: Math.max(Number(recipe?.price) || 0, 0),
    emoji: String(recipe?.emoji || "🍲").trim() || "🍲",
    tag: String(recipe?.tag || "Мій рецепт").trim() || "Мій рецепт",
    ingredients: Array.isArray(recipe?.ingredients)
      ? recipe.ingredients
          .map((ingredient) => ({
            name: String(ingredient?.name || "").trim(),
            amount: String(ingredient?.amount || "за смаком").trim() || "за смаком",
            missing: typeof ingredient?.missing === "boolean" ? ingredient.missing : true,
            productId: normalizeProductId(ingredient?.productId),
          }))
          .filter((ingredient) => ingredient.name)
      : [],
    steps: steps.length
      ? steps
      : [
          "Підготуй усі інгредієнти.",
          "Приготуй основу страви до готовності.",
          "Додай спеції на смак і подавай.",
        ],
  };
}

function collectLegacyRecipes(source, starterRecipes) {
  const savedRecipes = Array.isArray(source?.recipeCatalog) ? source.recipeCatalog : [];
  const savedMeals = Array.isArray(source?.meals) ? source.meals : [];

  return dedupeByIdentity([
    ...savedRecipes,
    ...savedMeals.map((meal) => ({
      id: meal.id,
      title: meal.title,
      time: meal.time,
      price: meal.price,
      emoji: meal.emoji,
      tag: meal.tag || "Мій рецепт",
      ingredients: meal.ingredients,
      steps: meal.steps,
    })),
    ...starterRecipes,
  ]);
}

export function linkStateProducts(nextState) {
  const catalog = Array.isArray(nextState.productCatalog) ? nextState.productCatalog : [];

  return {
    ...nextState,
    productCatalog: catalog,
    pantry: Array.isArray(nextState.pantry) ? nextState.pantry.map((item) => attachProductLink(item, catalog)) : [],
    recipeCatalog: Array.isArray(nextState.recipeCatalog)
      ? nextState.recipeCatalog.map((recipe) => ({
          ...recipe,
          ingredients: Array.isArray(recipe.ingredients)
            ? recipe.ingredients.map((ingredient) => attachProductLink(ingredient, catalog))
            : [],
        }))
      : [],
  };
}

export function hydrateState(saved) {
  const source = saved || {};
  const base = structuredClone(defaultState);
  const productCatalog = mergeStarterCatalog(source.productCatalog, base.productCatalog);
  const recipeCatalog = collectLegacyRecipes(source, base.recipeCatalog).map(normalizeRecipe);

  const hydrated = {
    dataVersion: STARTER_DATA_VERSION,
    activeView: normalizeActiveView(source.activeView),
    pantry: Array.isArray(source.pantry) ? source.pantry : base.pantry,
    productCatalog,
    recipeCatalog,
  };

  return linkStateProducts(hydrated);
}

function serializeStateSnapshot(snapshot) {
  return JSON.stringify(canonicalizeValue(hydrateState(snapshot)));
}

export function areStatesEqual(left, right) {
  return serializeStateSnapshot(left) === serializeStateSnapshot(right);
}

export function mergeSharedState(baseState, localState, remoteState) {
  const merged = mergeStateValue(baseState || {}, localState || {}, remoteState || {}) || {};
  if (localState?.activeView) {
    merged.activeView = normalizeActiveView(localState.activeView);
  }
  return hydrateState(merged);
}

function findPantryIngredient(target, pantry, catalog = []) {
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

function hasPantryIngredient(target, pantry, catalog = []) {
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
  state.recipeCatalog.forEach((recipe) => {
    recipe.ingredients.forEach((ingredient) => {
      ingredient.missing = !hasPantryIngredient(ingredient, state.pantry, state.productCatalog);
    });
  });
}

export function inferCategory(target, productCatalog = []) {
  const catalogMatch = findCatalogProduct(target, productCatalog);
  if (catalogMatch) return catalogMatch.category;

  const name = typeof target === "string" ? target : target?.name || "";
  const normalized = name.toLowerCase();
  if (["йогурт", "сир", "молоко", "вершки"].some((word) => normalized.includes(word))) return "Молочне";
  if (["кур", "м’яс", "риба", "тунець"].some((word) => normalized.includes(word))) return "М’ясо та риба";
  if (["булгур", "греч", "хліб", "рис", "макарон", "сочевиц", "борошн", "олія"].some((word) => normalized.includes(word))) {
    return "Бакалія";
  }
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
    Яйця: 68,
  };
  return prices[name] || 35;
}
