const fs = require('fs');
let appExtras = fs.readFileSync('crazygamesport/app-extras.js', 'utf8');

if (!appExtras.includes('window.Friends = Friends')) {
    appExtras = appExtras.replace(
        /const Friends = \{/g,
        'window.Friends = { '
    ).replace(/const Me = \{/g, 'window.Me = { ');
    fs.writeFileSync('crazygamesport/app-extras.js', appExtras, 'utf8');
}
