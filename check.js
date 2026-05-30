const fs = require('fs');

try {
    const html = fs.readFileSync('crazygamesport/index.html', 'utf8');
    const idx = html.indexOf('premium-card');
    if (idx !== -1) {
        console.log('premium-card found at index', idx);
        console.log(html.substring(Math.max(0, idx - 100), idx + 500));
    } else {
        console.log('premium-card not found');
    }
} catch(e) { console.error(e); }
