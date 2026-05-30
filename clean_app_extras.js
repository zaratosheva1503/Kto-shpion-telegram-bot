const fs = require('fs');
const filePath = 'crazygamesport/app-extras.js';
let content = fs.readFileSync(filePath, 'utf8');

// 1. Telegram init
content = content.replace(
/\(function \(\) \{\s*const tg = window\.Telegram && window\.Telegram\.WebApp;\s*const tgUser = tg && tg\.initDataUnsafe && tg\.initDataUnsafe\.user;/g,
'(function () {\n  const tg = null;\n  const tgUser = null;'
);

// 2. API header
content = content.replace(
/\s*if \(tg && tg\.initData\) headers\["X-Telegram-Init-Data"\] = tg\.initData;/g,
''
);

// 3. username from tgUser
content = content.replace(
/name: s\.name,\s*username: \(tgUser && tgUser\.username\) \|\| null,/g,
'name: s.name,'
);

// 4. donation/purchase handlers
content = content.replace(
/\s*sock\.on\("donation:success", \(\{ stars, user, full \}\) => \{[\s\S]*?Shop\.refreshOwned\(\);\s*\}\);\s*sock\.on\("purchase:success", \(\{ stars, itemId, user, full \}\) => \{[\s\S]*?Shop\.refreshOwned\(\);\s*\}\);/g,
''
);

// 5. isPremiumActive
content = content.replace(
/isPremiumActive\(\) \{\s*return Boolean\(\s*this\.full && this\.full\.premium && this\.full\.premiumUntil > Date\.now\(\),?\s*\);\s*\}/g,
'isPremiumActive() { return false; }'
);

// 6. Premium UI
content = content.replace(
/\s*\/\/\s*Premium status\s*const ps = \$\("premium-status"\);[\s\S]*?this\.isPremiumActive\(\),\s*\);/g,
''
);

// 7. HapticFeedback instances
content = content.replace(
/\s*try \{\s*if \(\s*window\.Telegram &&\s*window\.Telegram\.WebApp &&\s*window\.Telegram\.WebApp\.HapticFeedback\s*\)\s*window\.Telegram\.WebApp\.HapticFeedback\.notificationOccurred\("success"\);\s*\} catch \(\_\) \{\}/g,
''
);
content = content.replace(
/\s*try \{\s*if \(\s*window\.Telegram &&\s*window\.Telegram\.WebApp &&\s*window\.Telegram\.WebApp\.HapticFeedback\s*\) \{\s*window\.Telegram\.WebApp\.HapticFeedback\.notificationOccurred\("success"\);\s*\}\s*\} catch \(\_\) \{\}/g,
''
);
content = content.replace(
/\s*try \{\s*if \(\s*window\.Telegram &&\s*window\.Telegram\.WebApp &&\s*window\.Telegram\.WebApp\.HapticFeedback\s*\) \{\s*window\.Telegram\.WebApp\.HapticFeedback\.impactOccurred\("light"\);\s*\}\s*\} catch \(\_\) \{\}/g,
''
);

// 8. SHOP and DONATIONS sections
content = content.replace(
/\s*\/\/ ===================== SHOP =====================[\s\S]*?function openInvoiceLink\(link\) \{[\s\S]*?location\.href = link;\s*\}\s*\}/g,
'\n\n  // Shop and donations removed for CrazyGames port'
);

// 9. switchPage hook for shop
content = content.replace(
/\s*if \(name === "shop"\) Shop\.refresh\(\);/g,
''
);

fs.writeFileSync(filePath, content, 'utf8');
console.log('App extras cleanup done');
