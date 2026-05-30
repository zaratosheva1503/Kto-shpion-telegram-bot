/*
 * Generator: добавляет titleEn к пакам и переводит карточки.
 * Принципы:
 *   - name = русское имя (отображается крупно)
 *   - nameEn = английское имя (мелкий серый подзаголовок, опционально)
 *   - id и image НЕ меняются (image-файлы привязаны к существующим slug)
 *
 * Запуск (один раз):  node scripts/translate-packs.js
 */
const fs = require('fs');
const path = require('path');
const { PACKS } = require('../data/packs');

const PACK_TITLE_EN = {
  base: 'Basics',
  locations: 'Locations',
  superheroes: 'Superheroes',
  cartoons: 'Cartoons',
  memes: 'Memes',
  estrada: 'Russian Pop',
  'foreign-stars': 'Foreign Stars',
  cars: 'Cars',
  personalities: 'Personalities',
  series: 'TV Series',
  'football-clubs': 'Football Clubs',
  'brawl-stars': 'Brawl Stars',
  'clash-royale': 'Clash Royale',
  'dota-2': 'Dota 2',
  ufc: 'UFC',
  autobloggers: 'Auto Bloggers',
  food: 'Food',
  animals: 'Animals',
  'bloggers-cis': 'CIS Bloggers',
  cinema: 'Movies',
  footballers: 'Footballers',
  anime: 'Anime',
  cities: 'Cities',
  brands: 'Brands',
  tiktok: 'TikTok'
};

// Brawl Stars: транслитерация на русский (официальной локали в игре для имён почти нет;
// сообщество использует именно эти варианты).
const BRAWL_STARS_RU = {
  'Shelly': 'Шелли',
  'Colt': 'Кольт',
  'Bull': 'Булл',
  'Brock': 'Брок',
  'Rico': 'Рико',
  'Spike': 'Спайк',
  'Barley': 'Барли',
  'Jessie': 'Джесси',
  'Nita': 'Нита',
  'Dynamike': 'Динамайк',
  'El Primo': 'Эль Примо',
  'Mortis': 'Мортис',
  'Crow': 'Кроу',
  'Poco': 'Поко',
  'Bo': 'Бо',
  'Piper': 'Пайпер',
  'Pam': 'Пэм',
  'Tara': 'Тара',
  'Darryl': 'Дэррил',
  'Penny': 'Пенни',
  'Frank': 'Фрэнк',
  'Gene': 'Джин',
  'Tick': 'Тик',
  'Leon': 'Леон',
  'Rosa': 'Роза',
  'Carl': 'Карл',
  'Bibi': 'Биби',
  '8-Bit': '8-Бит',
  'Bea': 'Би',
  'Sandy': 'Сэнди',
  'Emz': 'Эмз',
  'Mr. P': 'Мистер П',
  'Max': 'Макс',
  'Jacky': 'Джеки',
  'Gale': 'Гейл',
  'Nani': 'Нани',
  'Sprout': 'Спраут',
  'Surge': 'Сёрж',
  'Colette': 'Колетт',
  'Amber': 'Эмбер',
  'Lou': 'Лу',
  'Byron': 'Байрон',
  'Edgar': 'Эдгар',
  'Ruffs': 'Полковник Раффс',
  'Stu': 'Стью',
  'Belle': 'Белль',
  'Squeak': 'Скуик',
  'Grom': 'Гром',
  'Buzz': 'Базз',
  'Griff': 'Грифф',
  'Ash': 'Эш',
  'Meg': 'Мег',
  'Lola': 'Лола',
  'Fang': 'Фэнг',
  'Eve': 'Ева',
  'Janet': 'Джанет',
  'Bonnie': 'Бонни',
  'Otis': 'Отис',
  'Sam': 'Сэм',
  'Gus': 'Гас',
  'Buster': 'Бастер',
  'Chester': 'Честер',
  'Gray': 'Грэй',
  'Mandy': 'Мэнди',
  'R-T': 'Эр-Ти',
  'Willow': 'Уиллоу',
  'Maisie': 'Мейзи',
  'Hank': 'Хэнк',
  'Cordelius': 'Корделиус',
  'Doug': 'Даг',
  'Pearl': 'Перл',
  'Chuck': 'Чак',
  'Charlie': 'Чарли',
  'Mico': 'Мико',
  'Kit': 'Кит',
  'Larry & Lawrie': 'Ларри и Лори',
  'Melodie': 'Мелоди',
  'Angelo': 'Анджело',
  'Draco': 'Драко',
  'Lily': 'Лили',
  'Berry': 'Берри',
  'Clancy': 'Клэнси',
  'Moe': 'Мо',
  'Kenji': 'Кэндзи',
  'Shade': 'Шейд',
  'Juju': 'Джуджу',
  'Buzz Lightyear': 'Базз Лайтер',
  'Meeple': 'Мипл',
  'Ollie': 'Олли',
  'Lumi': 'Луми',
  'Finx': 'Финкс',
  'Jae-Yong': 'Дже-Ёнг',
  'Kaze': 'Каzе',
  'Alli': 'Алли',
  'Trunk': 'Транк',
  'Mina': 'Мина',
  'Ziggy': 'Зигги',
  'Pierce': 'Пирс',
  'Gigi': 'Джиджи',
  'Glowy': 'Глоуи',
  'Sirius': 'Сириус',
  'Najia': 'Наджия',
  'Damian': 'Дамиан',
  'Starr Nova': 'Старр Нова',
  'Bolt': 'Болт'
};

// Clash Royale: устоявшиеся русские названия из официальной локали.
const CLASH_ROYALE_RU = {
  'Knight': 'Рыцарь',
  'Archers': 'Лучницы',
  'Goblins': 'Гоблины',
  'Giant': 'Гигант',
  'P.E.K.K.A': 'П.Е.К.К.А',
  'Minions': 'Миньоны',
  'Balloon': 'Шар',
  'Witch': 'Ведьма',
  'Barbarians': 'Варвары',
  'Golem': 'Голем',
  'Skeletons': 'Скелеты',
  'Valkyrie': 'Валькирия',
  'Skeleton Army': 'Армия скелетов',
  'Bomber': 'Бомбер',
  'Musketeer': 'Мушкетёр',
  'Baby Dragon': 'Дракончик',
  'Prince': 'Принц',
  'Wizard': 'Маг',
  'Mini P.E.K.K.A': 'Мини П.Е.К.К.А',
  'Spear Goblins': 'Гоблины с копьями',
  'Giant Skeleton': 'Скелет-гигант',
  'Hog Rider': 'Всадник на кабане',
  'Minion Horde': 'Орда миньонов',
  'Ice Wizard': 'Ледяной маг',
  'Royal Giant': 'Королевский гигант',
  'Guards': 'Стражи',
  'Princess': 'Принцесса',
  'Dark Prince': 'Тёмный принц',
  'Three Musketeers': 'Три мушкетёра',
  'Lava Hound': 'Лавовый гончий',
  'Ice Spirit': 'Ледяной дух',
  'Fire Spirit': 'Огненный дух',
  'Miner': 'Шахтёр',
  'Sparky': 'Спарки',
  'Bowler': 'Боулер',
  'Lumberjack': 'Лесоруб',
  'Battle Ram': 'Боевой таран',
  'Inferno Dragon': 'Инферно-дракон',
  'Ice Golem': 'Ледяной голем',
  'Mega Minion': 'Мегаминьон',
  'Dart Goblin': 'Гоблин-дартсмен',
  'Goblin Gang': 'Банда гоблинов',
  'Electro Wizard': 'Электромаг',
  'Elite Barbarians': 'Элитные варвары',
  'Hunter': 'Охотник',
  'Executioner': 'Палач',
  'Bandit': 'Бандитка',
  'Royal Recruits': 'Королевские рекруты',
  'Night Witch': 'Ночная ведьма',
  'Bats': 'Летучие мыши',
  'Royal Ghost': 'Королевский призрак',
  'Ram Rider': 'Всадница на баране',
  'Zappies': 'Зэппи',
  'Rascals': 'Хулиганы',
  'Cannon Cart': 'Пушечная тележка',
  'Mega Knight': 'Мегарыцарь',
  'Skeleton Barrel': 'Скелетная бочка',
  'Flying Machine': 'Летательный аппарат',
  'Wall Breakers': 'Подрывники',
  'Royal Hogs': 'Королевские кабаны',
  'Goblin Giant': 'Гоблин-гигант',
  'Fisherman': 'Рыбак',
  'Magic Archer': 'Магический лучник',
  'Electro Dragon': 'Электро-дракон',
  'Firecracker': 'Петарда',
  'Mighty Miner': 'Могучий шахтёр',
  'Super Witch': 'Супер-ведьма',
  'Elixir Golem': 'Эликсирный голем',
  'Battle Healer': 'Боевая лекарка',
  'Skeleton King': 'Король скелетов',
  'Super Lava Hound': 'Супер-лавовый гончий',
  'Super Magic Archer': 'Супер-магический лучник',
  'Archer Queen': 'Королева лучниц',
  'Santa Hog Rider': 'Санта-всадник',
  'Golden Knight': 'Золотой рыцарь',
  'Super Ice Golem': 'Супер-ледяной голем',
  'Monk': 'Монах',
  'Super Archers': 'Супер-лучницы',
  'Skeleton Dragons': 'Скелеты-драконы',
  'Terry': 'Терри',
  'Super Mini P.E.K.K.A': 'Супер мини П.Е.К.К.А',
  'Mother Witch': 'Ведьма-мать',
  'Electro Spirit': 'Электро-дух',
  'Electro Giant': 'Электро-гигант',
  'Raging Prince': 'Яростный принц',
  'Phoenix': 'Феникс',
  'Cannon': 'Пушка',
  'Goblin Hut': 'Хижина гоблинов',
  'Mortar': 'Мортира',
  'Inferno Tower': 'Инферно-башня',
  'Bomb Tower': 'Бомбовая башня',
  'Barbarian Hut': 'Хижина варваров',
  'Tesla': 'Тесла',
  'Elixir Collector': 'Эликсирный сборщик',
  'X-Bow': 'Самострел',
  'Tombstone': 'Надгробие',
  'Furnace': 'Печь',
  'Goblin Cage': 'Клетка гоблинов',
  'Goblin Drill': 'Гоблинский бур',
  'Party Hut': 'Праздничная хижина',
  'Fireball': 'Огненный шар',
  'Arrows': 'Стрелы',
  'Rage': 'Ярость',
  'Rocket': 'Ракета',
  'Goblin Barrel': 'Гоблинская бочка',
  'Freeze': 'Заморозка',
  'Mirror': 'Зеркало',
  'Lightning': 'Молния',
  'Zap': 'Электрошок',
  'Poison': 'Яд',
  'Graveyard': 'Кладбище',
  'The Log': 'Бревно',
  'Tornado': 'Торнадо',
  'Clone': 'Клон',
  'Earthquake': 'Землетрясение',
  'Barbarian Barrel': 'Бочка варваров',
  'Heal Spirit': 'Лечебный дух',
  'Giant Snowball': 'Гигантский снежок',
  'Royal Delivery': 'Королевская доставка',
  'Party Rocket': 'Праздничная ракета'
};

// Dota 2: устоявшиеся русские названия (официальная локаль Valve).
const DOTA2_RU = {
  'Anti-Mage': 'Антимаг',
  'Axe': 'Акс',
  'Bane': 'Бэйн',
  'Bloodseeker': 'Кровопийца',
  'Crystal Maiden': 'Кристальная дева',
  'Drow Ranger': 'Дроу-рейнджер',
  'Earthshaker': 'Сотрясатель Земли',
  'Juggernaut': 'Джаггернаут',
  'Mirana': 'Мирана',
  'Morphling': 'Морфлинг',
  'Shadow Fiend': 'Теневой демон',
  'Phantom Lancer': 'Призрачный копейщик',
  'Puck': 'Пак',
  'Pudge': 'Пудж',
  'Razor': 'Рейзор',
  'Sand King': 'Песчаный король',
  'Storm Spirit': 'Дух Бури',
  'Sven': 'Свен',
  'Tiny': 'Тайни',
  'Vengeful Spirit': 'Мстительный дух',
  'Windranger': 'Виндрейнджер',
  'Zeus': 'Зевс',
  'Kunkka': 'Кунка',
  'Lina': 'Лина',
  'Lion': 'Лион',
  'Shadow Shaman': 'Теневой шаман',
  'Slardar': 'Слардар',
  'Tidehunter': 'Тайдхантер',
  'Witch Doctor': 'Знахарь',
  'Lich': 'Лич',
  'Riki': 'Рики',
  'Enigma': 'Энигма',
  'Tinker': 'Тинкер',
  'Sniper': 'Снайпер',
  'Necrophos': 'Некрофос',
  'Warlock': 'Варлок',
  'Beastmaster': 'Повелитель зверей',
  'Queen of Pain': 'Королева боли',
  'Venomancer': 'Веномансер',
  'Faceless Void': 'Безликий',
  'Wraith King': 'Король-призрак',
  'Death Prophet': 'Пророчица смерти',
  'Phantom Assassin': 'Призрачная убийца',
  'Pugna': 'Пугна',
  'Templar Assassin': 'Убийца-храмовница',
  'Viper': 'Випер',
  'Luna': 'Луна',
  'Dragon Knight': 'Драконий рыцарь',
  'Dazzle': 'Дэззл',
  'Clockwerk': 'Кловкверк',
  'Leshrac': 'Лешрак',
  "Nature's Prophet": 'Пророк леса',
  'Lifestealer': 'Похититель жизни',
  'Dark Seer': 'Тёмный провидец',
  'Clinkz': 'Клинкз',
  'Omniknight': 'Омнирыцарь',
  'Enchantress': 'Энчантресс',
  'Huskar': 'Хускар',
  'Night Stalker': 'Ночной охотник',
  'Broodmother': 'Бруд',
  'Bounty Hunter': 'Охотник за головами',
  'Weaver': 'Уивер',
  'Jakiro': 'Джакиро',
  'Batrider': 'Наездник на летучей мыши',
  'Chen': 'Чен',
  'Spectre': 'Спектра',
  'Ancient Apparition': 'Древний призрак',
  'Doom': 'Дум',
  'Ursa': 'Урса',
  'Spirit Breaker': 'Сокрушитель духов',
  'Gyrocopter': 'Гирокоптер',
  'Alchemist': 'Алхимик',
  'Invoker': 'Инвокер',
  'Silencer': 'Сайленсер',
  'Outworld Destroyer': 'Разрушитель миров',
  'Lycan': 'Ликан',
  'Brewmaster': 'Брюмастер',
  'Shadow Demon': 'Теневой демон-2',
  'Lone Druid': 'Друид-одиночка',
  'Chaos Knight': 'Рыцарь хаоса',
  'Meepo': 'Мипо',
  'Treant Protector': 'Древень',
  'Ogre Magi': 'Огр-маг',
  'Undying': 'Андайнг',
  'Rubick': 'Рубик',
  'Disruptor': 'Дисраптор',
  'Nyx Assassin': 'Никс-ассасин',
  'Naga Siren': 'Нага-сирена',
  'Keeper of the Light': 'Хранитель света',
  'Io': 'Ио',
  'Visage': 'Визаж',
  'Slark': 'Сларк',
  'Medusa': 'Медуза',
  'Troll Warlord': 'Тролль-варлорд',
  'Centaur Warrunner': 'Кентавр',
  'Magnus': 'Магнус',
  'Timbersaw': 'Тимберсо',
  'Bristleback': 'Бристлбэк',
  'Tusk': 'Таск',
  'Skywrath Mage': 'Скайрэт-маг',
  'Abaddon': 'Абаддон',
  'Elder Titan': 'Старший титан',
  'Legion Commander': 'Командир легиона',
  'Techies': 'Подрывники',
  'Ember Spirit': 'Дух пламени',
  'Earth Spirit': 'Дух земли',
  'Underlord': 'Андерлорд',
  'Terrorblade': 'Террорблэйд',
  'Phoenix': 'Феникс',
  'Oracle': 'Оракул',
  'Winter Wyvern': 'Зимний виверн',
  'Arc Warden': 'Дуговой страж',
  'Monkey King': 'Король обезьян',
  'Dark Willow': 'Тёмная ива',
  'Pangolier': 'Пангольер',
  'Grimstroke': 'Гримстроук',
  'Hoodwink': 'Худвинк',
  'Void Spirit': 'Дух пустоты',
  'Snapfire': 'Снэпфайр',
  'Mars': 'Марс',
  'Ringmaster': 'Шпрехшталмейстер',
  'Dawnbreaker': 'Рассветница',
  'Marci': 'Марси',
  'Primal Beast': 'Первобытный зверь',
  'Muerta': 'Муэрта',
  'Kez': 'Кез',
  'Largo': 'Ларго'
};

// Английские эквиваленты для остальных паков (где nameEn совпадал с name).
const FILL_EN = {
  // Локации
  'Супермаркет': 'Supermarket',
  'Парк': 'Park',
  // Супергерои
  'Черная пантера': 'Black Panther',
  'Зеленый фонарь': 'Green Lantern',
  // Мультфильмы
  'Симба': 'Simba',
  'Стич': 'Stitch',
  'Пикачу': 'Pikachu',
  'Миньон': 'Minion',
  'Винни-Пух': 'Winnie the Pooh',
  'Эльза': 'Elsa',
  'Молния МакКуин': 'Lightning McQueen',
  'Кунг-фу Панда': 'Kung Fu Panda',
  'Босс-молокосос': 'The Boss Baby',
  // Мемы
  'Нубик': 'Noob',
  'Кот в шоке': 'Shocked Cat',
  'Троллфейс': 'Trollface',
  'Стоникс': 'Stonix',
  'Мистер Бист мем': 'MrBeast Meme',
  'Скала бровь': 'The Rock Eyebrow',
  'Плачущий кот': 'Crying Cat',
  'Ок бумер': 'OK Boomer',
  'Шрек мем': 'Shrek Meme',
  'Сигма': 'Sigma',
  // Эстрада
  'Сергей Лазарев': 'Sergey Lazarev',
  'Zivert': 'Zivert',
  'Jony': 'Jony',
  'Miyagi': 'Miyagi',
  'Лолита': 'Lolita',
  'Валерия': 'Valeriya',
  'Ани Лорак': 'Ani Lorak',
  // Зарубежные звёзды
  'Beyonce': 'Beyoncé',
  'Bruno Mars': 'Bruno Mars',
  'Shakira': 'Shakira',
  // Машины
  'Ferrari LaFerrari': 'Ferrari LaFerrari',
  'Audi RS6': 'Audi RS6',
  'Range Rover': 'Range Rover',
  'Rolls-Royce Phantom': 'Rolls-Royce Phantom',
  // Личности
  'Павел Дуров': 'Pavel Durov',
  'Мистер Бист': 'MrBeast',
  'Джеки Чан': 'Jackie Chan',
  'Дуэйн Джонсон': 'Dwayne Johnson',
  'Уолт Дисней': 'Walt Disney',
  // Сериалы
  'Шерлок': 'Sherlock',
  'Офис': 'The Office',
  'Доктор Хаус': 'House M.D.',
  'Симпсоны': 'The Simpsons',
  'Черное зеркало': 'Black Mirror',
  'Сверхъестественное': 'Supernatural',
  // Футбольные клубы
  'Наполи': 'Napoli',
  // Автоблогеры
  'AcademeG': 'AcademeG',
  'Булкин': 'Bulkin',
  'SmotraTV': 'SmotraTV',
  'Игорь Бурцев': 'Igor Burtsev',
  'Антон Воротников': 'Anton Vorotnikov',
  'Лиса Рулит': 'Lisa Rulit',
  'Clickoncar': 'Clickoncar',
  'Максим Шелков': 'Maxim Shelkov',
  'Garage 54': 'Garage 54',
  'Wylsacar': 'Wylsacar',
  'Асафьев Стас': 'Stas Asafyev',
  'DRIVE2': 'DRIVE2',
  // Еда
  'Стейк': 'Steak',
  'Паста': 'Pasta',
  'Хот-дог': 'Hot Dog',
  'Мороженое': 'Ice Cream',
  'Шоколад': 'Chocolate',
  'Торт': 'Cake',
  // Животные
  'Лиса': 'Fox',
  'Кот': 'Cat',
  'Собака': 'Dog',
  'Жираф': 'Giraffe',
  'Обезьяна': 'Monkey',
  // Блогеры СНГ
  'Даня Милохин': 'Danya Milokhin',
  'Егорик': 'Egorik',
  'А4 команда': 'A4 Team',
  'Куплинов': 'Kuplinov',
  'Брайан Мапс': 'Brian Maps',
  'Литвин': 'Litvin',
  'Некоглай': 'Nekoglai',
  'Елена Райтман': 'Elena Raytman',
  'Саша Спилберг': 'Sasha Spielberg',
  'Катя Клэп': 'Katya Klap',
  'Дима Масленников': 'Dima Maslennikov',
  // Бренды
  'Microsoft': 'Microsoft',
  'Sony': 'Sony',
  'PlayStation': 'PlayStation',
  'Netflix': 'Netflix',
  // TikTok
  'Эддисон Рэй': 'Addison Rae',
  'Зак Кинг': 'Zach King',
  'Лорен Грей': 'Loren Gray',
  'Дикси Дамелио': 'Dixie D’Amelio',
  'Спенсер Икс': 'Spencer X',
  'Брент Ривера': 'Brent Rivera',
  'Домелик': 'Domelik',
  'Рахим Абрамов': 'Rakhim Abramov',
  'Дина Саева': 'Dina Saeva',
  'Валя Карнавал': 'Valya Karnaval',
  'Аня Покров': 'Anya Pokrov',
  'Артур Бабич': 'Artur Babich'
};

const ENGLISH_PRIMARY_PACKS = new Set(['brawl-stars', 'clash-royale', 'dota-2']);
const TRANSLATION_MAPS = {
  'brawl-stars': BRAWL_STARS_RU,
  'clash-royale': CLASH_ROYALE_RU,
  'dota-2': DOTA2_RU
};

function transformPack(pack) {
  const titleEn = PACK_TITLE_EN[pack.id] || pack.title;
  const newPack = {
    id: pack.id,
    title: pack.title,
    titleEn,
    emoji: pack.emoji,
    cover: pack.cover,
    free: Boolean(pack.free),
    cards: pack.cards.map((card) => transformCard(card, pack))
  };
  return newPack;
}

function transformCard(card, pack) {
  let name = card.name;
  let nameEn = card.nameEn || card.name;

  if (ENGLISH_PRIMARY_PACKS.has(pack.id)) {
    const map = TRANSLATION_MAPS[pack.id];
    const ru = map && map[card.name];
    if (ru) {
      name = ru;
      nameEn = card.name;
    }
  } else if (nameEn === name) {
    const fill = FILL_EN[name];
    if (fill) nameEn = fill;
  }

  return { id: card.id, name, image: card.image, nameEn };
}

function stringify(packs) {
  // Воспроизводим оригинальный стиль форматирования.
  const lines = ['const PACKS = ['];
  packs.forEach((pack, i) => {
    lines.push('  {');
    lines.push(`    "id": ${JSON.stringify(pack.id)},`);
    lines.push(`    "title": ${JSON.stringify(pack.title)},`);
    lines.push(`    "titleEn": ${JSON.stringify(pack.titleEn)},`);
    lines.push(`    "emoji": ${JSON.stringify(pack.emoji)},`);
    lines.push(`    "cover": ${JSON.stringify(pack.cover)},`);
    lines.push(`    "free": ${pack.free},`);
    lines.push('    "cards": [');
    pack.cards.forEach((card, j) => {
      lines.push('      {');
      lines.push(`        "id": ${JSON.stringify(card.id)},`);
      lines.push(`        "name": ${JSON.stringify(card.name)},`);
      lines.push(`        "image": ${JSON.stringify(card.image)},`);
      lines.push(`        "nameEn": ${JSON.stringify(card.nameEn)}`);
      lines.push(`      }${j === pack.cards.length - 1 ? '' : ','}`);
    });
    lines.push('    ]');
    lines.push(`  }${i === packs.length - 1 ? '' : ','}`);
  });
  lines.push('];');
  lines.push('');
  lines.push('module.exports = { PACKS };');
  lines.push('');
  return lines.join('\n');
}

function main() {
  const transformed = PACKS.map(transformPack);

  // Sanity-check: какие карты остались без перевода в EN-only паках
  const missing = [];
  for (const pack of transformed) {
    if (!ENGLISH_PRIMARY_PACKS.has(pack.id)) continue;
    for (const card of pack.cards) {
      if (card.name === card.nameEn) missing.push(`${pack.id}: ${card.name}`);
    }
  }
  if (missing.length) {
    console.warn('[warn] Untranslated cards (kept English as Russian):');
    missing.forEach((m) => console.warn('  ' + m));
  }

  const output = stringify(transformed);
  const target = path.join(__dirname, '..', 'data', 'packs.js');
  fs.writeFileSync(target, output);
  console.log(`Wrote ${transformed.length} packs, ${transformed.reduce((s, p) => s + p.cards.length, 0)} cards.`);
}

main();
