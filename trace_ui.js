const fs = require('fs');
let scriptJs = fs.readFileSync('crazygamesport/script.js', 'utf8');

scriptJs = scriptJs.replace(
/function toast\(message, variant = "", duration = 2400\) \{/,
'function toast(message, variant = "", duration = 2400) {\n  if(message.includes("Maximum call stack")) {\n    const err = new Error();\n    const pre = document.createElement("pre");\n    pre.style.position = "fixed";\n    pre.style.zIndex = 9999;\n    pre.style.background = "red";\n    pre.textContent = err.stack;\n    document.body.appendChild(pre);\n    return;\n  }'
);

fs.writeFileSync('crazygamesport/script.js', scriptJs, 'utf8');
console.log("Injected UI stack trace into toast");
