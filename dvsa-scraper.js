// vfs-scraper.js
// Intercepts VFS Global internal API calls to find appointment slots
// Run from home PC — residential IP bypasses bot protection

const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

const VFS_CODES = {
  'Italy':'ita','France':'fra','Spain':'esp','Portugal':'prt',
  'Netherlands':'nld','Germany':'deu','Greece':'grc','Denmark':'dnk',
  'Austria':'aut','Switzerland':'che','Norway':'nor','Croatia':'hrv',
  'Finland':'fin','Estonia':'est','Hungary':'hun','Iceland':'isl',
  'Malta':'mlt','Latvia':'lva','Lithuania':'ltu','Slovenia':'svn',
  'Belgium':'bel','Czech Republic':'cze','Luxembourg':'lux','Poland':'pol',
  'Slovakia':'svk','Sweden':'swe','Bulgaria':'bgr','Romania':'rou',
};

async function checkDVSA(centreName, dateFrom, dateTo, timePref) {
  const code = VFS_CODES[centreName];
  if (!code) { console.log(`    No VFS code for ${centreName}`); return []; }

  const url = `https://visa.vfsglobal.com/gbr/en/${code}/book-an-appointment`;
  let browser;

  try {
    console.log(`    Opening VFS ${centreName}...`);

    browser = await puppeteer.launch({
      headless: false,
      args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage',
             '--disable-gpu','--window-size=1280,800']
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );

    // ── Intercept ALL requests and responses ──
    const slots = [];
    const allApiCalls = [];

    page.on('request', request => {
      const reqUrl = request.url();
      // Log all non-static requests
      if (!reqUrl.match(/\.(js|css|png|jpg|gif|svg|woff|ico)(\?|$)/)) {
        allApiCalls.push({ type: 'req', url: reqUrl.slice(0,120), method: request.method() });
      }
    });

    page.on('response', async response => {
      const resUrl = response.url();
      const status = response.status();
      if (status === 200 && !resUrl.match(/\.(js|css|png|jpg|gif|svg|woff|ico)(\?|$)/)) {
        try {
          const ct = response.headers()['content-type'] || '';
          if (ct.includes('json')) {
            const text = await response.text();
            allApiCalls.push({ type: 'res', url: resUrl.slice(0,120), body: text.slice(0,300) });

            // Parse for slot data
            const data = JSON.parse(text);
            const extract = (obj) => {
              if (!obj) return;
              if (Array.isArray(obj)) { obj.forEach(extract); return; }
              if (typeof obj !== 'object') return;
              // Look for objects with date fields
              if ((obj.date||obj.appointmentDate||obj.slotDate||obj.startDate) && obj.date !== undefined) {
                slots.push(obj);
              } else {
                Object.values(obj).forEach(v => {
                  if (typeof v === 'object') extract(v);
                });
              }
            };
            extract(data);
          }
        } catch(e) {}
      }
    });

    // Load page
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 45000 });
    await delay(60000);

    console.log(`    Page loaded. Navigating booking flow...`);

    // ── Step 1: Click "Book Appointment" / "New Appointment" ──
    await page.evaluate(() => {
      const candidates = [...document.querySelectorAll('button, a, [role="button"]')];
      const target = candidates.find(el => {
        const text = el.textContent.trim().toLowerCase();
        return text.includes('new appointment') ||
               text.includes('book appointment') ||
               text === 'book' ||
               text.includes('start');
      });
      if (target) target.click();
    });
    await delay(3000);

    // ── Step 2: Select visa category if dropdown appears ──
    await page.evaluate(() => {
      // Try to select first available option in any dropdown
      const selects = document.querySelectorAll('select, mat-select');
      selects.forEach(sel => {
        if (sel.options && sel.options.length > 1) {
          sel.value = sel.options[1].value;
          sel.dispatchEvent(new Event('change', { bubbles: true }));
        }
      });

      // Try mat-select (Angular Material)
      const matSelects = document.querySelectorAll('mat-select');
      matSelects.forEach(sel => sel.click());
    });
    await delay(2000);

    // Click first mat-option if available
    await page.evaluate(() => {
      const opts = document.querySelectorAll('mat-option');
      if (opts.length > 0) opts[0].click();
    });
    await delay(2000);

    // ── Step 3: Click Continue/Next ──
    await page.evaluate(() => {
      const btns = [...document.querySelectorAll('button')];
      const next = btns.find(b => {
        const t = b.textContent.trim().toLowerCase();
        return t.includes('continue') || t.includes('next') || t === 'ok';
      });
      if (next) next.click();
    });
    await delay(3000);

    // Log all captured API calls
    const jsonCalls = allApiCalls.filter(c => c.type === 'res');
    console.log(`    Total API responses captured: ${jsonCalls.length}`);
    jsonCalls.slice(0, 10).forEach(c => {
      console.log(`    URL: ${c.url}`);
      console.log(`    Body: ${c.body}`);
      console.log(`    ---`);
    });

    await browser.close();

    const today = new Date().toISOString().split('T')[0];
    const valid = slots
      .map(s => ({
        date: s.date || s.appointmentDate || s.slotDate || s.startDate || '',
        time: s.time || s.startTime || '09:00'
      }))
      .filter(s => s.date && s.date > today);

    console.log(`    Valid future slots: ${valid.length}`);
    return valid;

  } catch (err) {
    if (browser) try { await browser.close(); } catch(e) {}
    console.error(`    Error: ${err.message}`);
    return [];
  }
}

module.exports = { checkDVSA };
