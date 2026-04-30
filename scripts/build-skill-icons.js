// Build menu-bar icons for each skill from Font Awesome Free SVGs.
//
// Output is committed under assets/skill-icons/ as <Skill>Template.png and
// <Skill>Template@2x.png. The "Template" suffix tells Electron's nativeImage
// to treat them as template images — macOS auto-tints them to the menu bar's
// foreground color (white in dark menu bar, black in light), giving us
// crisp, high-contrast icons regardless of the user's appearance.
//
// Run once locally: `node scripts/build-skill-icons.js`. Re-run to add a
// new skill or replace an icon. Sharp is a devDependency only — runtime
// just reads the resulting PNGs.
//
// Font Awesome Free is licensed under SIL OFL 1.1 (font) and CC BY 4.0
// (icons). Attribution is in the README.

const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');

const ICONS = {
  Attack: 'gavel',
  Strength: 'dumbbell',
  Defence: 'shield-halved',
  Defense: 'shield-halved',
  Health: 'heart-pulse',
  Woodcutting: 'tree',
  Mining: 'gem',
  Fishing: 'fish',
  Gathering: 'seedling',
  Tracking: 'magnifying-glass',
  Crafting: 'screwdriver-wrench',
  Smithing: 'hammer',
  Cooking: 'utensils',
  Alchemy: 'flask',
  Tailoring: 'scissors',
  Carpentry: 'ruler-combined',
  Community: 'users',
  Landkeeping: 'tractor',
};

const FA_BASE = 'https://raw.githubusercontent.com/FortAwesome/Font-Awesome/6.x/svgs/solid';
const OUT_DIR = path.join(__dirname, '..', 'assets', 'skill-icons');

async function downloadSvg(faName) {
  const url = `${FA_BASE}/${faName}.svg`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${faName}: HTTP ${res.status} from ${url}`);
  return await res.text();
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const seen = new Set();
  for (const [skill, faName] of Object.entries(ICONS)) {
    if (seen.has(skill)) continue;
    seen.add(skill);
    const svg = await downloadSvg(faName);
    for (const size of [16, 32]) {
      const suffix = size === 16 ? '' : '@2x';
      const outPath = path.join(OUT_DIR, `${skill}Template${suffix}.png`);
      await sharp(Buffer.from(svg))
        .resize(size, size, {
          fit: 'contain',
          background: { r: 0, g: 0, b: 0, alpha: 0 },
        })
        .png()
        .toFile(outPath);
      console.log(`  ${outPath}`);
    }
  }
  console.log(`\nWrote ${seen.size * 2} icons to ${OUT_DIR}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
