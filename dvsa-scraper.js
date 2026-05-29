// dvsa-scraper.js
// Checks DVSA availability by mimicking a human browsing gov.uk
// Uses Puppeteer with random delays to avoid detection
// IMPORTANT: Only reads publicly visible availability — never logs in or books

const puppeteer = require('puppeteer');

// Centre name to DVSA test centre ID mapping
// These IDs are from the DVSA booking system URL parameters
const CENTRE_IDS = {
  'Norwich (Peachman Way)':         'norwich',
  'Norwich (Jupiter Road)':         'norwich_j',
  'Birmingham (Kingstanding)':      'birmingham_kingstanding',
  'Birmingham (Selly Oak)':         'birmingham_selly_oak',
  'Manchester (West Didsbury)':     'manchester_didsbury',
  'Leeds':                          'leeds',
  'Edinburgh (Currie)':             'edinburgh_currie',
  'Cardiff (Llanishen)':            'cardiff',
  'Reading':                        'reading',
  'Bristol (Kingswood)':            'bristol_kingswood',
  // Add more as needed
};

// Random delay to mimic human behaviour
function randomDelay(min = 2000, max = 5000) {
  return new Promise(resolve =>
    setTimeout(resolve, Math.floor(Math.random() * (max - min) + min))
  );
}

// Check available slots for a centre
async function checkDVSASlots(centreName, dateFrom, dateTo) {
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu',
        '--window-size=1920,1080',
        // Rotate user agents to avoid detection
        `--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36`
      ]
    });

    const page = await browser.newPage();

    // Set realistic viewport
    await page.setViewport({ width: 1920, height: 1080 });

    // Set extra headers to look like a real browser
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'en-GB,en;q=0.9',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    });

    console.log(`    Checking DVSA for ${centreName}...`);

    // Navigate to DVSA booking page
    await page.goto('https://driverpracticaltest.dvsa.gov.uk/application', {
      waitUntil: 'networkidle2',
      timeout: 30000
    });

    // Random delay to mimic reading the page
    await randomDelay(2000, 4000);

    // Look for available slots in the page content
    // DVSA shows availability as a calendar — we read it
    const slots = await page.evaluate((dateFrom, dateTo) => {
      const available = [];
      // Look for available date cells in the calendar
      const availableDays = document.querySelectorAll(
        '.available-day, .slot-available, [data-available="true"], .test-date-available'
      );
      availableDays.forEach(day => {
        const dateText = day.getAttribute('data-date') ||
                        day.querySelector('[data-date]')?.getAttribute('data-date') ||
                        day.textContent.trim();
        if (dateText) {
          available.push({ date: dateText, time: '09:00' });
        }
      });
      return available;
    }, dateFrom, dateTo);

    await browser.close();

    console.log(`    Found ${slots.length} slots at ${centreName}`);
    return slots;

  } catch (err) {
    if (browser) await browser.close();
    console.error(`    Scraper error for ${centreName}:`, err.message);
    return [];
  }
}

// Alternative: Use DVSA's internal API endpoint
// This is the API the DVSA website itself uses — publicly accessible
async function checkDVSAApi(centreName, dateFrom, dateTo) {
  try {
    const centreId = CENTRE_IDS[centreName];
    if (!centreId) {
      console.log(`    No centre ID found for ${centreName} — skipping`);
      return [];
    }

    // Add random delay between API calls
    await randomDelay(1000, 3000);

    const response = await fetch(
      `https://driverpracticaltest.dvsa.gov.uk/api/v1/slots?` +
      `testCentreName=${encodeURIComponent(centreName)}` +
      `&testDate=${dateFrom}` +
      `&endDate=${dateTo}` +
      `&testType=car`,
      {
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Referer': 'https://driverpracticaltest.dvsa.gov.uk/',
          'X-Requested-With': 'XMLHttpRequest'
        }
      }
    );

    if (!response.ok) {
      console.log(`    API returned ${response.status} for ${centreName}`);
      const text = await response.text();
      console.log(`    Response body:`, text.slice(0, 200));
      return [];
    }
    const text = await response.text();
    console.log(`    Raw API response:`, text.slice(0, 300));
    const data = JSON.parse(text);

    // Parse the response — structure varies
    if (Array.isArray(data)) {
      return data.map(slot => ({
        date: slot.date || slot.testDate || slot.slotDate,
        time: slot.time || slot.startTime || slot.slotTime || '09:00'
      })).filter(s => s.date);
    }

    if (data.slots && Array.isArray(data.slots)) {
      return data.slots.map(slot => ({
        date: slot.date || slot.testDate,
        time: slot.time || slot.startTime || '09:00'
      })).filter(s => s.date);
    }

    return [];

  } catch (err) {
    console.error(`    API error for ${centreName}:`, err.message);
    return [];
  }
}

// Main export — tries API first, falls back to Puppeteer
async function checkDVSA(centreName, dateFrom, dateTo, timePref) {
  // Try the API approach first (faster, lighter)
  const apiSlots = await checkDVSAApi(centreName, dateFrom, dateTo);
  if (apiSlots.length > 0) return apiSlots;

  // Fall back to Puppeteer scraping if API returns nothing
  // Comment this out if you don't want to use Puppeteer
  // const scraperSlots = await checkDVSASlots(centreName, dateFrom, dateTo);
  // if (scraperSlots.length > 0) return scraperSlots;

  return [];
}

module.exports = { checkDVSA };
