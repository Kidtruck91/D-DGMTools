// Builds data/open5e-monsters.json and data/OPEN5E-LICENSES.md from the Open5e data repository.
//
//   git clone --depth 1 https://github.com/open5e/open5e-api
//   node tools/build-open5e.js path/to/open5e-api/data
//
// Rerun it whenever you want the latest Open5e monsters.
const fs = require("fs");
const path = require("path");
const GM = require("../parser.js");

const dataDir = process.argv[2];
if (!dataDir || !fs.existsSync(path.join(dataDir, "v1"))) {
  console.error("Usage: node tools/build-open5e.js path/to/open5e-api/data");
  process.exit(1);
}
const v1 = path.join(dataDir, "v1");
const outDir = path.join(__dirname, "..", "data");
const parseJSON = (text) => { try { return JSON.parse(text); } catch (e) { return null; } };

const sources = [];
const monsters = [];
for (const folder of fs.readdirSync(v1).sort()) {
  const monsterFile = path.join(v1, folder, "Monster.json");
  const docFile = path.join(v1, folder, "Document.json");
  if (!fs.existsSync(monsterFile) || !fs.existsSync(docFile)) continue;
  const doc = JSON.parse(fs.readFileSync(docFile, "utf8"))[0].fields;
  const records = JSON.parse(fs.readFileSync(monsterFile, "utf8"));
  if (!records.length) continue;
  sources.push({ slug: doc.slug, title: doc.title, license: doc.license, copyright: doc.copyright || "", url: doc.url || "", count: records.length });
  for (const rec of records) {
    const f = rec.fields;
    // The fixtures store lists as JSON strings; fromOpen5e expects the API's shape.
    const apiShape = Object.assign({}, f, {
      slug: rec.pk,
      document__title: doc.title,
      actions: parseJSON(f.actions_json) || [],
      bonus_actions: parseJSON(f.bonus_actions_json) || [],
      reactions: parseJSON(f.reactions_json) || [],
      legendary_actions: parseJSON(f.legendary_actions_json) || [],
      special_abilities: parseJSON(f.special_abilities_json) || [],
      skills: parseJSON(f.skills_json) || null,
    });
    const m = GM.fromOpen5e(apiShape);
    m.id = "o5:" + rec.pk;
    m.cr = f.challenge_rating || "";
    m.type = [f.size, f.type].filter(Boolean).join(" ").toLowerCase();
    monsters.push(m);
  }
}
monsters.sort((a, b) => a.name.localeCompare(b.name) || a.source.localeCompare(b.source));

// Drop empty fields to keep the download small.
const compact = monsters.map((m) => {
  const out = {};
  for (const [k, v] of Object.entries(m)) {
    if (v === null || v === "" || v === false || (Array.isArray(v) && !v.length) || k === "kind" || k === "initiative") continue;
    if (k === "max_hp" && v === m.hp) continue;
    out[k] = k === "attacks" ? v.map((a) => { const o = {}; for (const [ak, av] of Object.entries(a)) { if (av === null || av === "") continue; o[ak] = av; } return o; }) : v;
  }
  return out;
});

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, "open5e-monsters.json"), JSON.stringify({ built: new Date().toISOString().slice(0, 10), sources: sources.map(({ copyright, url, ...s }) => s), monsters: compact }));

const licenses = parseJSON(fs.readFileSync(path.join(dataDir, "v2", "License.json"), "utf8")) || [];
const ogl = licenses.find((l) => l.pk === "ogl-10a");
const ccby = licenses.find((l) => l.pk === "cc-by-40");
let md = "# Open5e monster data: sources and licenses\n\n";
md += "The bundled bestiary in `open5e-monsters.json` comes from [Open5e](https://open5e.com) (github.com/open5e/open5e-api). It is used under the license each source names below. GM Tools itself is not affiliated with any of these publishers.\n\n";
for (const s of sources) md += "## " + s.title + "\n\n" + s.count + " monsters · " + s.license + "\n\n" + s.copyright.trim() + "\n\n";
if (ogl) md += "---\n\n# " + ogl.fields.name + "\n\n" + ogl.fields.desc.trim() + "\n\n";
if (ccby) md += "---\n\n# " + ccby.fields.name + "\n\n" + ccby.fields.desc.trim() + "\n";
fs.writeFileSync(path.join(outDir, "OPEN5E-LICENSES.md"), md);

console.log(monsters.length + " monsters from " + sources.length + " sources");
sources.forEach((s) => console.log("  " + s.title + ": " + s.count));
