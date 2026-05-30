const fs = require('fs');

function cleanHtml(filePath) {
    let content = fs.readFileSync(filePath, 'utf8');

    // 1. Remove credit card
    content = content.replace(/<a\s+class="credit-card[\s\S]*?<\/a>\s*/, '');

    // 2. Remove premium card
    content = content.replace(/<div\s+class="card premium-card[\s\S]*?id="premium-card">[\s\S]*?<\/div>\s*<\/div>\s*/, '');

    // 3. Remove SHOP page
    content = content.replace(/<!-- SHOP -->\s*<section class="page" data-page="shop" id="page-shop">[\s\S]*?<\/section>\s*/, '');

    // 4. Remove shop nav item
    content = content.replace(/<button class="nav-item" data-tab="shop" type="button">\s*<span class="nav-icon">🛍<\/span>\s*<span class="nav-label">Магазин<\/span>\s*<\/button>\s*/, '');

    // 5. Remove donate modal
    content = content.replace(/<!-- Donation modal "На покушать" -->\s*<div\s+class="donate-modal[\s\S]*?<!-- Reaction picker/g, '<!-- Reaction picker');

    // 6. Admin stats: total stars
    content = content.replace(/<div class="admin-stat">\s*<span>⭐<\/span><strong data-admin-stat="totalStars">0<\/strong><small>звёзд<\/small>\s*<\/div>\s*/, '');

    // 7. Admin user stats: premium
    content = content.replace(/<span>премиум <b id="admin-selected-premium">нет<\/b><\/span>\s*/, '');

    // 8. Admin card: Premium
    content = content.replace(/<div class="admin-card">\s*<h3>Премиум<\/h3>[\s\S]*?<\/div>\s*<div class="admin-card">\s*<h3>Косметика<\/h3>/g, '<div class="admin-card">\n                            <h3>Косметика</h3>');

    // 9. Admin card: Cosmetics
    content = content.replace(/<div class="admin-card">\s*<h3>Косметика<\/h3>[\s\S]*?<\/div>\s*<div class="admin-card">\s*<h3>Статистика/g, '<div class="admin-card">\n                            <h3>Статистика');

    fs.writeFileSync(filePath, content, 'utf8');
    console.log('HTML cleanup done');
}

cleanHtml('crazygamesport/index.html');
