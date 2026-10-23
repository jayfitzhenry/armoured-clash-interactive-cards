# Armoured Clash unit cards

Web Page: https://jayfitzhenry.github.io/armoured-clash-interactive-cards/

A static, offline-capable web app for looking up Armoured Clash unit cards and the Glossary of Rules & Qualities v1.11. It covers 193 units from these ORBATs:

| Faction | ORBAT version |
| --- | --- |
| Alliance | v1.01 |
| Commonwealth | v1.02 |
| Crown | v1.05 |
| Empire | v1.05 Beta |
| Enlightened | v1.05 |
| Imperium | v1.03 |
| Sultanate | v1.02 |
| Union | v1.05 |

Unit photos are full-colour transparent WebP cut-outs in `img/`, named by unit id (for example `img/crown-rifle-platoon.webp`).

- **All units**: filter by faction and category, search names, traits, special rules, weapon qualities and rule text. Tap a unit for its full card.
- **My force**: tap **+** to add units. Set strength (Basic/Reinforced/Full) and command variant per unit; points and VPR total automatically. Saved on the device; **Share** gives a link that loads the same force.
- **Rules**: the full glossary, filterable to the rules your force actually uses.
- Tap any weapon quality on a card for its definition. Tap a trait to find every unit with it.
- Keyboard: `/` search, `Esc` close, `←` `→` previous/next card.

## Hosting on GitHub Pages
1. Create a repo and push the contents of this folder to the root of the `main` branch.
2. Repo **Settings → Pages → Build and deployment → Source: Deploy from a branch**, branch `main`, folder `/ (root)`.
3. The site appears at `https://<user>.github.io/<repo>/`.

No build step. To test locally run `python3 -m http.server` in this folder and open http://localhost:8000 (opening index.html directly from disk won't load the data).

## Updating data
`data/units.json` and `data/glossary.json` hold everything. After editing, bump `VERSION` in `sw.js` so installed copies refresh.

Unit data, rules text and miniature photos are © Warcradle Studios. A public GitHub Pages site is visible to anyone, so consider who you share it with.
