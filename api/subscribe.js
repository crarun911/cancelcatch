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
      centres, cities, visaType,
      dateFrom, dateTo, timePref,
      notifEmail, notifWa, plan
    } = req.body;

    // Validate required fields
    if (!fname || !email || !password) {
      return res.status(400).json({ error: 'Name, email and password are required.' });
    }
    if (!centres || !centres.length) {
      return res.status(400).json({ error: 'Please select at least one destination.' });
    }

    // Check if email already exists
    const { data: existing } = await supabase
      .from('subscribers')
      .select('id')
      .eq('email', email.toLowerCase())
      .single();

    if (existing) {
      return res.status(400).json({ error: 'This email is already registered. Please log in.' });
    }

    // Save to Supabase
    const { error } = await supabase
      .from('subscribers')
      .insert({
        fname:         fname.trim(),
        lname:         lname ? lname.trim() : '',
        email:         email.toLowerCase().trim(),
        whatsapp:      whatsapp || null,
        password_hash: Buffer.from(password).toString('base64'),
        centres:       centres,
        cities:        cities || ['London'],
        visa_type:     visaType || 'tourist',
        date_from:     dateFrom || null,
        date_to:       dateTo   || null,
        time_pref:     timePref || 'any',
        notif_email:   notifEmail !== false,
        notif_wa:      notifWa === true,
        plan:          plan || 'email',
        active:        true,
      });

    if (error) {
      console.error('Supabase insert error:', error);
      throw error;
    }

    return res.status(200).json({ ok: true });

  } catch (err) {
    console.error('Subscribe error:', err.message);
    return res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
};
