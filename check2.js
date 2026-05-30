const fs = require('fs');

const scriptJs = fs.readFileSync('crazygamesport/script.js', 'utf8');
const appExtras = fs.readFileSync('crazygamesport/app-extras.js', 'utf8');

if (scriptJs.includes('const items = [];\n  const items = [];')) {
    console.log('Duplicate items array');
}

