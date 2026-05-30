const fs = require('fs');
let html = fs.readFileSync('crazygamesport/index.html', 'utf8');

const regex = /<div\s+class="card premium-card[^>]*id="premium-card"[\s\S]*?id="premium-status"[^>]*><\/small>\s*<\/div>/;
if (regex.test(html)) {
    html = html.replace(regex, '');
    fs.writeFileSync('crazygamesport/index.html', html, 'utf8');
    console.log("Regex matched and removed premium card!");
} else {
    console.log("Regex did not match. Let's find index of 'premium-card'");
    const idx = html.indexOf('premium-card');
    console.log(html.substring(Math.max(0, idx - 100), idx + 1000));
}
