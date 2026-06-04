const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

module.exports = async (req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-cache');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const city = req.query.city || 'London';

  try {
    const { data, error } = await supabase
      .from('visa_slots')
      .select('*')
      .eq('city_from', city)
      .eq('visa_type', 'tourist')
      .order('visa_destination', { ascending: true });

    if (error) throw error;

    const slots = (data || []).map(row => ({
      country:      row.visa_destination,
      city:         row.city_from,
      available:    row.earliest_slot_date !== null,
      earliestDate: row.earliest_slot_date,
      slotsCount:   row.slots_count || 0,
      lastChecked:  row.last_checked,
    }));

    return res.status(200).json({ ok: true, city, slots });

  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
};
