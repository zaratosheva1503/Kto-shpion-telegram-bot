const fs = require('fs');

// Remove wrapper from app-extras.js
let appExtras = fs.readFileSync('crazygamesport/app-extras.js', 'utf8');
appExtras = appExtras.replace(
/const origSwitch = window\.switchPage;[\s\S]*?if \(typeof origSwitch === "function"\) \{[\s\S]*?window\.switchPage = function \(name\) \{[\s\S]*?origSwitch\(name\);[\s\S]*?if \(name === "friends"\) Friends\.refresh\(\);[\s\S]*?if \(name === "profile"\) Me\.refresh\(\);[\s\S]*?\};[\s\S]*?\}/g,
''
);
fs.writeFileSync('crazygamesport/app-extras.js', appExtras, 'utf8');

// Add refresh calls to script.js switchPage
let scriptJs = fs.readFileSync('crazygamesport/script.js', 'utf8');
scriptJs = scriptJs.replace(
/if \(name === "home"\) showMainUI\(\);/g,
'if (name === "home") showMainUI();\n  if (name === "friends" && window.Friends) window.Friends.refresh();\n  if (name === "profile" && window.Me) window.Me.refresh();'
);
fs.writeFileSync('crazygamesport/script.js', scriptJs, 'utf8');

console.log("Switchpage fixed");
