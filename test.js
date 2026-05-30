const puppeteer = require('puppeteer');
const path = require('path');

(async () => {
    const browser = await puppeteer.launch();
    const page = await browser.newPage();
    
    page.on('console', msg => {
        if (msg.type() === 'error' || msg.text().includes('Maximum call stack size') || msg.text().includes('TOAST FIRED')) {
            console.log(msg.text());
            if (msg.stackTrace().length > 0) {
                console.log('STACK:');
                msg.stackTrace().forEach(s => {
                    console.log(  at ::);
                });
            }
        }
    });

    page.on('pageerror', err => {
        console.log('Page error:', err.message);
        console.log(err.stack);
    });

    const fileUrl = 'file:///' + path.resolve('crazygamesport/index.html').replace(/\\/g, '/');
    console.log("Navigating to", fileUrl);
    await page.goto(fileUrl);
    
    // Wait for 2 seconds to let any loops trigger
    await new Promise(r => setTimeout(r, 2000));
    
    await browser.close();
})();
