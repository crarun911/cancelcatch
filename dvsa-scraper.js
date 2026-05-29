const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

async function checkDVSA(centreName, dateFrom, dateTo, timePref) {
  let browser;
  try {
    console.log(`    Launching browser for ${centreName}...`);
    browser = await puppeteer.launch({
      headless: true,
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu'
      ]
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });

    // Try the availability page directly
    const url = 'https://driverpracticaltest.dvsa.gov.uk/availability';
    console.log(`    Navigating to ${url}...`);

    await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 60000
    });

    // Wait for challenge to resolve
    await new Promise(r => setTimeout(r, 5000));

    const title = await page.title();
    const content = await page.content();
    console.log(`    Title: ${title}`);
    console.log(`    Length: ${content.length}`);
    console.log(`    Snippet: ${content.slice(0, 400)}`);

    await browser.close();
    return [];

  } catch (err) {
    if (browser) await browser.close();
    console.error(`    Error: ${err.message}`);
    return [];
  }
}

module.exports = { checkDVSA };