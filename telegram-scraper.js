// telegram-scraper.js
// Reads VFS slot alerts from public Telegram channel @UKVFSBot

const https = require('https');

const COUNTRY_MAP = {
  '🇮🇹': 'Italy',       '🇫🇷': 'France',      '🇪🇸': 'Spain',
  '🇵🇹': 'Portugal',    '🇳🇱': 'Netherlands',  '🇩🇪': 'Germany',
  '🇬🇷': 'Greece',      '🇩🇰': 'Denmark',      '🇦🇹': 'Austria',
  '🇨🇭': 'Switzerland', '🇳🇴': 'Norway',       '🇭🇷': 'Croatia',
  '🇫🇮': 'Finland',     '🇪🇪': 'Estonia',      '🇭🇺': 'Hungary',
  '🇮🇸': 'Iceland',     '🇲🇹': 'Malta',        '🇱🇻': 'Latvia',
  '🇱🇹': 'Lithuania',   '🇸🇮': 'Slovenia',     '🇧🇪': 'Belgium',
  '🇨🇿': 'Czech Republic','🇱🇺': 'Luxembourg', '🇵🇱': 'Poland',
  '🇸🇰': 'Slovakia',    '🇸🇪': 'Sweden',       '🇧🇬': 'Bulgaria',
  '🇷🇴': 'Romania',     '🇱🇮': 'Liechtenstein',
};

const CITIES = ['London', 'Manchester', 'Birmingham', 'Edinburgh', 'Cardiff'];

function parseSlotMessage(text) {
  if (!text) return null;

  // Must have a status indicator
  // 🟢 = available, 🟣 = Edinburgh available, 🔵 = other city available
  // ⚠️ or 🟡 = waitlist open
  const hasSlot     = text.includes('🟢') || text.includes('🟣') || text.includes('🔵');
  const hasWaitlist = text.includes('Waitlist open') || text.includes('waitlist') || 
                      text.includes('⚠️') || text.includes('🟡');

  if (!hasSlot && !hasWaitlist) return null;

  // Find country
  let country = null;
  for (const [flag, name] of Object.entries(COUNTRY_MAP)) {
    if (text.includes(flag)) { country = name; break; }
  }
  if (!country) return null;

  // Find city from text first, then emoji colour
  let city = 'London';
  for (const c of CITIES) {
    if (text.includes(c)) { city = c; break; }
  }
  if (city === 'London' && !text.includes('London')) {
    if (text.includes('🟣'))      city = 'Edinburgh';
    else if (text.includes('🔵')) city = 'Manchester';
    else if (text.includes('🟡')) city = 'Cardiff';
  }

  // Find earliest date — format like "30.07" or "12.06.2026"
  const dateMatch = text.match(/(\d{2})\.(\d{2})(?:\.(\d{4}))?/);

  // Waitlist — no date needed
  if (hasWaitlist && !hasSlot) {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    return {
      country, city,
      date: tomorrow.toISOString().split('T')[0],
      time: '09:00',
      waitlist: true,
      raw: text
    };
  }

  if (!dateMatch) return null;

  const day   = dateMatch[1];
  const month = dateMatch[2];
  const year  = dateMatch[3] || new Date().getFullYear();
  const date  = `${year}-${month}-${day}`;

  const today = new Date().toISOString().split('T')[0];
  if (date < today) return null;

  return { country, city, date, time: '09:00', waitlist: false, raw: text };
}

async function fetchChannelPublic() {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 't.me',
      path: '/s/UKVFSBot',
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml'
      }
    };

    const req = https.request(options, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        const messages = [];
        const msgRegex = /<div class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/g;
        let match;
        while ((match = msgRegex.exec(data)) !== null) {
          const text = match[1]
            .replace(/<br\s*\/?>/gi, '\n')
            .replace(/<[^>]+>/g, '')
            .replace(/&amp;/g, '&').replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>').replace(/&#39;/g, "'")
            .trim();
          if (text) messages.push(text);
        }
        resolve(messages);
      });
    });
    req.on('error', reject);
    req.end();
  });
}

async function getAvailableSlots() {
  console.log('    Fetching from Telegram channel @UKVFSBot...');
  try {
    const messages = await fetchChannelPublic();
    console.log(`    Found ${messages.length} messages`);

    const slots = [];
    for (const msg of messages) {
      const slot = parseSlotMessage(msg);
      if (slot) {
        console.log(`    ✓ ${slot.waitlist ? 'Waitlist' : 'Slot'}: ${slot.country} — ${slot.city} — ${slot.date}`);
        slots.push(slot);
      }
    }

    console.log(`    Total found: ${slots.length}`);
    return slots;
  } catch (err) {
    console.error('    Telegram fetch error:', err.message);
    return [];
  }
}

module.exports = { getAvailableSlots, parseSlotMessage };
