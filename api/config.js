/**
 * Public config endpoint — serves safe client-side config to the frontend.
 * SUPABASE_ANON_KEY is safe to expose (it's public by design, row-level security handles auth).
 * Never expose SUPABASE_SERVICE_KEY here.
 */
export default function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "public, max-age=3600"); // cache 1hr

  return res.status(200).json({
    supabaseUrl: process.env.SUPABASE_URL || null,
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY || null,
  });
}
