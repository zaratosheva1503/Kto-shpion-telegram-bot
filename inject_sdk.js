const fs = require('fs');
const filePath = 'crazygamesport/script.js';
let content = fs.readFileSync(filePath, 'utf8');

// Inject spyGameplayStop into showMainUI
content = content.replace(
/function showMainUI\(\) \{/,
'function showMainUI() {\n  if (window.spyGameplayStop) window.spyGameplayStop();'
);

// Inject spyGameplayStop into showLobbyUI
content = content.replace(
/function showLobbyUI\(\) \{/,
'function showLobbyUI() {\n  if (window.spyGameplayStop) window.spyGameplayStop();'
);

// Inject spyGameplayStart into showGameUI
content = content.replace(
/function showGameUI\(\) \{/,
'function showGameUI() {\n  if (window.spyGameplayStart) window.spyGameplayStart();'
);

// Inject spyGameplayStop into showMatchmakingUI
content = content.replace(
/function showMatchmakingUI\(\) \{/,
'function showMatchmakingUI() {\n  if (window.spyGameplayStop) window.spyGameplayStop();'
);

// Inject ads into nextRound and backToLobby
content = content.replace(
/async function nextRound\(\) \{\s*if \(\!state\.room\) return;/,
'async function nextRound() {\n  if (window.spyShowMidgameAd) await window.spyShowMidgameAd();\n  if (!state.room) return;'
);

content = content.replace(
/async function backToLobby\(\) \{\s*if \(\!state\.room\) return;/,
'async function backToLobby() {\n  if (window.spyShowMidgameAd) await window.spyShowMidgameAd();\n  if (!state.room) return;'
);

fs.writeFileSync(filePath, content, 'utf8');
console.log('Script injection done');
