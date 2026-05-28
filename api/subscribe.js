const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const {
      fname, lname, email, whatsapp, password,
      centres, dateFrom, dateTo, timePref,
      notifEmail, notifWa, plan
    } = req.body;

    const { data: existing } = await supabase
      .from('subscribers')
      .select('id')
      .eq('email', email)
      .single();

    if (existing) {
      return res.status(400).json({ error: 'Email already registered.' });
    }

    const { error } = await supabase
      .from('subscribers')
      .insert({
        fname, lname, email, whatsapp,
        password_hash: Buffer.from(password).toString('base64'),
        centres, date_from: dateFrom, date_to: dateTo,
        time_pref: timePref, notif_email: notifEmail,
        notif_wa: notifWa, plan,
        trial_ends_at: plan === 'trial'
          ? new Date(Date.now() + 7 * 86400000).toISOString()
          : null,
        active: true
      });

    if (error) throw error;

    return res.status(200).json({ ok: true });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Something went wrong.' });
  }
};