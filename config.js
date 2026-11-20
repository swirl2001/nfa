// Public by design: Supabase project URL + publishable key. All access rules live in the
// database (RLS + RPCs). Never put the secret key here.
const NFA_CONFIG = {
  supabaseUrl: "https://tpwsbimymlyjcotkvrqd.supabase.co",
  supabaseKey: "sb_publishable_5HemwcVGfv4cQWptic96WQ_ulh7PcjO",
  // NFA extension IDs the page may ask "is this list yours?" (hides purchases from the owner).
  // Unpacked dev build; add the Chrome Web Store ID when it's published.
  extensionIds: ["ndiaemjejodkomladnbdkhlopimhcnak"],
};
