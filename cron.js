// CancelCatch — cron.js
// Deploy to Railway or run via GitHub Actions
// node cron.js        → runs continuously every 15 mins
// node cron.js --once → runs once then exits (GitHub Actions)

require('dotenv').config();
const { checkDVSA }  = require('./dvsa-scraper');
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

// Load email template once
const EMAIL_TEMPLATE = fs.readFileSync(
  path.join(__dirname, 'email-templates/slot-alert.html'), 'utf8'
);

// ── Send Email ────────────────────────────────────────────────────────────────
async function sendEmail(subscriber, centre, slot) {
  const bookingLink = 'https://www.gov.uk/book-driving-test';
  const html = EMAIL_TEMPLATE
    .replace(/{{FIRST_NAME}}/g,        subscriber.fname)
    .replace(/{{CENTRE_NAME}}/g,       centre)
    .replace(/{{SLOT_DATE}}/g,         formatDate(slot.date))
    .replace(/{{SLOT_TIME}}/g,         slot.time || 'Morning')
    .replace(/{{BOOKING_LINK}}/g,      bookingLink)
    .replace(/{{PLAN_NAME}}/g,         subscriber.plan === 'basic' ? 'Basic' : 'Standard')
    .replace(/{{UNSUBSCRIBE_TOKEN}}/g, subscriber.id);

  await sgMail.send({
    to:      subscriber.email,
    from:    { email: 'crarun911@gmail.com', name: 'CancelCatch' },
    replyTo: 'crarun911@gmail.com',
    subject: `Test slot found at ${centre} — ${formatDate(slot.date)}`,
    html,
    text: `Hi ${subscriber.fname}, a slot is available at ${centre} on ${formatDate(slot.date)} at ${slot.time || 'Morning'}. Book now: ${bookingLink}`,
  });
  console.log(`📧 Email sent to ${subscriber.email} — ${centre} ${slot.date}`);
}

// ── Send WhatsApp ─────────────────────────────────────────────────────────────
async function sendWhatsApp(subscriber, centre, slot) {
  const msg =
    `✅ *Slot available!*\n\n` +
    `📍 *Centre:* ${centre}\n` +
    `📅 *Date:* ${formatDate(slot.date)}\n` +
    `🕐 *Time:* ${slot.time || 'Morning'}\n\n` +
    `Book it now on gov.uk — you must book yourself:\n` +
    `https://www.gov.uk/book-driving-test\n\n` +
    `_CancelCatch — cancelcatch.co.uk_`;

  await twilioClient.messages.create({
    from: `whatsapp:${process.env.TWILIO_WA_NUMBER}`,
    to:   `whatsapp:${subscriber.whatsapp}`,
    body: msg,
  });
  console.log(`💬 WhatsApp sent to ${subscriber.whatsapp} — ${centre} ${slot.date}`);
}

// ── Log Alert ─────────────────────────────────────────────────────────────────
async function logAlert(subscriberId, centre, slot, channel) {
  await supabase.from('alerts_log').insert({
    subscriber_id: subscriberId,
    centre,
    slot_date: slot.date,
    slot_time: slot.time,
    channel,
  });
  await supabase
    .from('subscribers')
    .update({ last_alerted_at: new Date() })
    .eq('id', subscriberId);
}

// ── Expire Trials ─────────────────────────────────────────────────────────────
async function expireTrials() {
  const { error } = await supabase
    .from('subscribers')
    .update({ active: false })
    .eq('plan', 'trial')
    .eq('active', true)
    .lt('trial_ends_at', new Date().toISOString());
  if (!error) console.log('🕐 Expired old trials');
}

// ── Main Run ──────────────────────────────────────────────────────────────────
async function run() {
  console.log(`\n🔍 CancelCatch check started at ${new Date().toLocaleTimeString('en-GB')}`);

  await expireTrials();

  const { data: subscribers, error } = await supabase
    .from('subscribers')
    .select('*')
    .eq('active', true)
    .in('plan', ['basic', 'standard']);

  if (error) { console.error('DB error:', error.message); return; }
  console.log(`👥 Checking ${subscribers.length} active subscribers`);

  // Deduplicate centres
  const centreMap = {};
  for (const sub of subscribers) {
    for (const centre of sub.centres) {
      if (!centreMap[centre]) centreMap[centre] = [];
      centreMap[centre].push(sub);
    }
  }

  // Check each centre once
  for (const [centre, subs] of Object.entries(centreMap)) {
    console.log(`  Checking ${centre}...`);

    const dateFrom = subs.reduce((min, s) => s.date_from < min ? s.date_from : min, subs[0].date_from);
    const dateTo   = subs.reduce((max, s) => s.date_to   > max ? s.date_to   : max, subs[0].date_to);

    const slots = await checkDVSA(centre, dateFrom, dateTo, 'any');

    if (!slots.length) {
      console.log(`    No slots at ${centre}`);
      continue;
    }

    console.log(`    ✓ ${slots.length} slot(s) found at ${centre}!`);

    for (const sub of subs) {
      const matching = slots.filter(slot => slotMatchesPrefs(slot, sub));
      if (!matching.length) continue;
      const slot = matching[0];

      try {
        if (sub.notif_email) {
          await sendEmail(sub, centre, slot);
          await logAlert(sub.id, centre, slot, 'email');
        }
        if (sub.notif_wa && sub.whatsapp && sub.plan === 'standard') {
          await sendWhatsApp(sub, centre, slot);
          await logAlert(sub.id, centre, slot, 'whatsapp');
        }
      } catch (err) {
        console.error(`  Failed to notify ${sub.email}:`, err.message);
        if (err.response) console.error('  Details:', JSON.stringify(err.response.body));
      }
    }
  }

  console.log(`✅ Check complete at ${new Date().toLocaleTimeString('en-GB')}\n`);
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function slotMatchesPrefs(slot, sub) {
  if (sub.date_from && slot.date < sub.date_from) return false;
  if (sub.date_to   && slot.date > sub.date_to)   return false;
  if (sub.time_pref && sub.time_pref !== 'any') {
    const hour = parseInt(slot.time?.split(':')[0] || '10');
    if (sub.time_pref === 'morning'   && hour >= 12) return false;
    if (sub.time_pref === 'afternoon' && (hour < 12 || hour >= 17)) return false;
    if (sub.time_pref === 'evening'   && hour < 17)  return false;
  }
  return true;
}

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
  cron.schedule('*/15 * * * *', run);
  run();
  console.log('🚀 CancelCatch cron started — checking every 15 minutes');
}
