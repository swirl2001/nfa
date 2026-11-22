// Public by design: Supabase project URL + publishable key. All access rules live in the
// database (RLS + RPCs). Never put the secret key here.
const NFA_CONFIG = {
  supabaseUrl: "https://tpwsbimymlyjcotkvrqd.supabase.co",
  supabaseKey: "sb_publishable_5HemwcVGfv4cQWptic96WQ_ulh7PcjO",
  // NFA extension IDs the page may ask "is this list yours?" (hides purchases from the owner).
  // Chrome Web Store build first, then unpacked dev builds (~/nfa-wishlist since Nov 22; the old Downloads path).
  extensionIds: ["kpbhoejlnjkkidpikidifjinhalmlfam", "fjfbofmpglahllnnbcbhcjnpbomablcp", "ndiaemjejodkomladnbdkhlopimhcnak"],
};
