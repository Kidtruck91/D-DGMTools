/* Pure logic: dice rolling, stat block parsing, Open5e mapping.
   Works in the browser (window.GM) and in Node (module.exports) for tests. */
(function (root) {
  "use strict";

  /* ---------- Dice ---------- */
  const TERM = /^([+-]?)(?:(\d*)d(\d+)|(\d+))$/i;

  function roll(expression, options) {
    const opts = options || {};
    const expr = String(expression || "").replace(/\s+/g, "").replace(/[−–]/g, "-").toLowerCase();
    if (!expr) throw new Error("Enter a dice expression, such as 2d6+3.");
    const parts = expr.match(/[+-]?[^+-]+/g) || [];
    if (parts.join("") !== expr) throw new Error("That isn't a dice expression. Try d20, 2d6+3 or 1d8-1.");
    const rng = opts.rng || Math.random;
    let total = 0;
    const details = [];
    const kept = [];
    for (const part of parts) {
      const m = part.match(TERM);
      if (!m) throw new Error("Use dice terms such as d20, 2d6+3 or 1d8-1.");
      const sign = m[1] === "-" ? -1 : 1;
      if (m[3]) {
        let n = parseInt(m[2] || "1", 10);
        const d = parseInt(m[3], 10);
        if (n < 1 || n > 100 || d < 2 || d > 1000) throw new Error("Use 1–100 dice with 2–1000 sides each.");
        if (opts.crit) n *= 2;
        const values = [];
        for (let i = 0; i < n; i++) values.push(1 + Math.floor(rng() * d));
        const sum = values.reduce((a, b) => a + b, 0);
        total += sign * sum;
        details.push((sign < 0 ? "− " : "+ ") + "[" + values.join(", ") + "]");
        kept.push({ sides: d, values });
      } else {
        total += sign * parseInt(m[4], 10);
        details.push((sign < 0 ? "− " : "+ ") + m[4]);
      }
    }
    return { total, detail: details.join(" ").replace(/^\+ /, ""), dice: kept };
  }

  function rollD20(mode, rng) {
    const r = rng || Math.random;
    const a = 1 + Math.floor(r() * 20);
    if (!mode || mode === "normal") return { value: a, rolls: [a] };
    const b = 1 + Math.floor(r() * 20);
    return { value: mode === "adv" ? Math.max(a, b) : Math.min(a, b), rolls: [a, b] };
  }

  function abilityMod(score) {
    const n = parseInt(score, 10);
    return Number.isFinite(n) ? Math.floor((n - 10) / 2) : 0;
  }

  /* ---------- Helpers ---------- */
  const NUMBER_WORDS = { a: 1, an: 1, one: 1, once: 1, two: 2, twice: 2, three: 3, thrice: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };

  function toInt(text) {
    if (text == null) return null;
    const t = String(text).replace(/[−–]/g, "-").replace(/\s+/g, "");
    if (/^[+-]?\d+$/.test(t)) return parseInt(t, 10);
    const w = NUMBER_WORDS[t.toLowerCase()];
    return w == null ? null : w;
  }

  function cleanDice(text) {
    return String(text || "").replace(/[−–]/g, "-").replace(/\s+/g, "");
  }

  function isDice(text) {
    try { roll(text); return true; } catch (e) { return false; }
  }

  function singular(word) {
    return word.replace(/(?:es|s)$/i, "");
  }

  /* ---------- Action entries ---------- */
  // Turns "Scimitar" + "Melee Weapon Attack: +4 to hit ... Hit: 5 (1d6 + 2) slashing damage." into an attack.
  function parseAction(name, desc) {
    const text = String(desc || "").replace(/[−–]/g, "-");
    const attack = { name: name.trim(), bonus: null, damage: "", description: text.trim() };
    const hit = text.match(/(?:Weapon Attack|Spell Attack|Attack Roll)[^:]*:\s*([+-]\s*\d+)/i);
    if (hit) attack.bonus = toInt(hit[1]);
    const hitIndex = text.search(/\bHit:/i);
    let damageText = hitIndex >= 0 ? text.slice(hitIndex) : "";
    if (!damageText && /\b(?:saving throw|Failure:|takes)\b/i.test(text)) damageText = text;
    if (damageText) {
      // Stop at "Miss:" or "Success:" so half-damage text is not added twice.
      damageText = damageText.split(/\b(?:Miss:|Success:|or half as much)/i)[0];
      // "7 (1d6 + 4) piercing damage, or 8 (1d8 + 4) … if used with two hands" is a choice, not a sum.
      const parts = damageText.split(/,?\s+or\s+(?=\d+\s*\(\s*\d+d\d+)/i);
      // A trailing ", plus 3 (1d6) fire damage" after the last choice applies to every choice.
      let shared = [];
      if (parts.length > 1) {
        const last = parts.length - 1;
        const plus = parts[last].search(/,\s*plus\s+\d+\s*\(/i);
        if (plus >= 0) { shared = diceIn(parts[last].slice(plus)); parts[last] = parts[last].slice(0, plus); }
      }
      const primary = diceIn(parts[0]).concat(shared);
      if (primary.length) attack.damage = joinDice(primary);
      const alts = parts.slice(1).map((part) => {
        const dice = diceIn(part).concat(shared);
        return dice.length ? { damage: joinDice(dice), label: choiceLabel(part) } : null;
      }).filter(Boolean);
      if (alts.length && attack.damage) attack.alt = alts;
    }
    return attack;
  }

  function diceIn(text) {
    const dice = [];
    const re = /\d+\s*\(\s*(\d+d\d+(?:\s*[+-]\s*\d+)?)\s*\)/gi;
    let m;
    while ((m = re.exec(text)) && dice.length < 4) dice.push(cleanDice(m[1]));
    return dice;
  }
  const joinDice = (dice) => dice.join("+").replace(/\+-/g, "-");

  // A short name for an alternative damage option, from the words after it.
  function choiceLabel(text) {
    const t = String(text).replace(/^[^)]*\)\s*/, "").replace(/\s+/g, " ").trim();
    if (/two hands|two-handed|both hands/i.test(t)) return "two-handed";
    if (/half (?:of )?(?:its|their) (?:hit points|hp)|half or fewer hit points|\bbloodied\b/i.test(t)) return "at half HP";
    if (/\bmov(?:es|ed) at least\b/i.test(t)) return "after moving";
    if (/\bused to make a melee attack\b|\bin melee\b/i.test(t)) return "melee";
    if (/\branged\b|\bthrown\b/i.test(t)) return "ranged";
    const form = t.match(/\bin (\w+) form\b/i);
    if (form) return form[1].toLowerCase() + " form";
    const cond = t.match(/\b((?:if|while|when|with|against)\b[^.,;]{1,40})/i);
    if (cond) {
      const phrase = cond[1].trim().toLowerCase();
      return phrase.length <= 26 ? phrase : phrase.slice(0, 24).replace(/\s+\S*$/, "") + "…";
    }
    return "alternate";
  }

  /* ---------- Abilities, saves and skills ---------- */
  const ABILITIES = ["str", "dex", "con", "int", "wis", "cha"];
  const ABILITY_RE = /\b(str|dex|con|int|wis|cha)(?:ength|terity|stitution|elligence|dom|risma)?\b/i;

  // "Dex +5, Con +6" → { dex: 5, con: 6 }
  function parseSaves(text) {
    const saves = {};
    const re = /\b(str|dex|con|int|wis|cha)[a-z]*\.?\s*([+-]\s*\d+)/gi;
    let m;
    while ((m = re.exec(String(text || "").replace(/[−–]/g, "-")))) saves[m[1].toLowerCase()] = toInt(m[2]);
    return saves;
  }
  const SKILLS = ["acrobatics", "animal handling", "arcana", "athletics", "deception", "history", "insight", "intimidation", "investigation", "medicine", "nature", "perception", "performance", "persuasion", "religion", "sleight of hand", "stealth", "survival"];
  const SKILL_ALIASES = { animal: "animal handling", sleight: "sleight of hand", "animal_handling": "animal handling", "sleight_of_hand": "sleight of hand" };
  function skillName(raw) {
    const k = String(raw).trim().toLowerCase();
    const name = SKILL_ALIASES[k] || k.replace(/_/g, " ");
    return SKILLS.includes(name) ? name : null;
  }
  // "Perception +5, Sleight of Hand +4" → { perception: 5, "sleight of hand": 4 }
  function parseSkills(text) {
    const skills = {};
    const re = /([A-Za-z][A-Za-z' ]*?)\s*([+-]\s*\d+)/g;
    let m;
    while ((m = re.exec(String(text || "").replace(/[−–]/g, "-")))) {
      const name = skillName(m[1].trim().replace(/^,\s*/, ""));
      if (name) skills[name] = toInt(m[2]);
    }
    return skills;
  }
  const formatBonuses = (map) => Object.entries(map || {}).map(([k, v]) => k.replace(/\b\w/g, (c) => c.toUpperCase()) + " " + (v >= 0 ? "+" : "") + v).join(", ");

  function parseAbilityBlock(lines, flat) {
    const abilities = {};
    const saves = {};
    // 2024 style: "Str 15 +2 +4" (score, modifier, save), possibly split over lines.
    const spaced = lines.join(" ");
    const modern = /\b(str|dex|con|int|wis|cha)\b\s*(\d{1,2})\s+([+-]\s*\d+)\s+([+-]\s*\d+)/gi;
    let m;
    while ((m = modern.exec(spaced))) {
      const key = m[1].toLowerCase();
      if (abilities[key] != null) continue;
      abilities[key] = parseInt(m[2], 10);
      const mod = toInt(m[3]);
      const save = toInt(m[4]);
      if (save !== mod) saves[key] = save;
    }
    if (Object.keys(abilities).length < 6) {
      // 2014 style: "STR 20 (+5)" one per line, or a header row then "19 (+4) 8 (-1) …".
      const pair = /\b(str|dex|con|int|wis|cha)\b\s*:?\s*(\d{1,2})\s*\(\s*[+-]\s*\d+\s*\)/gi;
      while ((m = pair.exec(spaced))) {
        const key = m[1].toLowerCase();
        if (abilities[key] == null) abilities[key] = parseInt(m[2], 10);
      }
    }
    if (Object.keys(abilities).length < 6) {
      const header = lines.findIndex((l) => /\bSTR\b/i.test(l) && /\bDEX\b/i.test(l) && /\bCHA\b/i.test(l));
      if (header >= 0) {
        const after = lines.slice(header + 1, header + 8).join(" ");
        const scores = [...after.matchAll(/(\d{1,2})\s*\(\s*[+-]\s*\d+\s*\)/g)].slice(0, 6);
        if (scores.length === 6) ABILITIES.forEach((k, i) => { abilities[k] = parseInt(scores[i][1], 10); });
      }
    }
    const saveLine = flat.match(/^(?:Saving Throws|Saves)\s*:?\s*(.+)$/im);
    if (saveLine) Object.assign(saves, parseSaves(saveLine[1]));
    const skillLine = flat.match(/^Skills\s*:?\s*(.+)$/im);
    const skills = skillLine ? parseSkills(skillLine[1]) : {};
    return { abilities: Object.keys(abilities).length ? abilities : null, saves, skills };
  }

  /* ---------- D&D Beyond / book stat block text ---------- */
  const SECTION = /^(traits|actions|bonus actions|reactions|legendary actions|lair actions|mythic actions|regional effects)\s*:?$/i;
  const STAT_LINE = /^(armor class|ac|hit points|hp|speed|initiative|str|dex|con|int|wis|cha|mod|save|saving throws|skills|damage|condition|senses|languages|challenge|cr|proficiency bonus|gear|immunities|resistances|vulnerabilities)\b/i;
  const ENTRY = /^([A-Z][^.:]{0,70}?(?:\s*\([^)]{0,60}\))?)\.\s+(\S.*)$/;

  function parseStatBlock(rawText) {
    const text = String(rawText || "").replace(/\r/g, "").replace(/[−–]/g, "-").replace(/ /g, " ");
    const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
    if (!lines.length) throw new Error("Paste a stat block first.");
    const flat = lines.join("\n");
    const monster = { kind: "creature", name: "", initiative: 0, initiative_bonus: 0, hp: null, max_hp: null, ac: null, traits: "", attacks: [], source: "" };

    monster.name = lines.find((l) => !/^(source|monster|stat block)\b/i.test(l)) || lines[0];
    monster.name = monster.name.replace(/\s+(?:CR|Challenge)\s.*$/i, "").trim();

    const ac = flat.match(/(?:Armor Class|\bAC)\s*:?\s*(\d+)/i);
    if (ac) monster.ac = parseInt(ac[1], 10);
    const hp = flat.match(/(?:Hit Points|\bHP)\s*:?\s*(\d+)/i);
    if (hp) monster.hp = monster.max_hp = parseInt(hp[1], 10);
    const src = flat.match(/^Source:?\s*(.+?)(?:,\s*(?:pg|page)\.?.*)?$/im);
    if (src) monster.source = src[1].trim();

    const block = parseAbilityBlock(lines, flat);
    if (block.abilities) monster.abilities = block.abilities;
    if (Object.keys(block.saves).length) monster.saves = block.saves;
    if (Object.keys(block.skills).length) monster.skills = block.skills;
    const init = flat.match(/\bInitiative\s*:?\s*([+-]\s*\d+)/i);
    if (init) monster.initiative_bonus = toInt(init[1]);
    else if (block.abilities && block.abilities.dex != null) monster.initiative_bonus = abilityMod(block.abilities.dex);

    // Split remaining text into sections of "Name. Description" entries.
    const sections = { traits: [], actions: [], other: [] };
    let current = "traits";
    let currentLabel = "";
    let pastStats = false;
    let last = null;
    for (const line of lines.slice(1)) {
      const sec = line.match(SECTION);
      if (sec) {
        const label = sec[1].toLowerCase();
        current = label === "actions" ? "actions" : label === "traits" ? "traits" : "other";
        currentLabel = sec[1].replace(/\b\w/g, (c) => c.toUpperCase());
        if (current === "other") sections.other.push({ heading: currentLabel });
        pastStats = true;
        last = null;
        continue;
      }
      if (!pastStats) {
        if (/^(challenge|cr|proficiency bonus)\b/i.test(line)) { pastStats = true; continue; }
        if (STAT_LINE.test(line) || /^\d+\s*\(?\s*[+-]?\d*\)?$/.test(line) || /^[+-]\d+$/.test(line) || /^(tiny|small|medium|large|huge|gargantuan)\b/i.test(line) || /^source\b/i.test(line)) continue;
        const e = line.match(ENTRY);
        if (!e) continue;
        pastStats = true;
      }
      const e = line.match(ENTRY);
      if (e) {
        last = { name: e[1].trim(), desc: e[2].trim() };
        sections[current].push(last);
      } else if (last) {
        last.desc += " " + line;
      } else if (current === "other") {
        sections.other.push({ name: "", desc: line });
      }
    }

    const traitText = sections.traits.map((t) => t.name + ". " + t.desc);
    const otherText = sections.other.map((t) => (t.heading ? "\n" + t.heading + ":" : (t.name ? t.name + ". " : "") + t.desc));
    monster.traits = traitText.concat(otherText).join("\n").trim();

    let multi = null;
    for (const a of sections.actions) {
      if (/^multiattack$/i.test(a.name)) { multi = a.desc; continue; }
      monster.attacks.push(parseAction(a.name, a.desc));
    }
    if (multi) monster.multiattack = multi.trim();
    if (!monster.name) throw new Error("Couldn't find a monster name on the first line.");
    return monster;
  }

  /* ---------- Several stat blocks pasted together ---------- */
  const SIZE_TYPE = /^(tiny|small|medium|large|huge|gargantuan)\b(?:\s+or\s+\w+)?[\s,]+\w/i;
  const SEPARATOR = /^\s*(?:-{3,}|={3,}|\*{3,})\s*$/;

  // Splits pasted text into one chunk per monster. A monster starts at the
  // line before a "Medium humanoid…" line that is followed by an AC line,
  // or after a separator line such as ---.
  function splitStatBlocks(rawText) {
    const lines = String(rawText || "").replace(/\r/g, "").split("\n");
    const starts = new Set();
    lines.forEach((line, i) => {
      if (SEPARATOR.test(line)) { starts.add(i + 1); return; }
      if (!SIZE_TYPE.test(line.trim())) return;
      const ahead = lines.slice(i + 1, i + 7).join("\n");
      if (!/^\s*(?:Armor Class|AC)\b/im.test(ahead)) return;
      let j = i - 1;
      while (j > 0 && !lines[j].trim()) j--;
      starts.add(Math.max(0, j));
    });
    const sorted = [0].concat(Array.from(starts).filter((s) => s > 0).sort((a, b) => a - b));
    const chunks = [];
    sorted.forEach((start, k) => {
      const end = k + 1 < sorted.length ? sorted[k + 1] : lines.length;
      const chunk = lines.slice(start, end).filter((l) => !SEPARATOR.test(l)).join("\n").trim();
      if (chunk) chunks.push(chunk);
    });
    // Text before the first real stat block (stray headings) is not a monster.
    return chunks.filter((c) => /\b(?:Armor Class|AC|Hit Points|HP)\b/.test(c));
  }

  /* ---------- Open5e ---------- */
  function fromOpen5e(rec) {
    const monster = {
      kind: "creature",
      name: rec.name || "Unnamed",
      initiative: 0,
      initiative_bonus: abilityMod(rec.dexterity),
      hp: rec.hit_points != null ? rec.hit_points : null,
      max_hp: rec.hit_points != null ? rec.hit_points : null,
      ac: rec.armor_class != null ? rec.armor_class : null,
      traits: "",
      attacks: [],
      source: rec.document__title || "",
    };
    const names = { str: "strength", dex: "dexterity", con: "constitution", int: "intelligence", wis: "wisdom", cha: "charisma" };
    if (ABILITIES.every((k) => Number.isFinite(rec[names[k]]))) {
      monster.abilities = {};
      ABILITIES.forEach((k) => { monster.abilities[k] = rec[names[k]]; });
    }
    const saves = {};
    ABILITIES.forEach((k) => { const v = rec[names[k] + "_save"]; if (v != null && v !== "") saves[k] = parseInt(v, 10); });
    if (Object.keys(saves).length) monster.saves = saves;
    let skills = rec.skills;
    if (typeof skills === "string") { try { skills = JSON.parse(skills); } catch (e) { skills = null; } }
    if (skills && typeof skills === "object" && !Array.isArray(skills)) {
      const clean = {};
      Object.entries(skills).forEach(([k, v]) => { const name = skillName(k); if (name && v != null && v !== "" && Number.isFinite(+v)) clean[name] = +v; });
      if (Object.keys(clean).length) monster.skills = clean;
    }
    const describe = (list) => (Array.isArray(list) ? list : []).map((x) => x.name + ". " + (x.desc || "")).join("\n");
    const traits = [describe(rec.special_abilities)];
    if (Array.isArray(rec.bonus_actions) && rec.bonus_actions.length) traits.push("Bonus Actions:\n" + describe(rec.bonus_actions));
    if (Array.isArray(rec.reactions) && rec.reactions.length) traits.push("Reactions:\n" + describe(rec.reactions));
    if (Array.isArray(rec.legendary_actions) && rec.legendary_actions.length) traits.push("Legendary Actions:\n" + (rec.legendary_desc ? rec.legendary_desc + "\n" : "") + describe(rec.legendary_actions));
    let multi = null;
    for (const action of Array.isArray(rec.actions) ? rec.actions : []) {
      if (/^multiattack$/i.test(action.name || "")) { multi = action.desc; continue; }
      const attack = parseAction(action.name || "Action", action.desc);
      if (action.attack_bonus != null && (attack.bonus != null || /attack/i.test(action.desc || ""))) attack.bonus = parseInt(action.attack_bonus, 10);
      if (!attack.damage && action.damage_dice) {
        let dice = cleanDice(action.damage_dice);
        if (action.damage_bonus && !/[+-]\d+$/.test(dice)) dice += (action.damage_bonus > 0 ? "+" : "") + action.damage_bonus;
        if (isDice(dice)) attack.damage = dice;
      }
      monster.attacks.push(attack);
    }
    if (multi) monster.multiattack = multi.trim();
    monster.traits = traits.filter(Boolean).join("\n").trim();
    return monster;
  }

  const api = { roll, rollD20, abilityMod, parseAction, parseSaves, parseSkills, formatBonuses, ABILITIES, parseStatBlock, splitStatBlocks, fromOpen5e, isDice };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.GM = api;
})(typeof window !== "undefined" ? window : globalThis);
