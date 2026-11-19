# NFA Wishlist — share page

The page friends and family see when someone shares a list from the NFA Wishlist Chrome extension.
`https://swirl2001.github.io/nfa/?list=<code>`

- Static HTML/CSS/JS, no build step. Data comes from Supabase through two database functions
  (`get_shared_list`, `claim_item`); `config.js` holds only the public project URL and publishable key.
- No Amazon links or images, ever. Plain store links only (no affiliate tags).
- The list owner never sees what's been claimed or by whom (enforced in the database;
  `&view=me` also hides it on the page).
