// Public by design: Supabase project URL + publishable key. All access rules live in the
// database (RLS + RPCs). Never put the secret key here.
const NFA_CONFIG = {
  supabaseUrl: "https://tpwsbimymlyjcotkvrqd.supabase.co",
  supabaseKey: "sb_publishable_5HemwcVGfv4cQWptic96WQ_ulh7PcjO",
  // NFA extension IDs the page may ask "is this list yours?" (hides purchases from the owner).
  // Chrome Web Store build first, then unpacked dev builds (~/nfa-wishlist since Nov 22; the old Downloads path).
  // Cloudflare Turnstile (bot check for new accounts / sign-in codes). Public site key; the secret lives only in Supabase.
  // Empty = check off (the site and extension skip it).
  turnstileSiteKey: "0x4AAAAAAGTVw8p_Mq72lETW",
  extensionIds: ["kpbhoejlnjkkidpikidifjinhalmlfam", "fjfbofmpglahllnnbcbhcjnpbomablcp", "ndiaemjejodkomladnbdkhlopimhcnak"],
};
