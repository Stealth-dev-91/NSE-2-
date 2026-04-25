/**
 * Public config endpoint — serves safe client-side config to the frontend.
 * SUPABASE_ANON_KEY is safe to expose (it's public by design, row-level security handles auth).
 * Never expose SUPABASE_SERVICE_KEY here.
 */
// Anon key is safe to expose — Supabase security uses Row Level Security, not key secrecy
const SUPABASE_URL = process.env.SUPABASE_URL || "https://jvdtliqrstgvioigfcjc.supabase.co";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp2ZHRsaXFyc3RndmlvaWdmY2pjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcxMjIyNTksImV4cCI6MjA5MjY5ODI1OX0.rvEMoMR0dc_FibgM95btCJxnEq1AQg8SRG5kQeF-5vY";

export default function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "public, max-age=3600");

  return res.status(200).json({
    supabaseUrl: SUPABASE_URL,
    supabaseAnonKey: SUPABASE_ANON_KEY,
  });
}
