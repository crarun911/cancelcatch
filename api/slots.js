// api/slots.js
// Vercel serverless function — returns live slot data from Supabase
// Called by the live tracker on the website every 30 seconds

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=30');

  const city = req.query.city || 'London';

  try {
    const { data, error } = await supabase
      .from('visa_slots')
      .select('*')
      .eq('city_from', city)
      .eq('visa_type', 'tourist')
      .order('visa_destination', { ascending: true });

    if (error) throw error;

    const slots = data.map(row => ({
      country:      row.visa_destination,
      city:         row.city_from,
      available:    row.earliest_slot_date !== null,
      earliestDate: row.earliest_slot_date,
      slotsCount:   row.slots_count || 0,
      lastChecked:  row.last_checked,
    }));

    return res.status(200).json({ ok: true, city, slots, updatedAt: new Date().toISOString() });

  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
};
