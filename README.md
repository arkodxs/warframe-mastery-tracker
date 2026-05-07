# Warframe Mastery Tracker

A single-file browser tool for tracking your Warframe mastery progress, star chart completion, and levelling plans. Everything (currently) runs locally in your browser.

---

## Getting Started

### 1. Find your player ID

Open `%localappdata%\Warframe\EE.log` in a text editor and search for **"Logged in"**. Your player ID is the long string of numbers and letters that follows it.

### 2. Fetch your profile

Paste your ID into the URL below and open it in your browser:

```
http://content.warframe.com/dynamic/getProfileViewingData.php?playerId=YOUR_ID
```

Copy the entire page content (Ctrl+A, Ctrl+C). 
Alternatively, open the app and follow the first step of the initial instructions.

### 3. Import

Open the tracker, enter your player ID in the field provided, then paste the JSON into the text area and click **Import profile**.

After the first import, your ID is saved for up to 7 days. Future refreshes are done via **Refresh Profile** in the top bar.
Other user information for the app should be saved indefinitely locally, but can be exported for user management.
---

## Features

- **Mastery tracking** — item-by-item progress across all weapons, warframes, companions, archwings etc.
- **Star chart** — per-planet node completion with Steel Path tracking, junction mastery, and available mastery XP
- **MR calculator** — progress toward your next rank, what-if projections, and mastery ceiling from remaining items
- **Custom lists** — organise items into named lists with progress tracking and mastery projections
- **Item notes** — attach notes to any item or star chart node
- **Selection tools** — click-select, shift-range, Ctrl-toggle with bulk star/priority/building actions
- **Wiki links** — press `W` while hovering any item to open its wiki page!!

### Keyboard shortcuts

| Key | Action |
|-----|--------|
| `W` | Open wiki page for hovered or selected item |
| `S` | Star / unstar selected items |
| `P` | Mark selected as priority |
| `B` | Mark selected as building |
| `Ctrl+A` | Select all visible items |
| `Esc` / `Del` | Clear selection |

---

## Your Data

The tracker uses two separate stores:

- **Profile JSON** — your Warframe progress snapshot from DE's servers. Stored locally in your browser. Re-import whenever you want to update.
- **User data** — your notes, stars, lists, and settings. Stored in your browser's IndexedDB with a localStorage backup. Use **Save data ↓** to export a copy and **Load data ↑** to restore it on another device.

Nothing is ever sent to any server - all data stays on your browser.

---

## Notes

- The player ID is found in the Warframe log file on Windows. There is currently no known way to retrieve it on other platforms.
- Steel Path completion is read directly from your profile — no manual input required.
- Rank-40 items (Kuva/Tenet weapons, Necramechs) require manual rank input since Forma resets make XP-based calculation unreliable.
- Star chart node counts may differ slightly from in-game as DE occasionally adds or restructures missions.


### Planned Features
- Local saves of user favourites, lists, etc. (not DE data).
- Aesthetic overhaul - a bit too clean/minimalist right now, but it's a good foundation.
- Make the steel path/base path node tracking a bit clearer, in terms of Mxp as well.
- Resource tracking with user lists - breakdown of required resources; track rarer or user-set resources (can't get user resource counts from this).
- Allow users to track frames they want to farm 2+ copies of (for helminth or otherwise).
- Wiki callouts for resources + contribute to the wiki to help make those more useful.
- User startup guide - explaining how data is managed, keybinds, features etc.
