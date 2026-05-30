// Cosmetic items catalog.
//
// Cosmetics are unlocked either by paying Telegram Stars (the "На покушать"
// donation flow) or by reaching a level threshold. Every item has a stable
// `id` that is referenced from the user's inventory in data/storage/users.json.

const FRAMES = [
  { id: 'default',  title: 'Обычная',  emoji: '⚪', rarity: 'common',    starsPrice: 0,   levelRequired: 0,  free: true },
  { id: 'bronze',   title: 'Бронза',   emoji: '🥉', rarity: 'common',    starsPrice: 0,   levelRequired: 3,  freeAt: 'level' },
  { id: 'silver',   title: 'Серебро',  emoji: '🥈', rarity: 'rare',      starsPrice: 0,   levelRequired: 7,  freeAt: 'level' },
  { id: 'gold',     title: 'Золото',   emoji: '🥇', rarity: 'rare',      starsPrice: 50,  levelRequired: 0 },
  { id: 'neon',     title: 'Неон',     emoji: '💠', rarity: 'epic',      starsPrice: 75,  levelRequired: 0 },
  { id: 'fire',     title: 'Огонь',    emoji: '🔥', rarity: 'epic',      starsPrice: 100, levelRequired: 0 },
  { id: 'ice',      title: 'Лёд',      emoji: '❄️', rarity: 'epic',      starsPrice: 100, levelRequired: 0 },
  { id: 'rainbow',  title: 'Радуга',   emoji: '🌈', rarity: 'legendary', starsPrice: 150, levelRequired: 0 },
  { id: 'cyber',    title: 'Киберпанк', emoji: '🤖', rarity: 'legendary', starsPrice: 200, levelRequired: 0 },
  { id: 'galaxy',   title: 'Галактика', emoji: '🌌', rarity: 'legendary', starsPrice: 250, levelRequired: 0 },
  { id: 'crown',    title: 'Корона',   emoji: '👑', rarity: 'mythic',    starsPrice: 500, levelRequired: 0, premiumOnly: true }
];

const THEMES = [
  { id: 'dark',     title: 'Тёмная',     emoji: '🌙', rarity: 'common', starsPrice: 0, free: true },
  { id: 'light',    title: 'Светлая',    emoji: '☀️', rarity: 'common', starsPrice: 0, free: true },
  { id: 'cyberpunk', title: 'Киберпанк', emoji: '🤖', rarity: 'epic',   starsPrice: 100 },
  { id: 'neon',     title: 'Неон',       emoji: '💜', rarity: 'epic',   starsPrice: 100 },
  { id: 'minimal',  title: 'Минимал',    emoji: '◽', rarity: 'rare',   starsPrice: 50 },
  { id: 'holiday',  title: 'Праздник',   emoji: '🎄', rarity: 'rare',   starsPrice: 50 },
  { id: 'sunset',   title: 'Закат',      emoji: '🌅', rarity: 'epic',   starsPrice: 100 },
  { id: 'ocean',    title: 'Океан',      emoji: '🌊', rarity: 'epic',   starsPrice: 100 }
];

const NAME_EFFECTS = [
  { id: 'none',     title: 'Без эффекта', emoji: '⚪', rarity: 'common', starsPrice: 0, free: true },
  { id: 'gradient', title: 'Градиент',   emoji: '🌈', rarity: 'rare',   starsPrice: 50 },
  { id: 'rainbow',  title: 'Радуга',     emoji: '🌈', rarity: 'epic',   starsPrice: 100 },
  { id: 'fire',     title: 'Огонь',      emoji: '🔥', rarity: 'epic',   starsPrice: 100 },
  { id: 'neon',     title: 'Неон',       emoji: '💠', rarity: 'epic',   starsPrice: 100 },
  { id: 'ice',      title: 'Лёд',        emoji: '❄️', rarity: 'epic',   starsPrice: 100 },
  { id: 'gold',     title: 'Золото',     emoji: '🥇', rarity: 'legendary', starsPrice: 200 }
];

const STATUS_EMOJIS = [
  { id: 'none',     title: 'Нет статуса', emoji: '⚪', rarity: 'common', starsPrice: 0, free: true },
  { id: '🎯',       title: 'Цель',        emoji: '🎯', rarity: 'common', starsPrice: 25 },
  { id: '🔥',       title: 'Огонь',       emoji: '🔥', rarity: 'common', starsPrice: 25 },
  { id: '👑',       title: 'Корона',      emoji: '👑', rarity: 'rare',   starsPrice: 50 },
  { id: '💎',       title: 'Алмаз',       emoji: '💎', rarity: 'rare',   starsPrice: 50 },
  { id: '🕵️',       title: 'Шпион',       emoji: '🕵️', rarity: 'rare',   starsPrice: 50 },
  { id: '⚡',       title: 'Молния',      emoji: '⚡', rarity: 'common', starsPrice: 25 },
  { id: '🌟',       title: 'Звезда',      emoji: '🌟', rarity: 'rare',   starsPrice: 50 },
  { id: '😎',       title: 'Крутой',      emoji: '😎', rarity: 'common', starsPrice: 25 },
  { id: '💀',       title: 'Череп',       emoji: '💀', rarity: 'epic',   starsPrice: 75 },
  { id: '🎮',       title: 'Геймер',      emoji: '🎮', rarity: 'common', starsPrice: 25 },
  { id: '🤡',       title: 'Клоун',       emoji: '🤡', rarity: 'common', starsPrice: 25 }
];

// Animated avatar URLs (Dicebear shapes that look "lively") — they're not
// truly animated, but they have particles + gradients; treat them as
// premium "deluxe" avatars.
const ANIMATED_AVATARS = [
  { id: 'anim-fox',    title: 'Лиса',     url: 'https://api.dicebear.com/7.x/fun-emoji/svg?seed=fox-anim&radius=50&backgroundType=gradientLinear', starsPrice: 100 },
  { id: 'anim-cat',    title: 'Кот',      url: 'https://api.dicebear.com/7.x/fun-emoji/svg?seed=cat-anim&radius=50&backgroundType=gradientLinear', starsPrice: 100 },
  { id: 'anim-robot',  title: 'Робот',    url: 'https://api.dicebear.com/7.x/bottts/svg?seed=robot-anim&radius=50&backgroundType=gradientLinear', starsPrice: 150 },
  { id: 'anim-alien',  title: 'Пришелец', url: 'https://api.dicebear.com/7.x/fun-emoji/svg?seed=alien-anim&radius=50&backgroundType=gradientLinear', starsPrice: 150 },
  { id: 'anim-king',   title: 'Король',   url: 'https://api.dicebear.com/7.x/notionists/svg?seed=king-anim&radius=50&backgroundType=gradientLinear', starsPrice: 200 },
  { id: 'anim-ninja',  title: 'Ниндзя',   url: 'https://api.dicebear.com/7.x/big-smile/svg?seed=ninja-anim&radius=50&backgroundType=gradientLinear', starsPrice: 200 }
];

const DONATIONS = [
  { id: 'tip100',  title: '☕ Кофеёк',     stars: 100,  description: 'Лёгкая поддержка, мгновенно даёт премиум на 7 дней.' },
  { id: 'tip200',  title: '🍔 На бургер',  stars: 200,  description: 'Премиум на 14 дней + 1 случайный предмет.' },
  { id: 'tip500',  title: '🍕 На пиццу',   stars: 500,  description: 'Премиум на 30 дней + 3 предмета на выбор.' },
  { id: 'tip1000', title: '🥩 На стейк',   stars: 1000, description: 'Премиум на 90 дней + полный комплект косметики.' }
];

const ALL = {
  frames: FRAMES,
  themes: THEMES,
  nameEffects: NAME_EFFECTS,
  statusEmojis: STATUS_EMOJIS,
  animatedAvatars: ANIMATED_AVATARS,
  donations: DONATIONS
};

const INDEX = (() => {
  const idx = {};
  for (const kind of Object.keys(ALL)) {
    idx[kind] = new Map(ALL[kind].map((item) => [item.id, item]));
  }
  return idx;
})();

function findItem(kind, id) {
  return INDEX[kind] ? INDEX[kind].get(id) : null;
}

// Compute how many stars donating gives premium for.
// Each 100 stars ~= 7 days of premium, scaled linearly.
function starsToPremiumMs(stars) {
  const days = (stars / 100) * 7;
  return Math.round(days * 24 * 60 * 60 * 1000);
}

module.exports = {
  FRAMES,
  THEMES,
  NAME_EFFECTS,
  STATUS_EMOJIS,
  ANIMATED_AVATARS,
  DONATIONS,
  ALL,
  findItem,
  starsToPremiumMs
};
