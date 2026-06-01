// telegram-scraper.js
// Reads VFS slot alerts from public Telegram channel @UKVFSBot
// No VFS scraping needed — channel already does the hard work for free!
// Uses Telegram Bot API to read channel messages

const https = require('https');

// Your Telegram Bot token — create one via @BotFather on Telegram
// The bot needs to be a member of the channel to read messages
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

// Channel to monitor
const CHANNEL_USERNAME = '@UKVFSBot';

// Parse a Telegram message for slot data
// Messages look like:
// 🇮🇹 ITALY 🟢 London: Tourist/Business
// Earliest available slot: 30.07
function parseSlotMessage(text) {
  if (!text) return null;

  const results = [];

  // Country mapping from flag emoji
  const COUNTRY_MAP = {
    '🇮🇹': 'Italy', '🇫🇷': 'France', '🇪🇸': 'Spain', '🇵🇹': 'Portugal',
    '🇳🇱': 'Netherlands', '🇩🇪': 'Germany', '🇬🇷': 'Greece', '🇩🇰': 'Denmark',
    '🇦🇹': 'Austria', '🇨🇭': 'Switzerland', '🇳🇴': 'Norway', '🇭🇷': 'Croatia',
    '🇫🇮': 'Finland', '🇪🇪': 'Estonia', '🇭🇺': 'Hungary', '🇮🇸': 'Iceland',
    '🇲🇹': 'Malta', '🇱🇻': 'Latvia', '🇱🇹': 'Lithuania', '🇸🇮': 'Slovenia',
    '🇧🇪': 'Belgium', '🇨🇿': 'Czech Republic', '🇱🇺': 'Luxembourg',
    '🇵🇱': 'Poland', '🇸🇰': 'Slovakia', '🇸🇪': 'Sweden', '🇧🇬': 'Bulgaria',
    '🇷🇴': 'Romania',
  };

  const CITIES = ['London', 'Manchester', 'Birmingham', 'Edinburgh', 'Cardiff'];

  // Check if message has a slot (green circle = available)
  if (!text.includes('🟢')) return null;

  // Find which country
  let country = null;
  for (const [flag, name] of Object.entries(COUNTRY_MAP)) {
    if (text.includes(flag)) { country = name; break; }
  }
  if (!country) return null;

  // Find which city
  let city = 'London'; // default
  for (const c of CITIES) {
    if (text.includes(c)) { city = c; break; }
  }

  // Find earliest date — format like "30.07" or "12.06.2026"
  const dateMatch = text.match(/(\d{2})\.(\d{2})(?:\.(\d{4}))?/);
  if (!dateMatch) return null;

  const day   = dateMatch[1];
  const month = dateMatch[2];
  const year  = dateMatch[3] || new Date().getFullYear();
  const date  = `${year}-${month}-${day}`;

  // Only future dates
  const today = new Date().toISOString().split('T')[0];
  if (date < today) return null;

  return { country, city, date, time: '09:00', raw: text };
}

// Fetch recent messages from the channel using Telegram API
async function fetchChannelMessages() {
  return new Promise((resolve, reject) => {
    if (!BOT_TOKEN) {
      reject(new Error('TELEGRAM_BOT_TOKEN not set'));
      return;
    }

    // Get updates — messages forwarded to our bot from the channel
    const url = `https://api.telegram.org/bot${BOT_TOKEN}/getUpdates?limit=100&allowed_updates=["channel_post","message"]`;

    https.get(url, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (!json.ok) { reject(new Error(json.description)); return; }
          resolve(json.result || []);
        } catch(e) { reject(e); }
      });
    }).on('error', reject);
  });
}

// Alternative: fetch channel messages via web preview (no bot needed)
// t.me/s/UKVFSBot shows recent messages publicly
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
        // Parse message text from HTML
        const messages = [];
        const msgRegex = /<div class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/g;
        let match;
        while ((match = msgRegex.exec(data)) !== null) {
          // Strip HTML tags
          const text = match[1]
            .replace(/<br\s*\/?>/gi, '\n')
            .replace(/<[^>]+>/g, '')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&#39;/g, "'")
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

// Main function — get all available slots from Telegram channel
async function getAvailableSlots() {
  console.log('    Fetching from Telegram channel @UKVFSBot...');

  try {
    const messages = await fetchChannelPublic();
    console.log(`    Found ${messages.length} messages`);

    const slots = [];
    for (const msg of messages) {
      const slot = parseSlotMessage(msg);
      if (slot) {
        console.log(`    ✓ Slot: ${slot.country} — ${slot.city} — ${slot.date}`);
        slots.push(slot);
      }
    }

    console.log(`    Total slots found: ${slots.length}`);
    return slots;

  } catch (err) {
    console.error('    Telegram fetch error:', err.message);
    return [];
  }
}

module.exports = { getAvailableSlots, parseSlotMessage };
