const fs = require('fs');
let scriptJs = fs.readFileSync('crazygamesport/script.js', 'utf8');

scriptJs = scriptJs.replace(
/function toast\(message, variant = "", duration = 2400\) \{/,
'function toast(message, variant = "", duration = 2400) {\n  console.log("TOAST FIRED:", message);\n  console.trace();'
);

fs.writeFileSync('crazygamesport/script.js', scriptJs, 'utf8');
console.log("Injected trace into toast");
