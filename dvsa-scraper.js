// dvsa-scraper.js
// Uses ScraperAPI to bypass DVSA bot protection
// ScraperAPI handles proxies and JS rendering automatically

const SCRAPER_API_KEY = process.env.SCRAPER_API_KEY;

function scraperUrl(targetUrl) {
  return `http://api.scraperapi.com?api_key=${SCRAPER_API_KEY}&url=${encodeURIComponent(targetUrl)}&render=true&country_code=gb`;
}

function randomDelay(min = 1000, max = 3000) {
  return new Promise(resolve =>
    setTimeout(resolve, Math.floor(Math.random() * (max - min) + min))
  );
}

async function checkDVSA(centreName, dateFrom, dateTo, timePref) {
  try {
    console.log(`    Checking DVSA for ${centreName} via ScraperAPI...`);

    if (!SCRAPER_API_KEY) {
      console.error('    SCRAPER_API_KEY not set!');
      return [];
    }

    // Step 1 — Load the DVSA booking start page
    const startUrl = 'https://driverpracticaltest.dvsa.gov.uk/application';
    console.log(`    Fetching: ${startUrl}`);

    const response = await fetch(scraperUrl(startUrl), {
      timeout: 60000
    });

    console.log(`    ScraperAPI status: ${response.status}`);

    if (!response.ok) {
      const errorText = await response.text();
      console.log(`    ScraperAPI error: ${response.status}`);
      console.log(`    Error details: ${errorText.slice(0, 300)}`);
      return [];
    }

    const html = await response.text();
    console.log(`    Page length: ${html.length} chars`);
    console.log(`    Snippet: ${html.slice(0, 400)}`);

    // Check if we got past bot protection
    if (html.includes('Incapsula') || html.includes('NOINDEX, NOFOLLOW')) {
      console.log(`    Still blocked by bot protection`);
      return [];
    }

    // Step 2 — Look for available slots in the page
    // DVSA shows a calendar with available dates
    const slots = parseSlots(html, dateFrom, dateTo, timePref);
    console.log(`    Found ${slots.length} matching slots`);
    return slots;

  } catch (err) {
    console.error(`    ScraperAPI error: ${err.message}`);
    return [];
  }
}

function parseSlots(html, dateFrom, dateTo, timePref) {
  const slots = [];

  try {
    // Look for date patterns in the HTML
    // DVSA uses various formats — we try multiple patterns
    
    // Pattern 1: JSON data embedded in page
    const jsonMatch = html.match(/availableSlots['":\s]+(\[.*?\])/s);
    if (jsonMatch) {
      const data = JSON.parse(jsonMatch[1]);
      data.forEach(slot => {
        if (slot.date || slot.testDate) {
          slots.push({
            date: slot.date || slot.testDate,
            time: slot.time || slot.startTime || '09:00'
          });
        }
      });
    }

    // Pattern 2: Date links in calendar
    const dateRegex = /href="[^"]*(\d{4}-\d{2}-\d{2})[^"]*"/g;
    let match;
    while ((match = dateRegex.exec(html)) !== null) {
      const date = match[1];
      if (date >= dateFrom && date <= dateTo) {
        slots.push({ date, time: '09:00' });
      }
    }

    // Pattern 3: Data attributes
    const dataDateRegex = /data-date="(\d{4}-\d{2}-\d{2})"/g;
    while ((match = dataDateRegex.exec(html)) !== null) {
      const date = match[1];
      if (date >= dateFrom && date <= dateTo) {
        slots.push({ date, time: '09:00' });
      }
    }

  } catch (err) {
    console.log(`    Parse error: ${err.message}`);
  }

  // Deduplicate
  const seen = new Set();
  return slots.filter(s => {
    const key = s.date + s.time;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

module.exports = { checkDVSA };
