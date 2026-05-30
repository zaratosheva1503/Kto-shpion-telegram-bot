const fs = require('fs');
let appExtras = fs.readFileSync('crazygamesport/app-extras.js', 'utf8');

appExtras = appExtras.replace(/window\.Friends = \{ /g, 'const Friends = window.Friends = { ');
appExtras = appExtras.replace(/window\.Me = \{ /g, 'const Me = window.Me = { ');

fs.writeFileSync('crazygamesport/app-extras.js', appExtras, 'utf8');
