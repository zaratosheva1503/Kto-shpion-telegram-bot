const fs = require('fs');
let content = fs.readFileSync('crazygamesport/script.js', 'utf8');

// Replace the Telegram share fallback with pure clipboard copy or SDK invite
content = content.replace(
/else\s*\{\s*\/\/\s*Telegram share fallback[\s\S]*?window\.open\(tgUrl, "_blank"\);\s*\}/g,
'else await navigator.clipboard.writeText(url).then(() => toast("Ссылка скопирована!", "success"));'
);

content = content.replace(
/else\s*const tgUrl = https:\/\/t\.me\/share\/url\?url=\$\{encodeURIComponent\(url\)\}&text=\$\{encodeURIComponent\(Заходи ко мне в комнату \$\{state\.room\.code\}\)\};[\s\S]*?window\.open\(tgUrl, "_blank"\);/g,
'else await navigator.clipboard.writeText(url).then(() => toast("Ссылка скопирована!", "success"));'
);

// If it doesn't match, let's use a simpler regex
content = content.replace(
/const tgUrl = https:\/\/t\.me\/share[^]+[^;]+;\s*window\.open\(tgUrl, "_blank"\);/g,
'await navigator.clipboard.writeText(url).then(() => toast("Ссылка скопирована!", "success"));'
);

fs.writeFileSync('crazygamesport/script.js', content, 'utf8');
console.log('Share link fixed');
