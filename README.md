# GM Tools

A D&D 5e combat tracker, monster library and dice roller that runs in any browser. It's built for a tablet propped behind the GM screen, and works offline once it's been opened.

## Use it on an Android tablet

1. In this repo on GitHub, go to **Settings → Pages**, set **Source** to *Deploy from a branch*, pick `main` and `/ (root)`, and save.
2. After a minute, open `https://kidtruck91.github.io/D-DGMTools/` in Chrome on the tablet.
3. Tap the **⋮** menu → **Add to Home screen** (or **Install app**). It opens full screen like a normal app and works without internet.

Your monsters and the current combat are saved on the device automatically. Use **Monsters → File → Export** to back up your library or move it to another device.

## What it does

**Combat**
- Initiative order with rounds and turns; **Back** undoes an accidental Next turn.
- Ties go to the higher initiative bonus; events (lair actions, tides, reinforcements) lose ties.
- Damage, healing (capped at max HP) and temporary HP; condition tracking; a Concentration save reminder when a concentrating creature takes damage.
- Attack, advantage/disadvantage, damage and critical damage rolls for every attack, plus one-tap multiattack.
- Add several copies of a monster at once (Sahuagin 1, 2, 3…), each rolling initiative, sharing a group roll, or using a set number.
- Save and load combats as files. Files saved by the old Python tracker still load.

**Monsters**
- **Paste stat blocks**: copy a monster from D&D Beyond (or a PDF or website) and paste it in. Name, AC, HP, initiative bonus, traits, attacks, damage and multiattack counts are filled in for you to check before saving. Handles both the 2014 and 2024 stat block styles.
- **Bulk paste**: paste several stat blocks one after another in the same box. The app splits them apart and shows a checklist, flagging any that are missing HP, AC or attacks, or that you already have. A line of `---` between monsters forces a split if one is ever missed.
- **Bestiary**: all 3,207 monsters from [Open5e](https://open5e.com) (5e SRD, Tome of Beasts 1–3, Creature Codex, Black Flag, Level Up Monstrous Menagerie and more) are built in and work offline. Search by name, filter by source and CR, add straight to combat, or copy one to your monsters to customize it. The combat **Add monsters** picker searches the bestiary too. Sources and licenses are listed in `data/OPEN5E-LICENSES.md`.
- Filter your library by source book (Ghosts of Saltmarsh, Basic Rules, homebrew…).
- **File → Import** accepts `saltmarsh_monsters.json` from the old Python tracker.

**Dice**: quick dice buttons, any expression like `4d6+2`, and d20 with advantage or disadvantage.

Tap **Screen stays on** to stop the tablet from sleeping mid-fight.

## Why paste instead of a direct D&D Beyond import

D&D Beyond has no public API for stat blocks, and automated scraping is against its terms. Pasting copies only the monsters you've opened in your own account, and works with any source.

## Development

Plain HTML, CSS and JavaScript with no build step. Open `index.html` through any local web server (for example `python -m http.server`) to work on it.

Run the parser tests with `node tests/parser.test.js`.

To refresh the bestiary with the latest Open5e data:

```
git clone --depth 1 https://github.com/open5e/open5e-api
node tools/build-open5e.js open5e-api/data
```

Then bump `CACHE` in `sw.js` so installed copies pick up the new file.
