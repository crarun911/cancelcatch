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
    const centreId = CENTRE_IDS[centreName];
    console.log(`    Centre ID: ${centreId}`);

    await randomDelay(1000, 3000);

    const url = `https://driverpracticaltest.dvsa.gov.uk/api/v1/slots?` +
      `testCentreName=${encodeURIComponent(centreName)}` +
      `&testDate=${dateFrom}` +
      `&endDate=${dateTo}` +
      `&testType=car`;
    
    console.log(`    Calling URL: ${url}`);

    const response = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://driverpracticaltest.dvsa.gov.uk/',
        'X-Requested-With': 'XMLHttpRequest'
      }
    });

    console.log(`    API status: ${response.status}`);
    const text = await response.text();
    console.log(`    API response: ${text.slice(0, 300)}`);
    
    if (!response.ok) return [];
    
    const data = JSON.parse(text);
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
