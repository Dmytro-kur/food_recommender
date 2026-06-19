import { deleteState, readState, writeState } from "./db.js";
import { neonClient, neonConfigured } from "./neon.js";

const STORAGE_KEY = "krykhta-state-v1";
const LOCAL_DB_STATE_KEY = "state";
const STARTER_DATA_VERSION = 2;

const defaultState = {
  dataVersion: STARTER_DATA_VERSION,
  activeView: "home",
  priority: "balance",
  selectedDay: 0,
  budget: 420,
  shopping: [
    { id: 1, name: "Куряче філе", amount: "500 г", price: 96, category: "М’ясо та риба", checked: false, urgent: true },
    { id: 2, name: "Йогурт натуральний", amount: "200 г", price: 31, category: "Молочне", checked: false, urgent: false },
    { id: 3, name: "Печериці", amount: "300 г", price: 42, category: "Овочі", checked: false, urgent: false },
    { id: 4, name: "Помідори", amount: "500 г", price: 48, category: "Овочі", checked: true, urgent: false },
    { id: 5, name: "Зелень", amount: "1 пучок", price: 22, category: "Овочі", checked: false, urgent: false },
    { id: 6, name: "Булгур", amount: "400 г", price: 39, category: "Бакалія", checked: true, urgent: false },
    { id: 7, name: "Хліб цільнозерновий", amount: "1 шт", price: 36, category: "Бакалія", checked: false, urgent: false },
  ],
  pantry: [
    { id: 1, name: "Яйця", amount: "6 шт", emoji: "🥚", low: false },
    { id: 2, name: "Гречка", amount: "350 г", emoji: "🌾", low: false },
    { id: 3, name: "Цибуля", amount: "2 шт", emoji: "🧅", low: true },
    { id: 4, name: "Морква", amount: "3 шт", emoji: "🥕", low: false },
    { id: 5, name: "Сир", amount: "80 г", emoji: "🧀", low: true },
    { id: 6, name: "Картопля", amount: "1,2 кг", emoji: "🥔", low: false },
    { id: 7, name: "Квасоля", amount: "1 банка", emoji: "🫘", low: false },
  ],
  meals: [
    {
      id: 1,
      day: "Сьогодні",
      shortDay: "Пн",
      date: 19,
      title: "Курка з булгуром",
      time: 25,
      price: 78,
      emoji: "🍲",
      tag: "Найкращий баланс",
      ingredients: [
        { name: "Булгур", amount: "180 г", missing: false },
        { name: "Морква", amount: "1 шт", missing: false },
        { name: "Цибуля", amount: "1 шт", missing: false },
        { name: "Куряче філе", amount: "300 г", missing: true },
        { name: "Йогурт", amount: "100 г", missing: true },
      ],
    },
    {
      id: 2,
      day: "Завтра",
      shortDay: "Вт",
      date: 20,
      title: "Гречка з грибами",
      time: 18,
      price: 44,
      emoji: "🍄",
      tag: "Найдешевше",
      ingredients: [
        { name: "Гречка", amount: "180 г", missing: false },
        { name: "Цибуля", amount: "1 шт", missing: false },
        { name: "Печериці", amount: "250 г", missing: true },
        { name: "Йогурт", amount: "80 г", missing: true },
      ],
    },
    {
      id: 3,
      day: "Середа",
      shortDay: "Ср",
      date: 21,
      title: "Теплий салат з квасолею",
      time: 12,
      price: 52,
      emoji: "🥗",
      tag: "Найшвидше",
      ingredients: [
        { name: "Квасоля", amount: "1 банка", missing: false },
        { name: "Морква", amount: "1 шт", missing: false },
        { name: "Помідори", amount: "2 шт", missing: false },
        { name: "Зелень", amount: "пів пучка", missing: true },
      ],
    },
    {
      id: 4,
      day: "Четвер",
      shortDay: "Чт",
      date: 22,
      title: "Картопляна фритата",
      time: 22,
      price: 39,
      emoji: "🍳",
      tag: "З того, що є",
      ingredients: [
        { name: "Яйця", amount: "4 шт", missing: false },
        { name: "Картопля", amount: "400 г", missing: false },
        { name: "Цибуля", amount: "1 шт", missing: false },
        { name: "Сир", amount: "60 г", missing: false },
      ],
    },
    {
      id: 5,
      day: "П’ятниця",
      shortDay: "Пт",
      date: 23,
      title: "Овочевий суп",
      time: 30,
      price: 46,
      emoji: "🥣",
      tag: "На два дні",
      ingredients: [
        { name: "Картопля", amount: "500 г", missing: false },
        { name: "Морква", amount: "2 шт", missing: false },
        { name: "Цибуля", amount: "1 шт", missing: false },
        { name: "Зелень", amount: "пів пучка", missing: true },
      ],
    },
    {
      id: 6,
      day: "Субота",
      shortDay: "Сб",
      date: 24,
      title: "Сирні гарячі тости",
      time: 10,
      price: 51,
      emoji: "🥪",
      tag: "Дуже швидко",
      ingredients: [
        { name: "Хліб", amount: "4 скибки", missing: true },
        { name: "Сир", amount: "80 г", missing: false },
        { name: "Помідори", amount: "1 шт", missing: false },
      ],
    },
    {
      id: 7,
      day: "Неділя",
      shortDay: "Нд",
      date: 25,
      title: "Запечена картопля",
      time: 35,
      price: 43,
      emoji: "🥔",
      tag: "Мінімум зусиль",
      ingredients: [
        { name: "Картопля", amount: "700 г", missing: false },
        { name: "Йогурт", amount: "120 г", missing: true },
        { name: "Зелень", amount: "пів пучка", missing: true },
      ],
    },
  ],
  productCatalog: [],
  recipeCatalog: [],
};

const cookingGuides = {
  "Курка з булгуром": [
    "Промий булгур. Залий його водою у співвідношенні один до двох, трохи посоли й вари 12–15 хвилин.",
    "Наріж куряче філе невеликими шматочками, а моркву та цибулю — кубиками.",
    "Обсмаж курку 5–6 хвилин на добре розігрітій пательні.",
    "Додай овочі та готуй ще 5 хвилин, поки вони не стануть м’якими.",
    "Змішай курку з булгуром. Подай з ложкою натурального йогурту.",
  ],
  "Гречка з грибами": [
    "Промий гречку, залий двома частинами води та вари під кришкою 15 хвилин.",
    "Наріж цибулю й печериці.",
    "Обсмаж цибулю 2 хвилини, додай гриби та готуй ще 6–7 хвилин.",
    "Змішай гриби з готовою гречкою, посоли й додай ложку йогурту перед подачею.",
  ],
  "Теплий салат з квасолею": [
    "Злий рідину з квасолі та промий її.",
    "Наріж моркву тонкою соломкою, а помідори — часточками.",
    "Прогрій квасолю з морквою на пательні 5 хвилин.",
    "Зніми з вогню, додай помідори, зелень, сіль та трохи олії.",
  ],
  "Картопляна фритата": [
    "Наріж картоплю тонкими скибками, а цибулю — півкільцями.",
    "Обсмаж картоплю з цибулею під кришкою 10 хвилин.",
    "Збий яйця з дрібкою солі та залий ними картоплю.",
    "Посип сиром і готуй під кришкою ще 7–8 хвилин на малому вогні.",
  ],
  "Овочевий суп": [
    "Постав 1,5 літра води на вогонь.",
    "Наріж картоплю кубиками й вари 10 хвилин.",
    "Додай нарізані моркву та цибулю, посоли й вари ще 12–15 хвилин.",
    "Вимкни вогонь, додай зелень і дай супу постояти 5 хвилин.",
  ],
  "Сирні гарячі тости": [
    "Наріж помідор тонкими скибками.",
    "Виклади на хліб сир і помідор.",
    "Підсмаж тости на сухій пательні під кришкою по 3–4 хвилини з кожного боку.",
  ],
  "Запечена картопля": [
    "Розігрій духовку до 210 градусів.",
    "Добре помий картоплю, наріж часточками та змішай із сіллю й ложкою олії.",
    "Запікай 30–35 хвилин, один раз перемішавши.",
    "Змішай йогурт із зеленню та подай як соус.",
  ],
};

const starterProductCatalog = [
  { id: 101, name: "Рис", amount: "500 г", price: 48, category: "Бакалія", emoji: "🍚" },
  { id: 102, name: "Макарони", amount: "500 г", price: 46, category: "Бакалія", emoji: "🍝" },
  { id: 103, name: "Вівсянка", amount: "500 г", price: 42, category: "Бакалія", emoji: "🥣" },
  { id: 104, name: "Сочевиця", amount: "400 г", price: 57, category: "Бакалія", emoji: "🫘" },
  { id: 105, name: "Кускус", amount: "400 г", price: 55, category: "Бакалія", emoji: "🌾" },
  { id: 106, name: "Борошно", amount: "1 кг", price: 38, category: "Бакалія", emoji: "🌾" },
  { id: 107, name: "Олія", amount: "850 мл", price: 72, category: "Бакалія", emoji: "🫗" },
  { id: 108, name: "Томати консервовані", amount: "1 банка", price: 54, category: "Бакалія", emoji: "🥫" },
  { id: 109, name: "Нут", amount: "1 банка", price: 49, category: "Бакалія", emoji: "🫛" },
  { id: 110, name: "Тунець", amount: "1 банка", price: 79, category: "М’ясо та риба", emoji: "🐟" },
  { id: 111, name: "Риба біла", amount: "500 г", price: 145, category: "М’ясо та риба", emoji: "🐟" },
  { id: 112, name: "Фарш курячий", amount: "500 г", price: 105, category: "М’ясо та риба", emoji: "🍗" },
  { id: 113, name: "Молоко", amount: "900 мл", price: 48, category: "Молочне", emoji: "🥛" },
  { id: 114, name: "Сметана", amount: "300 г", price: 44, category: "Молочне", emoji: "🥛" },
  { id: 115, name: "Кисломолочний сир", amount: "350 г", price: 78, category: "Молочне", emoji: "🧀" },
  { id: 116, name: "Вершки", amount: "200 мл", price: 52, category: "Молочне", emoji: "🥛" },
  { id: 117, name: "Банани", amount: "1 кг", price: 62, category: "Фрукти", emoji: "🍌" },
  { id: 118, name: "Яблука", amount: "1 кг", price: 45, category: "Фрукти", emoji: "🍎" },
  { id: 119, name: "Часник", amount: "1 головка", price: 14, category: "Овочі", emoji: "🧄" },
  { id: 120, name: "Перець солодкий", amount: "500 г", price: 69, category: "Овочі", emoji: "🫑" },
  { id: 121, name: "Кабачок", amount: "1 шт", price: 39, category: "Овочі", emoji: "🥒" },
  { id: 122, name: "Броколі", amount: "400 г", price: 72, category: "Овочі", emoji: "🥦" },
  { id: 123, name: "Гарбуз", amount: "1 кг", price: 38, category: "Овочі", emoji: "🎃" },
  { id: 124, name: "Огірки", amount: "500 г", price: 52, category: "Овочі", emoji: "🥒" },
  { id: 125, name: "Капуста", amount: "1 кг", price: 34, category: "Овочі", emoji: "🥬" },
  { id: 126, name: "Лаваш", amount: "2 шт", price: 39, category: "Хліб", emoji: "🫓" },
  { id: 127, name: "Лимон", amount: "1 шт", price: 18, category: "Фрукти", emoji: "🍋" },
  { id: 128, name: "Заморожені овочі", amount: "400 г", price: 62, category: "Заморожене", emoji: "🥦" },
  { id: 129, name: "Кукурудза", amount: "1 банка", price: 43, category: "Бакалія", emoji: "🌽" },
  { id: 130, name: "Соєвий соус", amount: "250 мл", price: 58, category: "Соуси", emoji: "🥫" },
];

const starterRecipeCatalog = [
  {
    id: 1001,
    title: "Рис з овочами та яйцем",
    time: 18,
    price: 45,
    emoji: "🍚",
    tag: "Швидка пательня",
    ingredients: [
      { name: "Рис", amount: "180 г" },
      { name: "Заморожені овочі", amount: "250 г" },
      { name: "Яйця", amount: "2 шт" },
      { name: "Соєвий соус", amount: "2 ст. ложки" },
    ],
    steps: [
      "Відвари рис до готовності та дай йому трохи охолонути.",
      "Обсмаж заморожені овочі 6–7 хвилин на великому вогні.",
      "Посунь овочі вбік, розбий яйця й швидко перемішай.",
      "Додай рис і соєвий соус, прогрій усе разом ще 3 хвилини.",
    ],
  },
  {
    id: 1002,
    title: "Паста з тунцем",
    time: 15,
    price: 69,
    emoji: "🍝",
    tag: "15 хвилин",
    ingredients: [
      { name: "Макарони", amount: "200 г" },
      { name: "Тунець", amount: "1 банка" },
      { name: "Томати консервовані", amount: "200 г" },
      { name: "Часник", amount: "1 зубчик" },
    ],
    steps: [
      "Відвари макарони у підсоленій воді.",
      "Прогрій на пательні подрібнений часник і консервовані томати.",
      "Додай тунець без рідини та готуй 3 хвилини.",
      "Змішай соус із макаронами та подавай.",
    ],
  },
  {
    id: 1003,
    title: "Сочевичне карі",
    time: 25,
    price: 54,
    emoji: "🍛",
    tag: "Ситно без м’яса",
    ingredients: [
      { name: "Сочевиця", amount: "200 г" },
      { name: "Томати консервовані", amount: "250 г" },
      { name: "Цибуля", amount: "1 шт" },
      { name: "Морква", amount: "1 шт" },
    ],
    steps: [
      "Промий сочевицю та постав варитися у двох частинах води.",
      "Обсмаж нарізані цибулю й моркву 5 хвилин.",
      "Додай томати, карі або улюблені спеції та тушкуй 5 хвилин.",
      "Змішай із сочевицею й готуй до м’якості ще 8–10 хвилин.",
    ],
  },
  {
    id: 1004,
    title: "Вівсянка з бананом",
    time: 8,
    price: 31,
    emoji: "🥣",
    tag: "Найшвидший сніданок",
    ingredients: [
      { name: "Вівсянка", amount: "80 г" },
      { name: "Молоко", amount: "250 мл" },
      { name: "Банани", amount: "1 шт" },
    ],
    steps: [
      "Залий вівсянку молоком і вари 5–6 хвилин, помішуючи.",
      "Розімни половину банана та додай у кашу.",
      "Наріж решту банана зверху й подавай.",
    ],
  },
  {
    id: 1005,
    title: "Шакшука",
    time: 20,
    price: 49,
    emoji: "🍳",
    tag: "Одна пательня",
    ingredients: [
      { name: "Яйця", amount: "4 шт" },
      { name: "Томати консервовані", amount: "300 г" },
      { name: "Перець солодкий", amount: "1 шт" },
      { name: "Цибуля", amount: "1 шт" },
    ],
    steps: [
      "Обсмаж нарізані цибулю та перець 5 хвилин.",
      "Додай томати, сіль і спеції та тушкуй 7 хвилин.",
      "Зроби заглиблення, вбий яйця й накрий кришкою.",
      "Готуй 5–6 хвилин, щоб білок схопився.",
    ],
  },
  {
    id: 1006,
    title: "Кускус з нутом",
    time: 12,
    price: 52,
    emoji: "🥗",
    tag: "Без варіння",
    ingredients: [
      { name: "Кускус", amount: "180 г" },
      { name: "Нут", amount: "1 банка" },
      { name: "Огірки", amount: "1 шт" },
      { name: "Помідори", amount: "2 шт" },
      { name: "Лимон", amount: "пів шт" },
    ],
    steps: [
      "Залий кускус окропом, накрий і залиш на 7 хвилин.",
      "Промий нут, наріж огірок і помідори.",
      "Розпуши кускус виделкою та змішай з овочами й нутом.",
      "Заправ лимонним соком, олією та сіллю.",
    ],
  },
  {
    id: 1007,
    title: "Крем-суп з гарбуза",
    time: 35,
    price: 47,
    emoji: "🎃",
    tag: "На два обіди",
    ingredients: [
      { name: "Гарбуз", amount: "700 г" },
      { name: "Картопля", amount: "250 г" },
      { name: "Морква", amount: "1 шт" },
      { name: "Вершки", amount: "100 мл" },
    ],
    steps: [
      "Наріж гарбуз, картоплю та моркву кубиками.",
      "Залий овочі водою до рівня продуктів і вари 25 хвилин.",
      "Збий суп блендером до однорідності.",
      "Додай вершки, сіль і прогрій ще 2 хвилини.",
    ],
  },
  {
    id: 1008,
    title: "Салат з тунцем і квасолею",
    time: 10,
    price: 62,
    emoji: "🥗",
    tag: "Без плити",
    ingredients: [
      { name: "Тунець", amount: "1 банка" },
      { name: "Квасоля", amount: "1 банка" },
      { name: "Кукурудза", amount: "пів банки" },
      { name: "Огірки", amount: "1 шт" },
    ],
    steps: [
      "Злий рідину з тунця, квасолі та кукурудзи.",
      "Наріж огірок невеликими кубиками.",
      "Змішай усе, додай сіль, перець і трохи олії.",
    ],
  },
  {
    id: 1009,
    title: "Лаваш з куркою й овочами",
    time: 20,
    price: 76,
    emoji: "🌯",
    tag: "Зручно із собою",
    ingredients: [
      { name: "Лаваш", amount: "2 шт" },
      { name: "Куряче філе", amount: "250 г" },
      { name: "Капуста", amount: "150 г" },
      { name: "Огірки", amount: "1 шт" },
      { name: "Йогурт", amount: "100 г" },
    ],
    steps: [
      "Наріж курку смужками й обсмаж 8–10 хвилин.",
      "Тонко нашаткуй капусту та наріж огірок.",
      "Змасти лаваш йогуртом, виклади начинку й загорни.",
      "Підрум’янь лаваш по 2 хвилини з кожного боку.",
    ],
  },
  {
    id: 1010,
    title: "Сирники",
    time: 25,
    price: 58,
    emoji: "🥞",
    tag: "Домашній сніданок",
    ingredients: [
      { name: "Кисломолочний сир", amount: "350 г" },
      { name: "Яйця", amount: "1 шт" },
      { name: "Борошно", amount: "70 г" },
      { name: "Сметана", amount: "80 г" },
    ],
    steps: [
      "Змішай сир, яйце, дрібку солі та половину борошна.",
      "Сформуй сирники й обкачай у решті борошна.",
      "Обсмаж на малому вогні по 4–5 хвилин з кожного боку.",
      "Подай зі сметаною.",
    ],
  },
  {
    id: 1011,
    title: "Запечена риба з броколі",
    time: 30,
    price: 98,
    emoji: "🐟",
    tag: "Легка вечеря",
    ingredients: [
      { name: "Риба біла", amount: "400 г" },
      { name: "Броколі", amount: "300 г" },
      { name: "Лимон", amount: "пів шт" },
      { name: "Йогурт", amount: "100 г" },
    ],
    steps: [
      "Розігрій духовку до 200 градусів.",
      "Посоли рибу, скропи лимоном і виклади у форму.",
      "Поруч розклади броколі та запікай 20–25 хвилин.",
      "Подай з йогуртовим соусом.",
    ],
  },
  {
    id: 1012,
    title: "Паста з грибами у вершках",
    time: 20,
    price: 63,
    emoji: "🍄",
    tag: "Комфортна вечеря",
    ingredients: [
      { name: "Макарони", amount: "200 г" },
      { name: "Печериці", amount: "250 г" },
      { name: "Вершки", amount: "150 мл" },
      { name: "Цибуля", amount: "1 шт" },
    ],
    steps: [
      "Відвари макарони до стану аль денте.",
      "Обсмаж цибулю та нарізані гриби 7–8 хвилин.",
      "Додай вершки, сіль і прогрій 3 хвилини.",
      "Змішай соус із макаронами.",
    ],
  },
];

defaultState.productCatalog = starterProductCatalog;
defaultState.recipeCatalog = starterRecipeCatalog;

let state = structuredClone(defaultState);
let toastTimer;
let saveTimer;
let cloudSaveTimer;
let currentUser = null;
let accessProfile = null;
let cloudStateExists = false;
let authFormMode = "sign-in";
let isBootstrapping = false;

const app = document.querySelector("#app");
const modalBackdrop = document.querySelector("#modalBackdrop");
const modalSheet = document.querySelector("#modalSheet");
const toast = document.querySelector("#toast");
const shoppingBadge = document.querySelector("#shoppingBadge");
const availableViews = ["home", "menu", "shopping", "pantry"];

function loadLegacyState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return saved || null;
  } catch {
    return null;
  }
}

function saveState() {
  clearTimeout(saveTimer);
  const snapshot = structuredClone(state);
  const localKey = currentUser ? `${LOCAL_DB_STATE_KEY}:${currentUser.id}` : LOCAL_DB_STATE_KEY;

  saveTimer = setTimeout(async () => {
    try {
      await writeState(snapshot, localKey);
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
    }
  }, 80);

  if (currentUser && accessProfile?.status === "active") {
    scheduleCloudSave(snapshot);
  }
}

function scheduleCloudSave(snapshot) {
  clearTimeout(cloudSaveTimer);
  cloudSaveTimer = setTimeout(() => persistCloudState(snapshot), 650);
}

async function persistCloudState(snapshot) {
  if (!neonClient || !currentUser || accessProfile?.status !== "active") return;

  const payload = {
    owner_id: currentUser.id,
    state: snapshot,
    updated_at: new Date().toISOString(),
  };

  const result = cloudStateExists
    ? await neonClient.from("user_state").update(payload).eq("owner_id", currentUser.id)
    : await neonClient.from("user_state").insert(payload);

  if (!result.error) {
    cloudStateExists = true;
    updateSyncIndicator("synced");
  } else {
    updateSyncIndicator("offline");
  }
}

function hydrateState(saved) {
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
  return hydrated;
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

function normalizeMeal(meal) {
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

function getSessionUser(sessionResult) {
  return sessionResult?.data?.user || sessionResult?.data?.session?.user || null;
}

async function getAccessProfile(user) {
  const existing = await neonClient
    .from("app_users")
    .select("user_id,role,status,created_at")
    .eq("user_id", user.id)
    .limit(1);

  if (existing.error) throw existing.error;
  if (existing.data?.[0]) return existing.data[0];

  const created = await neonClient
    .from("app_users")
    .insert({
      user_id: user.id,
      role: "user",
      status: "pending",
    })
    .select("user_id,role,status,created_at");

  if (created.error) throw created.error;
  return created.data?.[0] || null;
}

async function loadCloudState(userId) {
  const result = await neonClient
    .from("user_state")
    .select("state,updated_at")
    .eq("owner_id", userId)
    .limit(1);

  if (result.error) throw result.error;
  cloudStateExists = Boolean(result.data?.[0]);
  return result.data?.[0]?.state || null;
}

function renderAuthScreen(message = "") {
  document.body.classList.add("auth-mode");
  authFormMode = authFormMode === "sign-up" ? "sign-up" : "sign-in";
  const signingUp = authFormMode === "sign-up";

  app.innerHTML = `
    <section class="auth-screen">
      <div class="auth-brand">
        <span class="brand-mark" aria-hidden="true">
          <svg viewBox="0 0 32 32">
            <path d="M9 9.5C9 5.9 12 3 15.7 3h.6C20 3 23 5.9 23 9.5v1.1H9V9.5Z" />
            <path d="M7 11h18l-1.7 15.2A2 2 0 0 1 21.3 28H10.7a2 2 0 0 1-2-1.8L7 11Z" />
            <path d="M12 15.5v7M16 15.5v7M20 15.5v7" />
          </svg>
        </span>
        <span>Крихта</span>
      </div>
      <div class="auth-card">
        <p class="eyebrow">${signingUp ? "Новий користувач" : "З поверненням"}</p>
        <h1>${signingUp ? "Створити акаунт" : "Увійти в апку"}</h1>
        <p class="auth-description">
          ${signingUp ? "Після реєстрації адміністратор має дозволити доступ." : "Твоє меню та запаси синхронізуються між пристроями."}
        </p>
        ${message ? `<div class="auth-message">${escapeHtml(message)}</div>` : ""}
        <form id="authForm">
          ${
            signingUp
              ? `
                <label class="field">
                  <span>Ім’я</span>
                  <input name="name" type="text" autocomplete="name" placeholder="Дмитро" required autofocus />
                </label>
              `
              : ""
          }
          <label class="field">
            <span>Email</span>
            <input name="email" type="email" autocomplete="email" placeholder="you@example.com" required ${signingUp ? "" : "autofocus"} />
          </label>
          <label class="field">
            <span>Пароль</span>
            <input
              name="password"
              type="password"
              minlength="8"
              autocomplete="${signingUp ? "new-password" : "current-password"}"
              placeholder="Щонайменше 8 символів"
              required
            />
          </label>
          <button class="primary-button auth-submit" type="submit">
            ${signingUp ? "Зареєструватися" : "Увійти"}
          </button>
        </form>
        <button class="auth-switch" type="button" data-switch-auth>
          ${signingUp ? "Уже є акаунт? Увійти" : "Немає акаунта? Зареєструватися"}
        </button>
      </div>
    </section>
  `;

  app.querySelector("[data-switch-auth]").addEventListener("click", () => {
    authFormMode = signingUp ? "sign-in" : "sign-up";
    renderAuthScreen();
  });
  app.querySelector("#authForm").addEventListener("submit", handleAuthSubmit);
}

async function handleAuthSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const submitButton = form.querySelector("button[type='submit']");
  const formData = new FormData(form);
  const email = formData.get("email").trim();
  const password = formData.get("password");

  submitButton.disabled = true;
  submitButton.textContent = "Зачекай…";

  try {
    const result =
      authFormMode === "sign-up"
        ? await neonClient.auth.signUp.email({
            name: formData.get("name").trim(),
            email,
            password,
          })
        : await neonClient.auth.signIn.email({
            email,
            password,
            rememberMe: true,
          });

    if (result.error) {
      renderAuthScreen(result.error.message || "Не вдалося виконати вхід");
      return;
    }

    const sessionResult = await neonClient.auth.getSession();
    const user = getSessionUser(sessionResult);
    if (!user) {
      authFormMode = "sign-in";
      renderAuthScreen("Перевір email і підтвердь реєстрацію, а потім увійди.");
      return;
    }

    await bootstrap();
  } catch (error) {
    renderAuthScreen(error?.message || "Не вдалося з’єднатися з Neon");
  }
}

function renderConfigurationScreen() {
  document.body.classList.add("auth-mode");
  app.innerHTML = `
    <section class="auth-screen">
      <div class="auth-brand">
        <span class="brand-mark" aria-hidden="true">⚙</span>
        <span>Крихта</span>
      </div>
      <div class="auth-card">
        <p class="eyebrow">Потрібне налаштування</p>
        <h1>Neon ще не підключено</h1>
        <p class="auth-description">Додай дві змінні середовища з Neon Console:</p>
        <pre class="config-code">VITE_NEON_AUTH_URL
VITE_NEON_DATA_API_URL</pre>
        <p class="auth-description">Для локальної демонстрації можна відкрити адресу з параметром <code>?local=1</code>.</p>
      </div>
    </section>
  `;
}

function renderAccessScreen(profile, errorMessage = "") {
  document.body.classList.add("auth-mode");
  const blocked = profile?.status === "blocked";
  app.innerHTML = `
    <section class="auth-screen">
      <div class="auth-brand">
        <span class="brand-mark" aria-hidden="true">🔐</span>
        <span>Крихта</span>
      </div>
      <div class="auth-card access-card">
        <span class="access-emoji">${blocked ? "⛔" : "⏳"}</span>
        <p class="eyebrow">${blocked ? "Доступ закрито" : "Очікує підтвердження"}</p>
        <h1>${blocked ? "Акаунт заблоковано" : "Заявку надіслано"}</h1>
        <p class="auth-description">
          ${
            blocked
              ? "Звернися до адміністратора, якщо доступ потрібно відновити."
              : "Адміністратор має дозволити цей акаунт. Після цього натисни «Перевірити доступ»."
          }
        </p>
        ${errorMessage ? `<div class="auth-message">${escapeHtml(errorMessage)}</div>` : ""}
        <div class="access-actions">
          <button class="primary-button" type="button" data-refresh-access>Перевірити доступ</button>
          <button class="secondary-button" type="button" data-auth-signout>Вийти</button>
        </div>
      </div>
    </section>
  `;

  app.querySelector("[data-refresh-access]").addEventListener("click", () => bootstrap());
  app.querySelector("[data-auth-signout]").addEventListener("click", signOut);
}

async function signOut() {
  clearTimeout(cloudSaveTimer);
  await neonClient?.auth.signOut();
  currentUser = null;
  accessProfile = null;
  cloudStateExists = false;
  authFormMode = "sign-in";
  renderAuthScreen();
}

function updateSyncIndicator(status) {
  const indicator = document.querySelector("#syncIndicator");
  if (!indicator) return;
  indicator.classList.toggle("offline", status === "offline");
  indicator.querySelector("span:last-child").textContent =
    status === "offline" ? "Офлайн — зміни лишилися на телефоні" : "Синхронізовано з Neon";
}

function formatMoney(value) {
  return `${Math.round(value)} ₴`;
}

function remainingItems() {
  return state.shopping.filter((item) => !item.checked);
}

function shoppingTotal() {
  return state.shopping.reduce((sum, item) => sum + item.price, 0);
}

function checkedTotal() {
  return state.shopping.filter((item) => item.checked).reduce((sum, item) => sum + item.price, 0);
}

function getSortedSuggestions() {
  return state.meals.slice(1).map((meal) => ({
    ...meal,
    available: meal.ingredients.filter((ingredient) => !ingredient.missing).length,
    total: meal.ingredients.length,
  })).sort((a, b) => {
    if (state.priority === "price") return a.price - b.price || a.time - b.time;
    if (state.priority === "time") return a.time - b.time || a.price - b.price;
    return a.price + a.time * 1.8 - (b.price + b.time * 1.8);
  }).slice(0, 3);
}

function render() {
  document.body.classList.remove("auth-mode");
  const renderers = {
    home: renderHome,
    menu: renderMenu,
    shopping: renderShopping,
    pantry: renderPantry,
  };

  app.innerHTML = renderers[state.activeView]();
  document.querySelectorAll(".nav-item").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === state.activeView);
  });
  shoppingBadge.textContent = remainingItems().length;
  shoppingBadge.hidden = remainingItems().length === 0;
  bindViewEvents();
  saveState();
}

function renderPriorityToggle() {
  const priorities = [
    ["time", "⚡ Швидше"],
    ["price", "₴ Дешевше"],
    ["balance", "◎ Баланс"],
  ];

  return `
    <div class="priority-toggle" aria-label="Пріоритет рекомендацій">
      ${priorities
        .map(
          ([value, label]) => `
            <button
              class="priority-option ${state.priority === value ? "active" : ""}"
              type="button"
              data-priority="${value}"
            >${label}</button>
          `,
        )
        .join("")}
    </div>
  `;
}

function renderHome() {
  if (!state.meals.length) {
    return `
      <section class="screen">
        <p class="eyebrow">План на сьогодні</p>
        <h1 class="screen-title">Час додати перший рецепт.</h1>
        <div class="empty-state">
          <span class="empty-state-emoji">🍽️</span>
          <h3>Меню поки порожнє</h3>
          <p>Створи рецепт з інгредієнтами та покроковим приготуванням.</p>
          <button class="compact-button primary" type="button" data-add-recipe>${icon("plus")} Додати рецепт</button>
        </div>
      </section>
    `;
  }

  const meal = state.meals[0];
  const missing = meal.ingredients.filter((item) => item.missing);
  const currentTotal = shoppingTotal();
  const budgetPercent = Math.min(100, (currentTotal / state.budget) * 100);
  const sortedSuggestions = getSortedSuggestions();
  const suggestionsMarkup = sortedSuggestions
    .map(
      (item) => `
        <article class="suggestion-card">
          <div class="suggestion-emoji" aria-hidden="true">${item.emoji}</div>
          <div>
            <h3>${item.title}</h3>
            <p>
              <span>${item.time} хв</span>
              <span>${formatMoney(item.price)}</span>
              <span class="suggestion-score">${item.available}/${item.total} є вдома</span>
            </p>
          </div>
          <button class="card-arrow" type="button" data-open-meal="${item.id}" aria-label="Переглянути ${item.title}">
            ${icon("arrow")}
          </button>
        </article>
      `,
    )
    .join("");

  return `
    <section class="screen">
      <p class="eyebrow">План на сьогодні</p>
      <h1 class="screen-title">Смачно, швидко<br />і без зайвих витрат.</h1>
      ${renderPriorityToggle()}

      <article class="summary-card">
        <div>
          <span class="summary-label">Кошик на тиждень</span>
          <span class="summary-value">${formatMoney(currentTotal)} <small>/ ${state.budget} ₴</small></span>
          <div class="progress-track">
            <div class="progress-fill" style="width: ${budgetPercent}%"></div>
          </div>
          <p class="summary-meta">${state.budget - currentTotal >= 0 ? `Ще ${formatMoney(state.budget - currentTotal)} у бюджеті` : `Перевищення на ${formatMoney(currentTotal - state.budget)}`}</p>
        </div>
        <div class="summary-stats">
          <div class="mini-stat">
            <strong>${state.meals.length}</strong>
            <span>вечерь у плані</span>
          </div>
          <div class="mini-stat">
            <strong>${Math.round(state.meals.reduce((sum, item) => sum + item.time, 0) / state.meals.length)} хв</strong>
            <span>у середньому</span>
          </div>
        </div>
      </article>

      <section class="section">
        <div class="section-header">
          <h2 class="section-title">Готуємо сьогодні</h2>
          <button class="text-button" type="button" data-view-link="menu">Весь план</button>
        </div>
        <article class="meal-hero">
          <div class="meal-art" aria-hidden="true">${meal.emoji}</div>
          <div class="meal-hero-content">
            <span class="tag">✦ ${meal.tag}</span>
            <div>
              <h3 class="meal-hero-title">${meal.title}</h3>
              <div class="meal-meta">
                <span class="meta-chip">${icon("clock")}${meal.time} хв</span>
                <span class="meta-chip">${icon("wallet")}${formatMoney(meal.price)}</span>
              </div>
            </div>
            <div class="meal-actions">
              <button class="primary-button" type="button" data-open-meal="${meal.id}">
                ${icon("chef")} Готувати
              </button>
              <button class="secondary-button swap-button" type="button" data-swap-today aria-label="Замінити страву">
                ${icon("swap")}
              </button>
            </div>
          </div>
        </article>
        ${
          missing.length
            ? `
              <div class="missing-strip">
                <div class="missing-icon" aria-hidden="true">🛒</div>
                <div class="missing-copy">
                  <strong>Не вистачає ${missing.length} ${pluralize(missing.length, "продукту", "продуктів", "продуктів")}</strong>
                  <span>${missing.map((item) => item.name).join(", ")}</span>
                </div>
                <button class="round-add" type="button" data-add-missing="${meal.id}" aria-label="Додати відсутні продукти">+</button>
              </div>
            `
            : ""
        }
      </section>

      ${
        sortedSuggestions.length
          ? `
            <section class="section">
              <div class="section-header">
                <h2 class="section-title">Можна ще дешевше</h2>
                <span class="date-label">під твій пріоритет</span>
              </div>
              <div class="suggestion-list">${suggestionsMarkup}</div>
            </section>
          `
          : ""
      }
    </section>
  `;
}

function renderMenu() {
  const dates = state.meals
    .map(
      (meal, index) => `
        <button class="day-button ${state.selectedDay === index ? "active" : ""}" type="button" data-day-index="${index}">
          <span>${meal.shortDay}</span>
          <strong>${meal.date}</strong>
        </button>
      `,
    )
    .join("");

  const weeklyPrice = state.meals.reduce((sum, meal) => sum + meal.price, 0);
  const mealCards = state.meals
    .map(
      (meal, index) => `
        <article class="menu-day-card" data-menu-day="${index}" ${index !== state.selectedDay ? 'style="display:none"' : ""}>
          <div class="menu-day-top">
            <p class="menu-day-label">${meal.day}</p>
            <span class="menu-price">${formatMoney(meal.price)}</span>
          </div>
          <div class="menu-meal-row">
            <div class="menu-meal-emoji" aria-hidden="true">${meal.emoji}</div>
            <div>
              <h3>${meal.title}</h3>
              <p>${meal.time} хв · ${meal.ingredients.filter((item) => item.missing).length ? `${meal.ingredients.filter((item) => item.missing).length} треба купити` : "усе є вдома"}</p>
            </div>
            <div class="menu-actions">
              <button class="tiny-icon-button" type="button" data-open-meal="${meal.id}" aria-label="Переглянути рецепт">
                ${icon("arrow")}
              </button>
              <button class="tiny-icon-button" type="button" data-edit-recipe="${meal.id}" aria-label="Редагувати рецепт">
                ${icon("edit")}
              </button>
              <button class="tiny-icon-button danger" type="button" data-delete-recipe="${meal.id}" aria-label="Видалити рецепт">
                ${icon("trash")}
              </button>
            </div>
          </div>
        </article>
      `,
    )
    .join("");
  const catalogCards = state.recipeCatalog
    .map(
      (recipe) => `
        <article class="catalog-recipe-card">
          <div class="catalog-recipe-emoji" aria-hidden="true">${recipe.emoji}</div>
          <div class="catalog-recipe-copy">
            <span class="catalog-tag">${escapeHtml(recipe.tag)}</span>
            <h3>${escapeHtml(recipe.title)}</h3>
            <p>${recipe.time} хв · ${formatMoney(recipe.price)} · ${recipe.ingredients.length} інгредієнтів</p>
          </div>
          <div class="catalog-recipe-actions">
            <button class="tiny-icon-button" type="button" data-open-recipe="${recipe.id}" aria-label="Переглянути ${escapeHtml(recipe.title)}">
              ${icon("arrow")}
            </button>
            <button class="tiny-icon-button catalog-add-button" type="button" data-use-recipe="${recipe.id}" aria-label="Додати ${escapeHtml(recipe.title)} у меню">
              ${icon("plus")}
            </button>
          </div>
        </article>
      `,
    )
    .join("");

  return `
    <section class="screen">
      <div class="screen-heading-row">
        <div>
          <p class="eyebrow">${getWeekRangeLabel(Math.max(state.meals.length, 7))}</p>
          <h1 class="screen-title">Меню тижня</h1>
        </div>
        <span class="date-label">${formatMoney(weeklyPrice)} · ${state.meals.reduce((sum, meal) => sum + meal.time, 0)} хв</span>
      </div>
      <div class="recipe-toolbar">
        <div class="database-note" id="syncIndicator">
          <span class="database-dot"></span>
          <span>${currentUser ? "Синхронізовано з Neon" : "Локальний режим"}</span>
        </div>
        <button class="compact-button primary" type="button" data-add-recipe>${icon("plus")} Рецепт</button>
      </div>
      ${renderPriorityToggle()}
      <div class="optimization-card">
        <span class="optimization-icon">${icon("spark")}</span>
        <div>
          <strong>План уже оптимізовано</strong>
          <p>Продукти повторюються у стравах, тому менше залишків і зайвих покупок.</p>
        </div>
      </div>
      ${
        state.meals.length
          ? `
            <div class="week-strip">${dates}</div>
            <div>${mealCards}</div>
            <button class="primary-button" type="button" data-generate-list style="width:100%; margin-top: 8px;">
              ${icon("cart")} Оновити список покупок
            </button>
          `
          : `
            <div class="empty-state">
              <span class="empty-state-emoji">📖</span>
              <h3>Додай свій перший рецепт</h3>
              <p>Вкажи ціну, час, інгредієнти та кроки. Усе залишиться в базі на телефоні.</p>
              <button class="compact-button primary" type="button" data-add-recipe>${icon("plus")} Створити рецепт</button>
            </div>
          `
      }
      <section class="section recipe-catalog-section">
        <div class="section-header">
          <div>
            <p class="eyebrow">База страв</p>
            <h2 class="section-title">Каталог рецептів</h2>
          </div>
          <span class="date-label">${state.recipeCatalog.length} рецептів</span>
        </div>
        <div class="catalog-recipe-list">${catalogCards}</div>
      </section>
    </section>
  `;
}

function renderShopping() {
  const grouped = state.shopping.reduce((groups, item) => {
    groups[item.category] ||= [];
    groups[item.category].push(item);
    return groups;
  }, {});

  const completed = state.shopping.filter((item) => item.checked).length;
  const percent = state.shopping.length ? Math.round((completed / state.shopping.length) * 100) : 0;
  const groupsMarkup = Object.entries(grouped)
    .map(
      ([category, items]) => `
        <section class="shopping-group">
          <h2 class="shopping-group-title">${category}<span>${formatMoney(items.reduce((sum, item) => sum + item.price, 0))}</span></h2>
          <div class="shopping-list">
            ${items
              .map(
                (item) => `
                  <label class="shopping-item ${item.checked ? "checked" : ""}">
                    <input class="custom-checkbox" type="checkbox" data-shopping-id="${item.id}" ${item.checked ? "checked" : ""} />
                    <span class="shopping-item-copy">
                      <strong>
                        ${escapeHtml(item.name)}
                        ${item.urgent && !item.checked ? '<span class="urgent-label">для вечері</span>' : ""}
                      </strong>
                      <span>${escapeHtml(item.amount)}</span>
                    </span>
                    <span class="item-price">${formatMoney(item.price)}</span>
                  </label>
                `,
              )
              .join("")}
          </div>
        </section>
      `,
    )
    .join("");

  return `
    <section class="screen">
      <div class="screen-heading-row">
        <div>
          <p class="eyebrow">Розумний кошик</p>
          <h1 class="screen-title">Список покупок</h1>
        </div>
        <span class="date-label">${formatMoney(shoppingTotal())}</span>
      </div>

      <article class="shopping-summary">
        <div class="progress-ring" style="--progress: ${percent * 3.6}deg">
          <strong>${percent}%</strong>
        </div>
        <div class="shopping-summary-copy">
          <strong>${completed} з ${state.shopping.length} уже в кошику</strong>
          <span>Куплено на ${formatMoney(checkedTotal())}</span>
        </div>
        <button class="remind-button" type="button" data-remind aria-label="Нагадати про покупки">
          ${icon("bell")}
        </button>
      </article>

      <div class="shopping-toolbar">
        <button class="compact-button primary add-item-button" type="button" data-add-item>
          ${icon("plus")} Додати продукт
        </button>
        <button class="compact-button" type="button" data-clear-checked>Прибрати куплене</button>
      </div>

      ${
        state.shopping.length
          ? groupsMarkup
          : `
            <div class="empty-state">
              <span class="empty-state-emoji">🧺</span>
              <h3>Список порожній</h3>
              <p>Додай продукт вручну або сформуй список із меню.</p>
              <button class="compact-button primary" type="button" data-generate-list>Зібрати з меню</button>
            </div>
          `
      }
    </section>
  `;
}

function renderPantry() {
  return `
    <section class="screen">
      <div class="screen-heading-row">
        <div>
          <p class="eyebrow">Що є вдома</p>
          <h1 class="screen-title">Мої запаси</h1>
        </div>
        <span class="date-label">${state.pantry.length} продуктів</span>
      </div>
      <label class="pantry-search">
        ${icon("search")}
        <input id="pantrySearch" type="search" placeholder="Знайти продукт" autocomplete="off" />
      </label>
      <div class="optimization-card">
        <span class="optimization-icon">${icon("spark")}</span>
        <div>
          <strong>${state.pantry.filter((item) => item.low).length} продукти закінчуються</strong>
          <p>Я врахую це у наступному списку й спершу використаю те, що вже є.</p>
        </div>
      </div>
      <button class="catalog-open-button" type="button" data-open-product-catalog>
        <span class="catalog-open-icon">🧺</span>
        <span>
          <strong>Каталог продуктів</strong>
          <small>${state.productCatalog.length} базових продуктів для швидкого додавання</small>
        </span>
        ${icon("arrow")}
      </button>
      <div class="pantry-grid" id="pantryGrid">
        ${state.pantry.map(renderPantryCard).join("")}
        <button class="pantry-add" type="button" data-add-pantry>
          <span>+</span>
          <span>Додати запас</span>
        </button>
      </div>
    </section>
  `;
}

function renderPantryCard(item) {
  return `
    <button
      class="pantry-card ${item.low ? "low" : ""}"
      type="button"
      data-pantry-name="${escapeHtml(item.name.toLowerCase())}"
      data-edit-pantry="${item.id}"
      aria-label="Редагувати ${escapeHtml(item.name)}"
    >
      <span class="stock-status ${item.low ? "low" : ""}" title="${item.low ? "Закінчується" : "Є в запасі"}"></span>
      <div class="pantry-emoji" aria-hidden="true">${item.emoji}</div>
      <h3>${escapeHtml(item.name)}</h3>
      <p>${escapeHtml(item.amount)} · ${item.low ? "закінчується" : "є в запасі"}</p>
      <span class="pantry-edit-hint">${icon("edit")}</span>
    </button>
  `;
}

function bindViewEvents() {
  document.querySelectorAll("[data-priority]").forEach((button) => {
    button.addEventListener("click", () => {
      state.priority = button.dataset.priority;
      render();
      showToast(`Пріоритет: ${button.textContent.trim()}`);
    });
  });

  document.querySelectorAll("[data-view-link]").forEach((button) => {
    button.addEventListener("click", () => switchView(button.dataset.viewLink));
  });

  document.querySelectorAll("[data-open-meal]").forEach((button) => {
    button.addEventListener("click", () => openMeal(Number(button.dataset.openMeal)));
  });
  document.querySelectorAll("[data-open-recipe]").forEach((button) => {
    button.addEventListener("click", () => openMeal(Number(button.dataset.openRecipe)));
  });
  document.querySelectorAll("[data-use-recipe]").forEach((button) => {
    button.addEventListener("click", () => openUseRecipeModal(Number(button.dataset.useRecipe)));
  });

  document.querySelectorAll("[data-add-missing]").forEach((button) => {
    button.addEventListener("click", () => addMissingIngredients(Number(button.dataset.addMissing)));
  });

  document.querySelectorAll("[data-day-index]").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedDay = Number(button.dataset.dayIndex);
      render();
    });
  });

  document.querySelectorAll("[data-swap-meal]").forEach((button) => {
    button.addEventListener("click", () => swapMeal(Number(button.dataset.swapMeal)));
  });

  document.querySelector("[data-swap-today]")?.addEventListener("click", () => swapMeal(state.meals[0].id));
  document.querySelectorAll("[data-add-recipe]").forEach((button) => {
    button.addEventListener("click", () => openRecipeForm());
  });
  document.querySelectorAll("[data-edit-recipe]").forEach((button) => {
    button.addEventListener("click", () => openRecipeForm(Number(button.dataset.editRecipe)));
  });
  document.querySelectorAll("[data-delete-recipe]").forEach((button) => {
    button.addEventListener("click", () => openDeleteRecipeModal(Number(button.dataset.deleteRecipe)));
  });

  document.querySelectorAll("[data-shopping-id]").forEach((checkbox) => {
    checkbox.addEventListener("change", () => toggleShoppingItem(Number(checkbox.dataset.shoppingId), checkbox.checked));
  });

  document.querySelector("[data-add-item]")?.addEventListener("click", () => openAddItemModal("shopping"));
  document.querySelector("[data-add-pantry]")?.addEventListener("click", () => openAddItemModal("pantry"));
  document.querySelector("[data-open-product-catalog]")?.addEventListener("click", openProductCatalog);
  document.querySelectorAll("[data-edit-pantry]").forEach((button) => {
    button.addEventListener("click", () => openPantryItemModal(Number(button.dataset.editPantry)));
  });
  document.querySelector("[data-clear-checked]")?.addEventListener("click", clearCheckedItems);
  document.querySelector("[data-generate-list]")?.addEventListener("click", generateShoppingList);
  document.querySelector("[data-remind]")?.addEventListener("click", requestShoppingNotification);

  document.querySelector("#pantrySearch")?.addEventListener("input", (event) => {
    const query = event.target.value.trim().toLowerCase();
    document.querySelectorAll("[data-pantry-name]").forEach((card) => {
      card.hidden = !card.dataset.pantryName.includes(query);
    });
  });
}

function switchView(view) {
  state.activeView = view;
  window.history.replaceState(null, "", `#${view}`);
  window.scrollTo({ top: 0, behavior: "smooth" });
  render();
  setTimeout(() => app.focus({ preventScroll: true }), 0);
}

function toggleShoppingItem(id, checked) {
  const item = state.shopping.find((entry) => entry.id === id);
  if (!item) return;

  item.checked = checked;
  if (checked && !state.pantry.some((pantryItem) => pantryItem.name.toLowerCase() === item.name.toLowerCase())) {
    state.pantry.push({
      id: Date.now(),
      name: item.name,
      amount: item.amount,
      emoji: categoryEmoji(item.category),
      low: false,
    });
  }
  syncIngredientAvailability();
  render();
  showToast(checked ? `${item.name} — куплено` : `${item.name} повернуто у список`);
  if (checked) {
    notifyAction({
      title: "Покупку відмічено 🛒",
      body: `${item.name} додано в запаси`,
      tag: `shopping-bought-${item.id}`,
      url: "#pantry",
    });
  }
}

function findRecipeById(recipeId) {
  return (
    state.meals.find((entry) => entry.id === recipeId) ||
    state.recipeCatalog.find((entry) => entry.id === recipeId) ||
    null
  );
}

function openUseRecipeModal(recipeId) {
  const recipe = state.recipeCatalog.find((entry) => entry.id === recipeId);
  if (!recipe) return;
  const selectedMeal = state.meals[state.selectedDay];

  openModal(`
    <div class="sheet-handle"></div>
    <div class="sheet-header">
      <div>
        <h2 id="modalTitle">${recipe.emoji} ${escapeHtml(recipe.title)}</h2>
        <p>${recipe.time} хв · ${formatMoney(recipe.price)}</p>
      </div>
      <button class="close-button" type="button" data-close-modal aria-label="Закрити">×</button>
    </div>
    <div class="alternative-card">
      <strong>Як додати рецепт?</strong>
      <p>${selectedMeal ? `Заміни «${escapeHtml(selectedMeal.title)}» у вибраному дні або додай новий день у кінець плану.` : "Додай рецепт як першу страву у плані."}</p>
    </div>
    <div class="catalog-choice-actions">
      ${
        selectedMeal
          ? `<button class="secondary-button" type="button" data-replace-with-recipe>${icon("swap")} Замінити день</button>`
          : ""
      }
      <button class="primary-button" type="button" data-append-recipe>${icon("plus")} Додати в кінець</button>
    </div>
  `);

  modalSheet.querySelector("[data-replace-with-recipe]")?.addEventListener("click", () => {
    const current = state.meals[state.selectedDay];
    state.meals[state.selectedDay] = normalizeMeal({
      ...structuredClone(recipe),
      id: current.id,
      day: current.day,
      shortDay: current.shortDay,
      date: current.date,
    });
    syncIngredientAvailability();
    closeModal();
    render();
    showToast(`У меню: ${recipe.title}`);
    notifyAction({
      title: "План оновлено 🍽️",
      body: `${recipe.title} поставлено у вибраний день`,
      tag: `meal-planned-${recipe.id}`,
      url: "#menu",
    });
  });

  modalSheet.querySelector("[data-append-recipe]").addEventListener("click", () => {
    state.meals.push(
      normalizeMeal({
        ...structuredClone(recipe),
        id: Date.now(),
      }),
    );
    state.selectedDay = state.meals.length - 1;
    syncMealDates();
    syncIngredientAvailability();
    closeModal();
    render();
    showToast(`${recipe.title} додано в план`);
    notifyAction({
      title: "Страву додано в план 🍽️",
      body: `${recipe.title} тепер у меню`,
      tag: `meal-appended-${recipe.id}`,
      url: "#menu",
    });
  });
}

function openProductCatalog() {
  openModal(`
    <div class="sheet-handle"></div>
    <div class="sheet-header">
      <div>
        <h2 id="modalTitle">Каталог продуктів</h2>
        <p>${state.productCatalog.length} позицій для швидкого додавання.</p>
      </div>
      <button class="close-button" type="button" data-close-modal aria-label="Закрити">×</button>
    </div>
    <label class="pantry-search catalog-search">
      ${icon("search")}
      <input id="catalogSearch" type="search" placeholder="Знайти продукт" autocomplete="off" autofocus />
    </label>
    <div class="product-catalog-list">
      ${state.productCatalog
        .map(
          (product) => `
            <article class="product-catalog-card" data-catalog-product-name="${escapeHtml(product.name.toLowerCase())}">
              <span class="product-catalog-emoji">${product.emoji}</span>
              <span class="product-catalog-copy">
                <strong>${escapeHtml(product.name)}</strong>
                <small>${escapeHtml(product.amount)} · ≈ ${formatMoney(product.price)}</small>
              </span>
              <span class="product-catalog-actions">
                <button type="button" data-catalog-to-pantry="${product.id}" aria-label="Додати ${escapeHtml(product.name)} у запаси">+</button>
                <button type="button" data-catalog-to-shopping="${product.id}" aria-label="Додати ${escapeHtml(product.name)} у покупки">${icon("cart")}</button>
              </span>
            </article>
          `,
        )
        .join("")}
    </div>
  `);

  modalSheet.querySelector("#catalogSearch").addEventListener("input", (event) => {
    const query = event.target.value.trim().toLowerCase();
    modalSheet.querySelectorAll("[data-catalog-product-name]").forEach((card) => {
      card.hidden = !card.dataset.catalogProductName.includes(query);
    });
  });
  modalSheet.querySelectorAll("[data-catalog-to-pantry]").forEach((button) => {
    button.addEventListener("click", () => addCatalogProduct(Number(button.dataset.catalogToPantry), "pantry"));
  });
  modalSheet.querySelectorAll("[data-catalog-to-shopping]").forEach((button) => {
    button.addEventListener("click", () => addCatalogProduct(Number(button.dataset.catalogToShopping), "shopping"));
  });
}

function addCatalogProduct(productId, target) {
  const product = state.productCatalog.find((entry) => entry.id === productId);
  if (!product) return;

  if (target === "pantry") {
    const exists = state.pantry.some(
      (item) => normalizeIngredientName(item.name) === normalizeIngredientName(product.name),
    );
    if (!exists) {
      state.pantry.push({
        id: Date.now(),
        name: product.name,
        amount: product.amount,
        emoji: product.emoji,
        low: false,
      });
      syncIngredientAvailability();
    }
    showToast(exists ? `${product.name} уже є в запасах` : `${product.name} додано в запаси`);
  } else {
    const exists = state.shopping.some(
      (item) =>
        normalizeIngredientName(item.name) === normalizeIngredientName(product.name) &&
        !item.checked,
    );
    if (!exists) {
      state.shopping.push({
        id: Date.now(),
        name: product.name,
        amount: product.amount,
        price: product.price,
        category: product.category,
        checked: false,
        urgent: false,
      });
    }
    showToast(exists ? `${product.name} уже є у покупках` : `${product.name} додано у покупки`);
  }

  saveState();
}

function openPantryItemModal(itemId) {
  const item = state.pantry.find((entry) => entry.id === itemId);
  if (!item) return;

  openModal(`
    <div class="sheet-handle"></div>
    <div class="sheet-header">
      <div>
        <h2 id="modalTitle">${item.emoji} ${escapeHtml(item.name)}</h2>
        <p>Онови залишок або перенеси продукт у покупки.</p>
      </div>
      <button class="close-button" type="button" data-close-modal aria-label="Закрити">×</button>
    </div>
    <form id="pantryItemForm">
      <div class="field-grid recipe-basics">
        <label class="field emoji-field">
          <span>Емодзі</span>
          <input name="emoji" type="text" maxlength="4" value="${escapeHtml(item.emoji)}" required />
        </label>
        <label class="field">
          <span>Назва</span>
          <input name="name" type="text" value="${escapeHtml(item.name)}" required autofocus />
        </label>
      </div>
      <div class="field-grid">
        <label class="field">
          <span>Залишок</span>
          <input name="amount" type="text" value="${escapeHtml(item.amount)}" placeholder="500 г" required />
        </label>
        <label class="field">
          <span>Стан</span>
          <select name="low">
            <option value="false" ${item.low ? "" : "selected"}>Є вдосталь</option>
            <option value="true" ${item.low ? "selected" : ""}>Закінчується</option>
          </select>
        </label>
      </div>
      <div class="pantry-modal-actions">
        <button class="secondary-button" type="button" data-pantry-to-shopping>
          ${icon("cart")} У покупки
        </button>
        <button class="danger-outline-button" type="button" data-delete-pantry>
          ${icon("trash")} Видалити
        </button>
      </div>
      <div class="sheet-actions">
        <button class="secondary-button" type="button" data-close-modal>Скасувати</button>
        <button class="primary-button" type="submit">${icon("save")} Зберегти</button>
      </div>
    </form>
  `);

  modalSheet.querySelector("#pantryItemForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    item.name = formData.get("name").trim();
    item.amount = formData.get("amount").trim();
    item.emoji = formData.get("emoji").trim() || "🥫";
    item.low = formData.get("low") === "true";
    syncIngredientAvailability();
    closeModal();
    render();
    showToast(`${item.name} оновлено`);
  });

  modalSheet.querySelector("[data-pantry-to-shopping]").addEventListener("click", () => {
    const form = modalSheet.querySelector("#pantryItemForm");
    const formData = new FormData(form);
    const name = formData.get("name").trim();
    const amount = formData.get("amount").trim();
    item.name = name;
    item.amount = amount;
    item.emoji = formData.get("emoji").trim() || "🥫";
    item.low = true;
    const exists = state.shopping.some(
      (shoppingItem) => shoppingItem.name.toLowerCase() === name.toLowerCase() && !shoppingItem.checked,
    );

    if (!exists) {
      state.shopping.push({
        id: Date.now(),
        name,
        amount,
        price: estimatePrice(name),
        category: inferCategory(name),
        checked: false,
        urgent: false,
      });
    }
    syncIngredientAvailability();
    closeModal();
    render();
    showToast(exists ? `${name} уже є у покупках` : `${name} додано у покупки`);
  });

  modalSheet.querySelector("[data-delete-pantry]").addEventListener("click", () => {
    openDeletePantryModal(item.id);
  });
}

function openDeletePantryModal(itemId) {
  const item = state.pantry.find((entry) => entry.id === itemId);
  if (!item) return;

  openModal(`
    <div class="sheet-handle"></div>
    <div class="sheet-header">
      <div>
        <h2 id="modalTitle">Видалити із запасів?</h2>
        <p>${item.emoji} ${escapeHtml(item.name)} · ${escapeHtml(item.amount)}</p>
      </div>
      <button class="close-button" type="button" data-close-modal aria-label="Закрити">×</button>
    </div>
    <div class="alternative-card warning-card">
      <strong>Рецепти одразу врахують зміну</strong>
      <p>Інгредієнт буде позначено як відсутній і його можна буде додати у список покупок.</p>
    </div>
    <div class="sheet-actions">
      <button class="secondary-button" type="button" data-keep-pantry>Залишити</button>
      <button class="danger-button" type="button" data-confirm-pantry-delete>${icon("trash")} Видалити</button>
    </div>
  `);

  modalSheet.querySelector("[data-keep-pantry]").addEventListener("click", () => openPantryItemModal(itemId));
  modalSheet.querySelector("[data-confirm-pantry-delete]").addEventListener("click", () => {
    state.pantry = state.pantry.filter((entry) => entry.id !== itemId);
    syncIngredientAvailability();
    closeModal();
    render();
    showToast(`${item.name} видалено із запасів`);
  });
}

function addMissingIngredients(mealId) {
  const meal = findRecipeById(mealId);
  if (!meal) return;

  let added = 0;
  meal.ingredients
    .filter((ingredient) => ingredient.missing)
    .forEach((ingredient) => {
      const exists = state.shopping.some(
        (item) => item.name.toLowerCase() === ingredient.name.toLowerCase() && !item.checked,
      );
      if (!exists) {
        state.shopping.push({
          id: Date.now() + added,
          name: ingredient.name,
          amount: ingredient.amount,
          price: estimatePrice(ingredient.name),
          category: inferCategory(ingredient.name),
          checked: false,
          urgent: meal.id === state.meals[0]?.id,
        });
        added += 1;
      }
    });

  render();
  showToast(added ? `Додано ${added} ${pluralize(added, "продукт", "продукти", "продуктів")}` : "Усе вже є у списку");
}

function swapMeal(mealId) {
  const index = state.meals.findIndex((meal) => meal.id === mealId);
  if (index < 0) return;

  const replacementPool = [
    {
      title: "Омлет із картоплею",
      time: 15,
      price: 34,
      emoji: "🍳",
      tag: "Дешевша заміна",
      ingredients: [
        { name: "Яйця", amount: "4 шт", missing: false },
        { name: "Картопля", amount: "300 г", missing: false },
        { name: "Цибуля", amount: "1 шт", missing: false },
      ],
    },
    {
      title: "Квасоля з овочами",
      time: 14,
      price: 41,
      emoji: "🫘",
      tag: "Швидка заміна",
      ingredients: [
        { name: "Квасоля", amount: "1 банка", missing: false },
        { name: "Морква", amount: "1 шт", missing: false },
        { name: "Помідори", amount: "2 шт", missing: false },
      ],
    },
    {
      title: "Гречані котлетки",
      time: 24,
      price: 37,
      emoji: "🥙",
      tag: "Майже все є",
      ingredients: [
        { name: "Гречка", amount: "200 г", missing: false },
        { name: "Яйця", amount: "2 шт", missing: false },
        { name: "Йогурт", amount: "100 г", missing: true },
      ],
    },
  ];

  const current = state.meals[index];
  const candidates = replacementPool.filter((meal) => meal.title !== current.title);
  const replacement =
    state.priority === "price"
      ? [...candidates].sort((a, b) => a.price - b.price)[0]
      : state.priority === "time"
        ? [...candidates].sort((a, b) => a.time - b.time)[0]
        : candidates[Math.floor(Math.random() * candidates.length)];

  state.meals[index] = normalizeMeal({
    ...current,
    ...structuredClone(replacement),
    steps: replacement.steps || [],
  });
  render();
  showToast(`Заміна: ${replacement.title}`);
  notifyAction({
    title: "План оновлено 🍽️",
    body: `У меню тепер ${replacement.title}`,
    tag: `meal-swapped-${state.meals[index].id}`,
    url: "#menu",
  });
}

function openRecipeForm(mealId = null) {
  const editing = mealId !== null;
  const meal = editing ? state.meals.find((entry) => entry.id === mealId) : null;
  if (editing && !meal) return;

  const ingredientsValue =
    meal?.ingredients.map((ingredient) => `${ingredient.name} | ${ingredient.amount}`).join("\n") || "";
  const stepsValue = meal?.steps.join("\n") || "";

  openModal(`
    <div class="sheet-handle"></div>
    <div class="sheet-header">
      <div>
        <h2 id="modalTitle">${editing ? "Редагувати рецепт" : "Новий рецепт"}</h2>
        <p>Дані збережуться локально на цьому телефоні.</p>
      </div>
      <button class="close-button" type="button" data-close-modal aria-label="Закрити">×</button>
    </div>
    <form id="recipeForm">
      <div class="field-grid recipe-basics">
        <label class="field emoji-field">
          <span>Емодзі</span>
          <input name="emoji" type="text" maxlength="4" value="${escapeHtml(meal?.emoji || "🍲")}" required />
        </label>
        <label class="field">
          <span>Назва</span>
          <input name="title" type="text" value="${escapeHtml(meal?.title || "")}" placeholder="Овочеве рагу" required autofocus />
        </label>
      </div>
      <div class="field-grid">
        <label class="field">
          <span>Час, хв</span>
          <input name="time" type="number" min="1" max="600" value="${meal?.time || 20}" required />
        </label>
        <label class="field">
          <span>Ціна, ₴</span>
          <input name="price" type="number" min="0" max="100000" value="${meal?.price || 50}" required />
        </label>
      </div>
      <label class="field">
        <span>Інгредієнти — один на рядок</span>
        <textarea name="ingredients" rows="5" placeholder="Картопля | 500 г&#10;Морква | 2 шт" required>${escapeHtml(ingredientsValue)}</textarea>
        <small class="form-help">Формат: назва | кількість. Апка сама перевірить, що є в запасах.</small>
      </label>
      <label class="field">
        <span>Як готувати — один крок на рядок</span>
        <textarea name="steps" rows="7" placeholder="Наріж овочі.&#10;Обсмаж цибулю 3 хвилини.&#10;Додай решту та тушкуй 15 хвилин." required>${escapeHtml(stepsValue)}</textarea>
      </label>
      <div class="sheet-actions">
        <button class="secondary-button" type="button" data-close-modal>Скасувати</button>
        <button class="primary-button" type="submit">${icon("save")} ${editing ? "Зберегти" : "Додати"}</button>
      </div>
    </form>
  `);

  modalSheet.querySelector("#recipeForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const ingredients = parseIngredients(formData.get("ingredients"));
    const steps = parseLines(formData.get("steps"));

    if (!ingredients.length || !steps.length) {
      showToast("Додай хоча б один інгредієнт і один крок");
      return;
    }

    const recipe = normalizeMeal({
      ...(meal || {}),
      id: meal?.id || Date.now(),
      title: formData.get("title").trim(),
      emoji: formData.get("emoji").trim() || "🍲",
      time: Number(formData.get("time")),
      price: Number(formData.get("price")),
      tag: meal?.tag || "Мій рецепт",
      ingredients,
      steps,
    });

    if (editing) {
      const index = state.meals.findIndex((entry) => entry.id === mealId);
      state.meals[index] = recipe;
      state.selectedDay = index;
    } else {
      state.meals.push(recipe);
      state.selectedDay = state.meals.length - 1;
    }

    syncMealDates();
    closeModal();
    state.activeView = "menu";
    render();
    showToast(editing ? "Рецепт оновлено" : "Рецепт додано до меню");
    notifyAction({
      title: editing ? "Рецепт оновлено 🍽️" : "Страву заплановано 🍽️",
      body: editing ? `${recipe.title} збережено в меню` : `${recipe.title} додано до плану`,
      tag: `recipe-${editing ? "updated" : "created"}-${recipe.id}`,
      url: "#menu",
    });
  });
}

function openDeleteRecipeModal(mealId) {
  const meal = state.meals.find((entry) => entry.id === mealId);
  if (!meal) return;

  openModal(`
    <div class="sheet-handle"></div>
    <div class="sheet-header">
      <div>
        <h2 id="modalTitle">Прибрати рецепт?</h2>
        <p>${meal.emoji} ${escapeHtml(meal.title)}</p>
      </div>
      <button class="close-button" type="button" data-close-modal aria-label="Закрити">×</button>
    </div>
    <div class="alternative-card warning-card">
      <strong>Рецепт буде видалено з бази телефона</strong>
      <p>Список уже куплених продуктів та запаси при цьому не зміняться.</p>
    </div>
    <div class="sheet-actions">
      <button class="secondary-button" type="button" data-close-modal>Залишити</button>
      <button class="danger-button" type="button" data-confirm-delete>${icon("trash")} Видалити</button>
    </div>
  `);

  modalSheet.querySelector("[data-confirm-delete]").addEventListener("click", () => {
    state.meals = state.meals.filter((entry) => entry.id !== mealId);
    state.selectedDay = Math.min(state.selectedDay, Math.max(state.meals.length - 1, 0));
    syncMealDates();
    closeModal();
    render();
    showToast(`${meal.title} видалено`);
  });
}

function openMeal(mealId) {
  const meal = findRecipeById(mealId) || state.meals[0];
  if (!meal) return;
  const missingCount = meal.ingredients.filter((item) => item.missing).length;

  openModal(`
    <div class="sheet-handle"></div>
    <div class="sheet-header">
      <div>
        <h2 id="modalTitle">${meal.emoji} ${meal.title}</h2>
        <p>${meal.time} хв · ${formatMoney(meal.price)} · ${meal.ingredients.length} інгредієнтів</p>
      </div>
      <button class="close-button" type="button" data-close-modal aria-label="Закрити">×</button>
    </div>
    <ul class="ingredient-list">
      ${meal.ingredients
        .map(
          (item) => `
            <li class="ingredient-row ${item.missing ? "missing" : ""}">
              <span class="ingredient-state">${item.missing ? "!" : "✓"}</span>
              <span>${item.name}</span>
              <small>${item.amount}</small>
            </li>
          `,
        )
        .join("")}
    </ul>
    ${
      missingCount
        ? `
          <div class="alternative-card">
            <strong>Можна не купувати все</strong>
            <p>${getAlternativeText(meal)} Так страва залишиться швидкою, а ціна буде нижчою.</p>
          </div>
        `
        : `
          <div class="alternative-card">
            <strong>Усе вже є вдома</strong>
            <p>Ця страва не додасть нічого до кошика — хороший спосіб використати запаси.</p>
          </div>
        `
    }
    <section class="recipe-steps-preview">
      <div class="section-header">
        <h3 class="section-title">Як готувати</h3>
        <span class="date-label">${meal.steps.length} ${pluralize(meal.steps.length, "крок", "кроки", "кроків")}</span>
      </div>
      <ol>
        ${meal.steps
          .slice(0, 3)
          .map((step) => `<li>${escapeHtml(step)}</li>`)
          .join("")}
      </ol>
    </section>
    <div class="sheet-actions">
      ${
        missingCount
          ? `<button class="secondary-button" type="button" data-modal-add-missing="${meal.id}">${icon("cart")} Додати ${missingCount}</button>`
          : ""
      }
      <button class="primary-button" type="button" data-start-cooking="${meal.id}">${icon("chef")} Почати готувати</button>
    </div>
  `);

  modalSheet.querySelector("[data-modal-add-missing]")?.addEventListener("click", (event) => {
    addMissingIngredients(Number(event.currentTarget.dataset.modalAddMissing));
    closeModal();
  });
  modalSheet.querySelector("[data-start-cooking]")?.addEventListener("click", () => {
    openCookingGuide(meal.id);
  });
}

function openCookingGuide(mealId, stepIndex = 0) {
  const meal = findRecipeById(mealId);
  if (!meal) return;

  const steps = meal.steps;
  const safeIndex = Math.min(Math.max(stepIndex, 0), steps.length - 1);
  const progress = ((safeIndex + 1) / steps.length) * 100;
  window.speechSynthesis?.cancel();

  openModal(`
    <div class="sheet-handle"></div>
    <div class="sheet-header">
      <div>
        <h2 id="modalTitle">${meal.emoji} Готуємо разом</h2>
        <p>${escapeHtml(meal.title)} · крок ${safeIndex + 1} з ${steps.length}</p>
      </div>
      <button class="close-button" type="button" data-close-modal aria-label="Закрити">×</button>
    </div>
    <div class="cooking-progress" aria-label="Прогрес рецепта">
      <div style="width: ${progress}%"></div>
    </div>
    <article class="cooking-step">
      <span class="cooking-step-number">${safeIndex + 1}</span>
      <p>${escapeHtml(steps[safeIndex])}</p>
    </article>
    ${
      "speechSynthesis" in window
        ? `<button class="speak-button" type="button" data-speak-step>${icon("volume")} Озвучити крок</button>`
        : ""
    }
    <div class="sheet-actions cooking-actions">
      <button class="secondary-button" type="button" data-previous-step ${safeIndex === 0 ? "disabled" : ""}>
        ${icon("back")} Назад
      </button>
      <button class="primary-button" type="button" data-next-step>
        ${safeIndex === steps.length - 1 ? `${icon("check")} Готово` : `Далі ${icon("arrow")}`}
      </button>
    </div>
  `);

  modalSheet.querySelector("[data-speak-step]")?.addEventListener("click", () => speakCookingStep(steps[safeIndex]));
  modalSheet.querySelector("[data-previous-step]")?.addEventListener("click", () => {
    openCookingGuide(mealId, safeIndex - 1);
  });
  modalSheet.querySelector("[data-next-step]").addEventListener("click", () => {
    if (safeIndex === steps.length - 1) {
      openFinishCookingModal(meal.id);
      return;
    }
    openCookingGuide(mealId, safeIndex + 1);
  });
}

function openFinishCookingModal(mealId) {
  const meal = findRecipeById(mealId);
  if (!meal) return;

  const matchedIngredients = meal.ingredients
    .map((ingredient) => ({
      ingredient,
      pantryItem: findPantryIngredient(ingredient.name),
    }))
    .filter((entry) => entry.pantryItem);

  openModal(`
    <div class="sheet-handle"></div>
    <div class="sheet-header">
      <div>
        <h2 id="modalTitle">Готово! Смачного 🍽️</h2>
        <p>Оновити залишки після ${escapeHtml(meal.title)}?</p>
      </div>
      <button class="close-button" type="button" data-close-modal aria-label="Закрити">×</button>
    </div>
    ${
      matchedIngredients.length
        ? `
          <div class="consume-list">
            ${matchedIngredients
              .map(
                ({ ingredient, pantryItem }) => `
                  <label class="consume-item">
                    <input class="custom-checkbox" type="checkbox" value="${pantryItem.id}" checked />
                    <span>
                      <strong>${escapeHtml(pantryItem.name)}</strong>
                      <small>було ${escapeHtml(pantryItem.amount)} · використано ${escapeHtml(ingredient.amount)}</small>
                    </span>
                  </label>
                `,
              )
              .join("")}
          </div>
          <p class="consume-note">Для грамів, кілограмів, літрів, мілілітрів і штук залишок рахується автоматично. Для довільних одиниць продукт буде позначено як такий, що закінчується.</p>
        `
        : `
          <div class="alternative-card">
            <strong>Немає продуктів для списання</strong>
            <p>Жоден інгредієнт рецепта не знайдений у поточних запасах.</p>
          </div>
        `
    }
    <div class="sheet-actions">
      <button class="secondary-button" type="button" data-finish-without-consuming>Не зараз</button>
      ${
        matchedIngredients.length
          ? `<button class="primary-button" type="button" data-consume-ingredients>${icon("check")} Списати</button>`
          : `<button class="primary-button" type="button" data-finish-without-consuming>Завершити</button>`
      }
    </div>
  `);

  modalSheet.querySelectorAll("[data-finish-without-consuming]").forEach((button) => {
    button.addEventListener("click", () => {
      closeModal();
      showToast("Страва готова. Запаси не змінено");
    });
  });

  modalSheet.querySelector("[data-consume-ingredients]")?.addEventListener("click", () => {
    const selectedIds = new Set(
      [...modalSheet.querySelectorAll(".consume-item input:checked")].map((input) => Number(input.value)),
    );

    matchedIngredients
      .filter(({ pantryItem }) => selectedIds.has(pantryItem.id))
      .forEach(({ pantryItem, ingredient }) => consumePantryAmount(pantryItem.id, ingredient.amount));

    syncIngredientAvailability();
    closeModal();
    render();
    showToast(`Запаси оновлено після «${meal.title}»`);
  });
}

function speakCookingStep(text) {
  if (!("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "uk-UA";
  utterance.rate = 0.92;
  window.speechSynthesis.speak(utterance);
}

function openAddItemModal(type) {
  const pantryMode = type === "pantry";
  openModal(`
    <div class="sheet-handle"></div>
    <div class="sheet-header">
      <div>
        <h2 id="modalTitle">${pantryMode ? "Додати до запасів" : "Новий продукт"}</h2>
        <p>${pantryMode ? "Познач, що вже є вдома" : "Внеси продукт і приблизну ціну"}</p>
      </div>
      <button class="close-button" type="button" data-close-modal aria-label="Закрити">×</button>
    </div>
    <form id="addItemForm">
      <label class="field">
        <span>Назва продукту</span>
        <input name="name" type="text" placeholder="Наприклад, вівсянка" required autofocus />
      </label>
      <div class="field-grid">
        <label class="field">
          <span>Кількість</span>
          <input name="amount" type="text" placeholder="500 г" required />
        </label>
        ${
          pantryMode
            ? `
              <label class="field">
                <span>Стан</span>
                <select name="low">
                  <option value="false">Є вдосталь</option>
                  <option value="true">Закінчується</option>
                </select>
              </label>
            `
            : `
              <label class="field">
                <span>Ціна, ₴</span>
                <input name="price" type="number" min="0" step="1" placeholder="40" required />
              </label>
            `
        }
      </div>
      ${
        pantryMode
          ? ""
          : `
            <label class="field">
              <span>Категорія</span>
              <select name="category">
                <option>Овочі</option>
                <option>Молочне</option>
                <option>М’ясо та риба</option>
                <option>Бакалія</option>
                <option>Інше</option>
              </select>
            </label>
          `
      }
      <div class="sheet-actions">
        <button class="secondary-button" type="button" data-close-modal>Скасувати</button>
        <button class="primary-button" type="submit">${icon("plus")} Додати</button>
      </div>
    </form>
  `);

  modalSheet.querySelector("#addItemForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const name = formData.get("name").trim();
    const amount = formData.get("amount").trim();

    if (pantryMode) {
      state.pantry.push({
        id: Date.now(),
        name,
        amount,
        emoji: "🥫",
        low: formData.get("low") === "true",
      });
      syncIngredientAvailability();
    } else {
      state.shopping.push({
        id: Date.now(),
        name,
        amount,
        price: Number(formData.get("price")),
        category: formData.get("category"),
        checked: false,
        urgent: false,
      });
    }

    closeModal();
    render();
    showToast(`${name} додано`);
  });
}

function openAccountModal() {
  if (!currentUser) {
    openModal(`
      <div class="sheet-handle"></div>
      <div class="sheet-header">
        <div>
          <h2 id="modalTitle">Локальний режим</h2>
          <p>Дані зберігаються лише в цьому браузері.</p>
        </div>
        <button class="close-button" type="button" data-close-modal aria-label="Закрити">×</button>
      </div>
      <div class="alternative-card">
        <strong>Neon не використовується</strong>
        <p>Прибери параметр <code>?local=1</code> після налаштування змінних середовища.</p>
      </div>
    `);
    return;
  }

  openModal(`
    <div class="sheet-handle"></div>
    <div class="sheet-header">
      <div>
        <h2 id="modalTitle">${escapeHtml(currentUser.name || "Акаунт")}</h2>
        <p>${escapeHtml(currentUser.email || "")}</p>
      </div>
      <button class="close-button" type="button" data-close-modal aria-label="Закрити">×</button>
    </div>
    <div class="account-status-card">
      <span class="account-avatar">${escapeHtml((currentUser.email || "U").slice(0, 1).toUpperCase())}</span>
      <div>
        <strong>${accessProfile?.role === "admin" ? "Адміністратор" : "Користувач"}</strong>
        <span>Доступ: ${accessProfile?.status === "active" ? "активний" : accessProfile?.status}</span>
      </div>
    </div>
    <div class="account-actions">
      ${
        accessProfile?.role === "admin"
          ? `<button class="secondary-button" type="button" data-manage-users>${icon("users")} Керувати користувачами</button>`
          : ""
      }
      <button class="danger-outline-button" type="button" data-account-signout>${icon("logout")} Вийти</button>
    </div>
  `);

  modalSheet.querySelector("[data-manage-users]")?.addEventListener("click", openAdminUsersModal);
  modalSheet.querySelector("[data-account-signout]").addEventListener("click", async () => {
    closeModal();
    await signOut();
  });
}

async function openAdminUsersModal() {
  openModal(`
    <div class="sheet-handle"></div>
    <div class="sheet-header">
      <div>
        <h2 id="modalTitle">Користувачі</h2>
        <p>Завантажую список доступів…</p>
      </div>
      <button class="close-button" type="button" data-close-modal aria-label="Закрити">×</button>
    </div>
    <div class="modal-loading"><span></span></div>
  `);

  const result = await neonClient.rpc("list_app_users");

  if (result.error) {
    openModal(`
      <div class="sheet-handle"></div>
      <div class="sheet-header">
        <div>
          <h2 id="modalTitle">Не вдалося завантажити</h2>
          <p>${escapeHtml(result.error.message || "Помилка Neon Data API")}</p>
        </div>
        <button class="close-button" type="button" data-close-modal aria-label="Закрити">×</button>
      </div>
    `);
    return;
  }

  const users = result.data || [];
  openModal(`
    <div class="sheet-handle"></div>
    <div class="sheet-header">
      <div>
        <h2 id="modalTitle">Користувачі</h2>
        <p>${users.length} ${pluralize(users.length, "акаунт", "акаунти", "акаунтів")}</p>
      </div>
      <button class="close-button" type="button" data-close-modal aria-label="Закрити">×</button>
    </div>
    <div class="admin-user-list">
      ${users
        .map((user) => {
          const isCurrent = user.user_id === currentUser.id;
          return `
            <article class="admin-user-card" data-admin-user="${escapeHtml(user.user_id)}">
              <div class="admin-user-head">
                <span class="account-avatar">${escapeHtml((user.email || "U").slice(0, 1).toUpperCase())}</span>
                <div>
                  <strong>${escapeHtml(user.display_name || user.email)}</strong>
                  <span>${escapeHtml(user.email)}${isCurrent ? " · це ти" : ""}</span>
                </div>
              </div>
              <div class="admin-user-controls">
                <label class="field">
                  <span>Доступ</span>
                  <select name="status" ${isCurrent ? "disabled" : ""}>
                    <option value="pending" ${user.status === "pending" ? "selected" : ""}>Очікує</option>
                    <option value="active" ${user.status === "active" ? "selected" : ""}>Дозволено</option>
                    <option value="blocked" ${user.status === "blocked" ? "selected" : ""}>Заблоковано</option>
                  </select>
                </label>
                <label class="field">
                  <span>Роль</span>
                  <select name="role" ${isCurrent ? "disabled" : ""}>
                    <option value="user" ${user.role === "user" ? "selected" : ""}>Користувач</option>
                    <option value="admin" ${user.role === "admin" ? "selected" : ""}>Адмін</option>
                  </select>
                </label>
              </div>
              ${
                isCurrent
                  ? ""
                  : `<button class="compact-button primary admin-save-user" type="button">Зберегти доступ</button>`
              }
            </article>
          `;
        })
        .join("")}
    </div>
  `);

  modalSheet.querySelectorAll(".admin-save-user").forEach((button) => {
    button.addEventListener("click", async () => {
      const card = button.closest("[data-admin-user]");
      button.disabled = true;
      button.textContent = "Зберігаю…";
      const updateResult = await neonClient
        .from("app_users")
        .update({
          status: card.querySelector("[name='status']").value,
          role: card.querySelector("[name='role']").value,
          updated_at: new Date().toISOString(),
        })
        .eq("user_id", card.dataset.adminUser);

      if (updateResult.error) {
        button.disabled = false;
        button.textContent = "Спробувати ще";
        showToast(updateResult.error.message || "Не вдалося змінити доступ");
        return;
      }

      button.textContent = "Збережено ✓";
      setTimeout(() => {
        button.disabled = false;
        button.textContent = "Зберегти доступ";
      }, 1200);
    });
  });
}

function openModal(content) {
  modalSheet.innerHTML = content;
  modalBackdrop.hidden = false;
  document.body.style.overflow = "hidden";
  modalSheet.querySelectorAll("[data-close-modal]").forEach((button) => {
    button.addEventListener("click", closeModal);
  });
  setTimeout(() => modalSheet.querySelector("[autofocus]")?.focus(), 50);
}

function closeModal() {
  window.speechSynthesis?.cancel();
  modalBackdrop.hidden = true;
  document.body.style.overflow = "";
  modalSheet.innerHTML = "";
}

function clearCheckedItems() {
  const count = state.shopping.filter((item) => item.checked).length;
  if (!count) {
    showToast("Ще нічого не позначено купленим");
    return;
  }
  state.shopping = state.shopping.filter((item) => !item.checked);
  render();
  showToast(`Прибрано ${count} ${pluralize(count, "позицію", "позиції", "позицій")}`);
}

function generateShoppingList() {
  let added = 0;
  state.meals.forEach((meal) => {
    meal.ingredients
      .filter((ingredient) => ingredient.missing)
      .forEach((ingredient) => {
        const exists = state.shopping.some(
          (item) => item.name.toLowerCase() === ingredient.name.toLowerCase() && !item.checked,
        );
        if (!exists) {
          state.shopping.push({
            id: Date.now() + added,
            name: ingredient.name,
            amount: ingredient.amount,
            price: estimatePrice(ingredient.name),
            category: inferCategory(ingredient.name),
            checked: false,
            urgent: meal.id === state.meals[0].id,
          });
          added += 1;
        }
      });
  });
  state.activeView = "shopping";
  render();
  showToast(added ? `Список оновлено: +${added}` : "Список уже відповідає меню");
  if (added) {
    notifyAction({
      title: "Список покупок оновлено 🛒",
      body: `Додано ${added} ${pluralize(added, "продукт", "продукти", "продуктів")}`,
      tag: "shopping-list-generated",
      url: "#shopping",
    });
  }
}

async function notifyAction({ title, body, tag, url = "#home" }) {
  if (!("Notification" in window)) return;

  try {
    let permission = Notification.permission;
    if (permission === "default") {
      permission = await Notification.requestPermission();
    }
    if (permission !== "granted") return;

    const options = {
      body,
      icon: "icon.svg",
      badge: "icon.svg",
      tag,
      data: { url },
    };

    if ("serviceWorker" in navigator) {
      const registration = await navigator.serviceWorker.ready;
      registration.showNotification(title, options);
      return;
    }

    new Notification(title, options);
  } catch {
    // Toasts already confirm the action, so notification failures should not block the flow.
  }
}

async function requestShoppingNotification() {
  const count = remainingItems().length;
  if (!count) {
    showToast("Список уже виконано — нагадувати нема про що");
    return;
  }

  if (!("Notification" in window)) {
    showToast("Цей браузер не підтримує сповіщення");
    return;
  }

  try {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      showToast("Дозвіл на сповіщення не надано");
      return;
    }

    const message = `${count} ${pluralize(count, "продукт", "продукти", "продуктів")} · приблизно ${formatMoney(remainingItems().reduce((sum, item) => sum + item.price, 0))}`;
    if ("serviceWorker" in navigator) {
      const registration = await navigator.serviceWorker.ready;
      registration.showNotification("Не забудь список покупок 🛒", {
        body: message,
        icon: "icon.svg",
        badge: "icon.svg",
        tag: "shopping-reminder",
      });
    } else {
      new Notification("Не забудь список покупок 🛒", { body: message });
    }
    document.querySelector("#notificationDot").hidden = true;
    showToast("Нагадування надіслано");
  } catch {
    showToast("Не вдалося показати сповіщення");
  }
}

function showToast(message) {
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.add("visible");
  toastTimer = setTimeout(() => toast.classList.remove("visible"), 2400);
}

function getAlternativeText(meal) {
  if (meal.title.toLowerCase().includes("кур")) return "Заміни курку на квасолю, а йогурт — на ложку олії.";
  if (meal.title.toLowerCase().includes("гриб")) return "Заміни гриби на моркву з цибулею, які вже є вдома.";
  return "Продукт, якого бракує, можна пропустити або замінити сезонним овочем.";
}

function parseLines(value) {
  return String(value)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function parseIngredients(value) {
  return parseLines(value).map((line) => {
    const [rawName, ...rawAmount] = line.split("|");
    const name = rawName.trim();
    const amount = rawAmount.join("|").trim() || "за смаком";

    return {
      name,
      amount,
      missing: !hasPantryIngredient(name),
    };
  });
}

function hasPantryIngredient(name) {
  return Boolean(findPantryIngredient(name));
}

function findPantryIngredient(name) {
  const normalized = normalizeIngredientName(name);
  return state.pantry.find((item) => {
    const pantryName = normalizeIngredientName(item.name);
    return pantryName.includes(normalized) || normalized.includes(pantryName);
  });
}

function normalizeIngredientName(name) {
  return String(name)
    .toLowerCase()
    .replaceAll("’", "")
    .replaceAll("'", "")
    .replace(/\s+/g, " ")
    .trim();
}

function syncIngredientAvailability() {
  [...state.meals, ...state.recipeCatalog].forEach((meal) => {
    meal.ingredients.forEach((ingredient) => {
      ingredient.missing = !hasPantryIngredient(ingredient.name);
    });
  });
}

function consumePantryAmount(itemId, usedAmount) {
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

function parseQuantity(value) {
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

function formatQuantity(baseValue, quantity) {
  const displayValue = baseValue / quantity.factor;
  const rounded = Math.round(displayValue * 100) / 100;
  return `${String(rounded).replace(".", ",")} ${quantity.unit}`;
}

function inferCategory(name) {
  const catalogMatch = state.productCatalog.find(
    (item) => normalizeIngredientName(item.name) === normalizeIngredientName(name),
  );
  if (catalogMatch) return catalogMatch.category;

  const normalized = name.toLowerCase();
  if (["йогурт", "сир", "молоко", "вершки"].some((word) => normalized.includes(word))) return "Молочне";
  if (["кур", "м’яс", "риба"].some((word) => normalized.includes(word))) return "М’ясо та риба";
  if (["булгур", "греч", "хліб", "рис", "макарон"].some((word) => normalized.includes(word))) return "Бакалія";
  return "Овочі";
}

function estimatePrice(name) {
  const catalogMatch = state.productCatalog.find(
    (item) => normalizeIngredientName(item.name) === normalizeIngredientName(name),
  );
  if (catalogMatch) return catalogMatch.price;

  const prices = {
    "Куряче філе": 96,
    Йогурт: 31,
    Печериці: 42,
    Зелень: 22,
    Хліб: 36,
  };
  return prices[name] || 35;
}

function categoryEmoji(category) {
  if (category === "Молочне") return "🥛";
  if (category === "М’ясо та риба") return "🍗";
  if (category === "Бакалія") return "🌾";
  return "🥬";
}

function syncMealDates() {
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

function getWeekRangeLabel(dayCount = 7) {
  const months = [
    "січня",
    "лютого",
    "березня",
    "квітня",
    "травня",
    "червня",
    "липня",
    "серпня",
    "вересня",
    "жовтня",
    "листопада",
    "грудня",
  ];
  const start = new Date();
  const end = new Date(start);
  end.setDate(start.getDate() + Math.max(dayCount - 1, 0));

  if (start.getMonth() === end.getMonth()) {
    return `${start.getDate()}–${end.getDate()} ${months[end.getMonth()]}`;
  }
  return `${start.getDate()} ${months[start.getMonth()]} — ${end.getDate()} ${months[end.getMonth()]}`;
}

function pluralize(number, one, few, many) {
  const mod10 = number % 10;
  const mod100 = number % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function icon(name) {
  const icons = {
    arrow: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
    clock: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
    wallet: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h15a2 2 0 0 1 2 2v9H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h13v3"/><path d="M16 12h5"/></svg>',
    chef: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 10a4 4 0 1 1 2-7 4.5 4.5 0 0 1 7.8 2A3.5 3.5 0 1 1 18 12H7a3 3 0 0 1 0-6"/><path d="M7 12v8h11v-8M9 16h7"/></svg>',
    swap: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m16 3 4 4-4 4M20 7H4M8 21l-4-4 4-4M4 17h16"/></svg>',
    spark: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 1.2 4.1L17 9l-3.8 1.9L12 15l-1.2-4.1L7 9l3.8-1.9L12 3ZM18.5 15l.7 2.3 2.3.7-2.3.7-.7 2.3-.7-2.3-2.3-.7 2.3-.7.7-2.3ZM5 13l.7 2.3L8 16l-2.3.7L5 19l-.7-2.3L2 16l2.3-.7L5 13Z"/></svg>',
    cart: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="20" r="1"/><circle cx="19" cy="20" r="1"/><path d="M3 4h2l2.4 11.2a2 2 0 0 0 2 1.6h7.8a2 2 0 0 0 2-1.6L21 8H6"/></svg>',
    bell: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></svg>',
    plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
    search: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg>',
    edit: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 20 4.2-1 10.6-10.6a2.1 2.1 0 0 0-3-3L5.2 16 4 20ZM14.5 6.5l3 3"/></svg>',
    trash: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 3h6l1 4H8l1-4ZM7 7l1 14h8l1-14M10 11v6M14 11v6"/></svg>',
    save: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h12l2 2v14H5V4Z"/><path d="M8 4v6h8V4M8 20v-6h8v6"/></svg>',
    volume: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 9h4l5-4v14l-5-4H5V9ZM17 9a4 4 0 0 1 0 6M19 6a8 8 0 0 1 0 12"/></svg>',
    back: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 12H5M11 18l-6-6 6-6"/></svg>',
    check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg>',
    users: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="8" r="3"/><circle cx="17" cy="9" r="2.5"/><path d="M3 20a6 6 0 0 1 12 0M14 15a5 5 0 0 1 7 4.5"/></svg>',
    logout: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 5H5v14h5M14 8l4 4-4 4M8 12h10"/></svg>',
  };
  return icons[name] || "";
}

async function bootstrap() {
  if (isBootstrapping) return;
  isBootstrapping = true;
  app.innerHTML = `
    <div class="app-loading" role="status">
      <span></span>
      <strong>Перевіряю доступ…</strong>
    </div>
  `;

  try {
    const localMode = new URLSearchParams(window.location.search).has("local");
    if (!neonConfigured) {
      if (!localMode) {
        renderConfigurationScreen();
        return;
      }

      const saved = (await readState(LOCAL_DB_STATE_KEY)) || loadLegacyState();
      state = hydrateState(saved);
      currentUser = null;
      accessProfile = null;
      const hashView = window.location.hash.slice(1);
      if (availableViews.includes(hashView)) {
        state.activeView = hashView;
      }
      syncMealDates();
      syncIngredientAvailability();
      render();
      return;
    }

    const sessionResult = await neonClient.auth.getSession();
    const user = getSessionUser(sessionResult);
    if (!user) {
      currentUser = null;
      accessProfile = null;
      renderAuthScreen();
      return;
    }

    currentUser = user;
    accessProfile = await getAccessProfile(user);
    if (!accessProfile || accessProfile.status !== "active") {
      renderAccessScreen(accessProfile || { status: "pending" });
      return;
    }

    const userLocalKey = `${LOCAL_DB_STATE_KEY}:${user.id}`;
    const [cloudSaved, userLocalSaved, legacySaved] = await Promise.all([
      loadCloudState(user.id),
      readState(userLocalKey),
      readState(LOCAL_DB_STATE_KEY),
    ]);

    const saved = cloudSaved || userLocalSaved || legacySaved || loadLegacyState();
    state = hydrateState(saved);
    const hashView = window.location.hash.slice(1);
    if (availableViews.includes(hashView)) {
      state.activeView = hashView;
    }
    syncMealDates();
    syncIngredientAvailability();
    render();

    if (!cloudStateExists) {
      await persistCloudState(structuredClone(state));
    }
    if (!userLocalSaved && legacySaved) {
      await writeState(state, userLocalKey);
      await deleteState(LOCAL_DB_STATE_KEY);
      localStorage.removeItem(STORAGE_KEY);
    }
  } catch (error) {
    if (currentUser) {
      renderAccessScreen(accessProfile || { status: "pending" }, error?.message || "Не вдалося перевірити доступ");
    } else {
      renderAuthScreen(error?.message || "Не вдалося з’єднатися з Neon");
    }
  } finally {
    isBootstrapping = false;
  }
}

document.querySelectorAll(".nav-item").forEach((button) => {
  button.addEventListener("click", () => switchView(button.dataset.view));
});

document.querySelector(".brand").addEventListener("click", () => switchView("home"));
document.querySelector("#accountButton").addEventListener("click", openAccountModal);
modalBackdrop.addEventListener("click", (event) => {
  if (event.target === modalBackdrop) closeModal();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !modalBackdrop.hidden) closeModal();
});
window.addEventListener("hashchange", () => {
  const view = window.location.hash.slice(1);
  if (availableViews.includes(view) && view !== state.activeView) {
    state.activeView = view;
    render();
  }
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js"));
}

bootstrap();
