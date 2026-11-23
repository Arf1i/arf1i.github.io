/* ============================================================
   byak — config
   Keys: Supabase project → Connect, or Settings → API Keys.
   supabaseAnonKey is the public key: it ships in the browser and can
   only do what RLS policies allow (see db/schema.sql).
   Never put a secret key here — it belongs to the agent only.
   ============================================================ */
window.BYAK_CONFIG = {
  supabaseUrl: 'https://tuwkxkyzjhrxevszrery.supabase.co',
  supabaseAnonKey: 'sb_publishable_Wcot5O3Ctp8K-Qc6WxQbIw_QFEfZd-v',

  // Real sign-in: email of the single Supabase Auth account.
  // The code typed on the lock screen is that account's password.
  authEmail: 'its@arfi.dot',

  // Soft gate: unused while authEmail is set.
  passcode: '',

  // Appearance
  title: 'byak',
  greetingName: '',          // optional name used in the greeting
  timeZone: 'Asia/Yekaterinburg',
};
