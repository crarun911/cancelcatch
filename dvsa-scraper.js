// dvsa-scraper.js
// Checks DVSA availability using their internal API
// IMPORTANT: Only reads publicly visible availability — never logs in or books

const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());
// Random delay to mimic human behaviour
function randomDelay(min = 1000, max = 3000) {
  return new Promise(resolve =>
    setTimeout(resolve, Math.floor(Math.random() * (max - min) + min))
  );
}

// Main function — uses Puppeteer to check DVSA availability
async function checkDVSA(centreName, dateFrom, dateTo, timePref) {
  let browser;
  try {
    console.log(`    Launching browser for ${centreName}...`);

    const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH || null;

    browser = await puppeteer.launch({
      headless: true,
      executablePath: executablePath || undefined,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--window-size=1280,800',
      ]
    });

    const page = await browser.newPage();

    // Set realistic user agent
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );
    await page.setViewport({ width: 1280, height: 800 });

    // Intercept API calls made by the DVSA website
    const slots = [];
    page.on('response', async response => {
      const url = response.url();
      if (url.includes('availableSlots') || url.includes('slots') || url.includes('availability')) {
        try {
          const data = await response.json();
          console.log(`    Intercepted API: ${url.slice(0, 80)}`);
          console.log(`    Data preview: ${JSON.stringify(data).slice(0, 200)}`);
          if (Array.isArray(data)) slots.push(...data);
          else if (data.slots) slots.push(...data.slots);
        } catch (e) { /* not JSON */ }
      }
    });

    console.log(`    Navigating to DVSA booking page...`);
    await page.goto('https://driverpracticaltest.dvsa.gov.uk/application', {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });

    console.log(`    Page title: ${await page.title()}`);
    await randomDelay(2000, 3000);

    // Get page content to understand the structure
    const content = await page.content();
    console.log(`    Page length: ${content.length} chars`);
    console.log(`    Page snippet: ${content.slice(0, 300)}`);

    await browser.close();

    if (slots.length > 0) {
      console.log(`    Found ${slots.length} slots via API interception`);
      return slots.map(s => ({
        date: s.date || s.testDate || s.slotDate || '',
        time: s.time || s.startTime || s.slotTime || '09:00'
      })).filter(s => s.date);
    }

    console.log(`    No slots found at ${centreName}`);
    return [];

  } catch (err) {
    if (browser) await browser.close();
    console.error(`    Scraper error for ${centreName}:`, err.message);
    return [];
  }
}

module.exports = { checkDVSA };
