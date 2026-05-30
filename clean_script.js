const fs = require('fs');
const filePath = 'crazygamesport/script.js';
let content = fs.readFileSync(filePath, 'utf8');

// 1. Telegram init block
content = content.replace(
/const tg = window\.Telegram && window\.Telegram\.WebApp;\s*if \(tg\) \{\s*try \{\s*tg\.ready\(\);\s*tg\.expand\(\);\s*\} catch \(\_\) \{\}\s*\}\s*const tgUser = tg && tg\.initDataUnsafe && tg\.initDataUnsafe\.user;/g,
'// Platform: CrazyGames (no Telegram dependency)\nconst tg = null;\nconst tgUser = null;'
);

// 2. initialPlayerId
content = content.replace(
/const initialPlayerId = tgUser\s*\?\s*tgUser\.id\s*:\s*Number\(localStorage\.getItem\(ID_KEY\)\) \|\| null;/g,
'const initialPlayerId = Number(localStorage.getItem(ID_KEY)) || null;'
);

// 3. state name
content = content.replace(
/name: tgUser\s*\?\s*tgUser\.first_name \+ \(tgUser\.last_name \? " " \+ tgUser\.last_name : ""\)\s*:\s*localStorage\.getItem\(NAME_KEY\) \|\|\s*Игрок \$\{Math\.floor\(Math\.random\(\) \* 900 \+ 100\)\}/g,
'name: localStorage.getItem(NAME_KEY) || Игрок {Math.floor(Math.random() * 900 + 100)}'
);

// 4. API header
content = content.replace(
/\s*if \(tg && tg\.initData\) headers\["X-Telegram-Init-Data"\] = tg\.initData;/g,
''
);

// 5. HapticFeedback error/success (in toast)
content = content.replace(
/\s*try \{\s*if \(\s*window\.Telegram &&\s*window\.Telegram\.WebApp &&\s*window\.Telegram\.WebApp\.HapticFeedback\s*\) \{\s*window\.Telegram\.WebApp\.HapticFeedback\.notificationOccurred\(\s*variant === "error" \? "error" : "success",?\s*\);\s*\}\s*\} catch \(\_\) \{\}/g,
''
);

// 6. Theme setHeaderColor
content = content.replace(
/\s*try \{\s*if \(window\.Telegram && window\.Telegram\.WebApp\) \{\s*window\.Telegram\.WebApp\.setHeaderColor &&\s*window\.Telegram\.WebApp\.setHeaderColor\(\s*theme === "light" \? "#f3eefd" : "#0b0b14",?\s*\);\s*window\.Telegram\.WebApp\.setBackgroundColor &&\s*window\.Telegram\.WebApp\.setBackgroundColor\(\s*theme === "light" \? "#f3eefd" : "#0a0a14",?\s*\);\s*\}\s*\} catch \(\_\) \{\}/g,
''
);

// 7. PAGE_SUBTITLES shop
content = content.replace(
/\s*shop: "Косметика, темы и премиум",/g,
''
);

// 8. HapticFeedback selectionChanged
content = content.replace(
/\s*try \{\s*if \(\s*window\.Telegram &&\s*window\.Telegram\.WebApp &&\s*window\.Telegram\.WebApp\.HapticFeedback\s*\) \{\s*window\.Telegram\.WebApp\.HapticFeedback\.selectionChanged\(\);\s*\}\s*\} catch \(\_\) \{\}/g,
''
);

// 9. telegramId: tgUser ? tgUser.id : undefined,
content = content.replace(
/\s*telegramId: tgUser \? tgUser\.id : undefined,/g,
''
);

// 10. tgPhotoUrl
content = content.replace(
/function tgPhotoUrl\(\) \{\s*return tgUser && tgUser\.photo_url \? tgUser\.photo_url : null;\s*\}/g,
'function tgPhotoUrl() { return null; }'
);

// 11. buildAvatarGrid remove photo
content = content.replace(
/const photo = tgPhotoUrl\(\);\s*const items = \[\];\s*if \(photo\) \{\s*items\.push\(\{ id: "tg-photo", url: photo, isTelegram: true \}\);\s*\}/g,
'const items = [];'
);

// 12. HapticFeedback (success)
content = content.replace(
/\s*try \{\s*if \(\s*window\.Telegram &&\s*window\.Telegram\.WebApp &&\s*window\.Telegram\.WebApp\.HapticFeedback\s*\) \{\s*window\.Telegram\.WebApp\.HapticFeedback\.notificationOccurred\("success"\);\s*\}\s*\} catch \(\_\) \{\}/g,
''
);

fs.writeFileSync(filePath, content, 'utf8');
console.log('Script cleanup done');
