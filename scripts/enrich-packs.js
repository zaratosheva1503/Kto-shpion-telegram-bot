/*
 * enrich-packs.js
 * ----------------
 * Постепенно наполняет data/packs.js НАСТОЯЩИМИ картинками и расширяет паки.
 *
 * Запуск:
 *   node scripts/enrich-packs.js
 * После запуска перезапусти сервер (или npm start).
 *
 * Идея: этот файл — единая точка, куда мы добавляем реальные картинки
 * пак за паком. Сейчас здесь готов пак "Страны" (настоящие флаги с flagcdn.com,
 * ссылки стабильные). Дальше сюда же будем добавлять остальные паки
 * (футболисты, бренды, аниме и т.д.) — каждый отдельным блоком ниже.
 *
 * Безопасно: скрипт читает текущий PACKS, обновляет/добавляет нужные паки
 * и записывает data/packs.js обратно, сохраняя все остальные паки и поля.
 */

const fs = require("fs");
const path = require("path");

const packsPath = path.join(__dirname, "..", "data", "packs.js");
const { PACKS } = require("../data/packs");

// ---------------------------------------------------------------------------
// Хелперы источников реальных картинок
// ---------------------------------------------------------------------------
// Флаги: flagcdn.com — стабильный CDN, ISO 3166-1 alpha-2 коды в нижнем регистре.
const FLAG_BASE = "https://flagcdn.com/w640/";
const flag = (code) => FLAG_BASE + code + ".png";

// ---------------------------------------------------------------------------
// ПАК: Страны (50 настоящих флагов)
// ---------------------------------------------------------------------------
const COUNTRIES = [
  ["Россия", "Russia", "ru"],
  ["США", "USA", "us"],
  ["Великобритания", "United Kingdom", "gb"],
  ["Германия", "Germany", "de"],
  ["Франция", "France", "fr"],
  ["Италия", "Italy", "it"],
  ["Испания", "Spain", "es"],
  ["Китай", "China", "cn"],
  ["Япония", "Japan", "jp"],
  ["Южная Корея", "South Korea", "kr"],
  ["Индия", "India", "in"],
  ["Бразилия", "Brazil", "br"],
  ["Канада", "Canada", "ca"],
  ["Австралия", "Australia", "au"],
  ["Мексика", "Mexico", "mx"],
  ["Украина", "Ukraine", "ua"],
  ["Польша", "Poland", "pl"],
  ["Турция", "Turkey", "tr"],
  ["Казахстан", "Kazakhstan", "kz"],
  ["Беларусь", "Belarus", "by"],
  ["Узбекистан", "Uzbekistan", "uz"],
  ["Азербайджан", "Azerbaijan", "az"],
  ["Грузия", "Georgia", "ge"],
  ["Армения", "Armenia", "am"],
  ["Нидерланды", "Netherlands", "nl"],
  ["Швеция", "Sweden", "se"],
  ["Норвегия", "Norway", "no"],
  ["Финляндия", "Finland", "fi"],
  ["Дания", "Denmark", "dk"],
  ["Швейцария", "Switzerland", "ch"],
  ["Австрия", "Austria", "at"],
  ["Бельгия", "Belgium", "be"],
  ["Португалия", "Portugal", "pt"],
  ["Греция", "Greece", "gr"],
  ["Чехия", "Czechia", "cz"],
  ["Венгрия", "Hungary", "hu"],
  ["Румыния", "Romania", "ro"],
  ["Египет", "Egypt", "eg"],
  ["Саудовская Аравия", "Saudi Arabia", "sa"],
  ["ОАЭ", "UAE", "ae"],
  ["Иран", "Iran", "ir"],
  ["Израиль", "Israel", "il"],
  ["Таиланд", "Thailand", "th"],
  ["Вьетнам", "Vietnam", "vn"],
  ["Индонезия", "Indonesia", "id"],
  ["Филиппины", "Philippines", "ph"],
  ["Аргентина", "Argentina", "ar"],
  ["Чили", "Chile", "cl"],
  ["ЮАР", "South Africa", "za"],
  ["Нигерия", "Nigeria", "ng"],
];

const countriesPack = {
  id: "countries",
  title: "Страны",
  titleEn: "Countries",
  emoji: "🌍",
  cover: flag("un"),
  free: true,
  cards: COUNTRIES.map(([name, nameEn, code]) => ({
    id: "countries-" + code,
    name,
    nameEn,
    image: flag(code),
  })),
};

// ---------------------------------------------------------------------------
// Применяем изменения
// ---------------------------------------------------------------------------
function upsertPack(pack) {
  const idx = PACKS.findIndex((p) => p.id === pack.id);
  if (idx >= 0) PACKS[idx] = pack;
  else PACKS.push(pack);
}

upsertPack(countriesPack);

// Записываем обратно как чистый модуль данных.
const header =
  "// Данные паков и карт для игры «Кто шпион».\n" +
  "// Часть картинок проставляется скриптом scripts/enrich-packs.js.\n\n";
const out = header + "const PACKS = " + JSON.stringify(PACKS, null, 2) + ";\n\nmodule.exports = { PACKS };\n";
fs.writeFileSync(packsPath, out, "utf8");

console.log(
  "packs.js обновлён: всего паков " + PACKS.length + "; пак Страны = " + countriesPack.cards.length + " карт (настоящие флаги).",
);
