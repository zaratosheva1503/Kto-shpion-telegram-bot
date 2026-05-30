const fs = require('fs');
const filePath = 'crazygamesport/index.html';
let content = fs.readFileSync(filePath, 'utf8');

// Remove admin.js script tag
content = content.replace(
/<script src="admin\.js"><\/script>\s*/g,
''
);

fs.writeFileSync(filePath, content, 'utf8');
console.log('Removed admin.js from index.html');
