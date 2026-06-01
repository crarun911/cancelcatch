// CancelCatch — cron.js
// Architecture: Scraper → Database → Notification Engine
// Never scrapes when users visit — runs on schedule, caches in Supabase

require('dotenv').config();
const { getAvailableSlots } = require('./telegram-scraper');
const { createClient } = require('@supabase/supabase-js');
const sgMail           = require('@sendgrid/mail');
const twilio           = require('twilio');
const cron             = require('node-cron');
const fs               = require('fs');
const path             = require('path');

// ── Clients ───────────────────────────────────────────────────────────────────
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);
sgMail.setApiKey(process.env.SENDGRID_KEY);
const twilioClient = twilio(process.env.TWILIO_SID, process.env.TWILIO_TOKEN);

const EMAIL_TEMPLATE = fs.readFileSync(
  path.join(__dirname, 'email-templates/slot-alert.html'), 'utf8'
);

// ── Send Email ────────────────────────────────────────────────────────────────
async function sendEmail(subscriber, country, city, slot) {
  const bookingLink = `https://www.vfsglobal.com/en/individuals/index.html`;
  const html = EMAIL_TEMPLATE
    .replace(/{{FIRST_NAME}}/g,        subscriber.fname)
    .replace(/{{CENTRE_NAME}}/g,       `${country} (${city})`)
    .replace(/{{SLOT_DATE}}/g,         formatDate(slot.date))
    .replace(/{{SLOT_TIME}}/g,         slot.time || 'Morning')
    .replace(/{{BOOKING_LINK}}/g,      bookingLink)
    .replace(/{{PLAN_NAME}}/g,         subscriber.plan === 'full' ? 'Email + WhatsApp' : 'Email')
    .replace(/{{UNSUBSCRIBE_TOKEN}}/g, subscriber.id);

  await sgMail.send({
    to:      subscriber.email,
    from:    { email: 'crarun911@gmail.com', name: 'CancelCatch' },
    replyTo: 'crarun911@gmail.com',
    subject: `✅ Visa slot found — ${country} in ${city} on ${formatDate(slot.date)}`,
    html,
    text: `Hi ${subscriber.fname}, a visa appointment slot is available for ${country} in ${city} on ${formatDate(slot.date)}. Book now: ${bookingLink}`,
  });
  console.log(`  📧 Email → ${subscriber.email} — ${country}/${city}`);
}

// ── Send WhatsApp ─────────────────────────────────────────────────────────────
async function sendWhatsApp(subscriber, country, city, slot) {
  const msg =
    `✅ *Visa slot available!*\n\n` +
    `🌍 *Country:* ${country}\n` +
    `📍 *VFS City:* ${city}\n` +
    `📅 *Earliest date:* ${formatDate(slot.date)}\n\n` +
    `Book now on VFS Global:\nhttps://www.vfsglobal.com/en/individuals/index.html\n\n` +
    `_CancelCatch — cancelcatch.co.uk_`;

  await twilioClient.messages.create({
    from: `whatsapp:${process.env.TWILIO_WA_NUMBER}`,
    to:   `whatsapp:${subscriber.whatsapp}`,
    body: msg,
  });
  console.log(`  💬 WhatsApp → ${subscriber.whatsapp} — ${country}/${city}`);
}

// ── Update visa_slots table ───────────────────────────────────────────────────
async function updateSlotCache(country, city, slots) {
  const now = new Date().toISOString();
  const hasSlots = slots.length > 0;
  const earliest = hasSlots ? slots.sort((a,b) => a.date.localeCompare(b.date))[0].date : null;

  const { error } = await supabase
    .from('visa_slots')
    .upsert({
      visa_destination:   country,
      city_from:          city,
      visa_type:          'tourist',
      earliest_slot_date: earliest,
      slots_count:        slots.length,
      last_checked:       now,
      last_seen_available: hasSlots ? now : undefined,
    }, { onConflict: 'visa_destination,city_from,visa_type' });

  if (error) console.error(`  DB update error for ${country}/${city}:`, error.message);
  else console.log(`  ✓ Cache updated: ${country}/${city} — ${hasSlots ? earliest : 'no slots'}`);
}

// ── Notify matching subscribers ───────────────────────────────────────────────
async function notifySubscribers(country, city, slots) {
  if (!slots.length) return;

  // Find active subscribers watching this country + city combo
  const { data: subscribers, error } = await supabase
    .from('subscribers')
    .select('*')
    .eq('active', true)
    .in('plan', ['email', 'full'])
    .contains('centres', [country]);

  if (error || !subscribers?.length) return;

  // Filter by city
  const matching = subscribers.filter(sub => {
    const subCities = sub.cities || ['London'];
    return subCities.some(c => c.trim().toLowerCase() === city.toLowerCase());
  });

  console.log(`  👥 ${matching.length} subscribers to notify for ${country}/${city}`);

  const slot = slots[0]; // Earliest slot

  for (const sub of matching) {
    try {
      if (sub.notif_email) {
        await sendEmail(sub, country, city, slot);
        await logAlert(sub.id, country, city, slot, 'email');
      }
      if (sub.notif_wa && sub.whatsapp && sub.plan === 'full') {
        await sendWhatsApp(sub, country, city, slot);
        await logAlert(sub.id, country, city, slot, 'whatsapp');
      }
    } catch (err) {
      console.error(`  Failed to notify ${sub.email}:`, err.message);
      if (err.response) console.error('  Details:', JSON.stringify(err.response.body));
    }
  }
}

// ── Log Alert ─────────────────────────────────────────────────────────────────
async function logAlert(subscriberId, country, city, slot, channel) {
  await supabase.from('alerts_log').insert({
    subscriber_id: subscriberId,
    country, city,
    slot_date: slot.date,
    slot_time: slot.time,
    channel,
  });
  await supabase
    .from('subscribers')
    .update({ alerts_sent: supabase.rpc('increment'), last_alerted_at: new Date() })
    .eq('id', subscriberId);
}

// ── Main Run ──────────────────────────────────────────────────────────────────
async function run() {
  console.log(`\n🔍 CancelCatch scan started at ${new Date().toLocaleTimeString('en-GB')}`);

  // ── Step 1: Fetch ALL slots from Telegram for ALL cities ──
  // This powers the public live tracker — runs regardless of subscribers

  // ── Fetch ALL slots from Telegram ──
  console.log('\n📡 Fetching slot data from Telegram channel...');
  const allSlots = await getAvailableSlots();
  console.log(`\n🌍 Found ${allSlots.length} total slots across all countries`);

  // Group slots by country+city
  const slotMap = {};
  allSlots.forEach(slot => {
    const key = slot.country + '|||' + slot.city;
    if (!slotMap[key]) slotMap[key] = [];
    slotMap[key].push(slot);
  });

  // All cities to update in live tracker
  const ALL_CITIES = ['London','Manchester','Birmingham','Edinburgh','Cardiff'];
  const ALL_COUNTRIES = [
    'Italy','France','Spain','Portugal','Netherlands','Germany','Greece',
    'Denmark','Austria','Switzerland','Norway','Croatia','Finland','Estonia',
    'Hungary','Iceland','Malta','Latvia','Lithuania','Slovenia','Belgium',
    'Czech Republic','Luxembourg','Poland','Slovakia','Sweden','Bulgaria',
    'Romania','Liechtenstein'
  ];

  // ── Update ALL country/city combos in database (powers live tracker) ──
  for (const city of ALL_CITIES) {
    for (const country of ALL_COUNTRIES) {
      const slots = slotMap[country + '|||' + city] || [];
      await updateSlotCache(country, city, slots);
    }
  }

  // ── Notify subscribers for their specific combos ──
  const { data: subscribers } = await supabase
    .from('subscribers')
    .select('*')
    .eq('active', true)
    .in('plan', ['email', 'full']);

  if (subscribers && subscribers.length > 0) {
    console.log(`\n👥 Checking ${subscribers.length} subscribers for alerts...`);

    // Get unique country+city combos from subscribers
    const subCombos = new Set();
    subscribers.forEach(sub => {
      const countries = sub.centres || [];
      const cities    = sub.cities   || ['London'];
      countries.forEach(country => {
        cities.forEach(city => subCombos.add(country + '|||' + city));
      });
    });

    for (const combo of subCombos) {
      const [country, city] = combo.split('|||');
      const slots = slotMap[country + '|||' + city] || [];
      if (slots.length > 0) {
        console.log(`  ✓ Slots found for ${country}/${city} — notifying...`);
        await notifySubscribers(country, city, slots);
      }
    }
  } else {
    console.log('\n👥 No active subscribers to notify');
  }

  console.log(`\n✅ Scan complete at ${new Date().toLocaleTimeString('en-GB')}`);
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function formatDate(dateStr) {
  if (!dateStr) return 'TBC';
  return new Date(dateStr).toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
  });
}

// ── Schedule ──────────────────────────────────────────────────────────────────
const runOnce = process.argv.includes('--once');

if (runOnce) {
  run().then(() => {
    console.log('✅ Single run complete — exiting');
    process.exit(0);
  }).catch(err => {
    console.error('❌ Run failed:', err);
    process.exit(1);
  });
} else {
  cron.schedule('*/10 * * * *', run);
  run();
  console.log('🚀 CancelCatch started — scanning every 10 minutes');
}
