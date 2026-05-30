const fs = require('fs');
let html = fs.readFileSync('crazygamesport/index.html', 'utf8');

// The exact phrase is "Закинуть звёзд"
// Let's find the start of the card div that contains this
const startIndex = html.indexOf('<div\n                        class="card premium-card animate-pop"');
if (startIndex !== -1) {
    const endStr = '</div>\n                    </div>\n\n                    <!-- PROFILE STATS -->';
    const endIndex = html.indexOf('<!-- PROFILE STATS -->', startIndex);
    
    if (endIndex !== -1) {
        // We want to delete up to just before <!-- PROFILE STATS -->
        const before = html.substring(0, startIndex);
        const after = html.substring(endIndex);
        fs.writeFileSync('crazygamesport/index.html', before + after, 'utf8');
        console.log("Successfully removed premium card by substring!");
    } else {
        console.log("Could not find end of premium card");
    }
} else {
    console.log("Could not find start of premium card. Let's try another way.");
    // Fallback regex
    const regex = /<div[^>]*class="card premium-card[^>]*>[\s\S]*?Закинуть звёзд[\s\S]*?<\/div>\s*<\/div>\s*/;
    if (regex.test(html)) {
        html = html.replace(regex, '');
        fs.writeFileSync('crazygamesport/index.html', html, 'utf8');
        console.log("Successfully removed via regex");
    } else {
        console.log("Regex also failed to find it. Dumping context:");
        const idx = html.indexOf('Закинуть звёзд');
        if (idx !== -1) {
            console.log(html.substring(Math.max(0, idx - 200), idx + 200));
        } else {
            console.log("Phrase not found at all. It must be gone.");
        }
    }
}
