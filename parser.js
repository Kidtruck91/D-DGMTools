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
    const attack = { name: name.trim(), bonus: null, damage: "", count: 1, description: text.trim() };
    const hit = text.match(/(?:Weapon Attack|Spell Attack|Attack Roll)[^:]*:\s*([+-]\s*\d+)/i);
    if (hit) attack.bonus = toInt(hit[1]);
    const hitIndex = text.search(/\bHit:/i);
    let damageText = hitIndex >= 0 ? text.slice(hitIndex) : "";
    if (!damageText && /\b(?:saving throw|Failure:|takes)\b/i.test(text)) damageText = text;
    if (damageText) {
      // Stop at "Miss:" or "Success:" so half-damage text is not added twice.
      damageText = damageText.split(/\b(?:Miss:|Success:|or half as much)/i)[0];
      const dice = [];
      const re = /\d+\s*\(\s*(\d+d\d+(?:\s*[+-]\s*\d+)?)\s*\)/gi;
      let m;
      while ((m = re.exec(damageText)) && dice.length < 4) dice.push(cleanDice(m[1]));
      if (dice.length) attack.damage = dice.join("+").replace(/\+-/g, "-");
    }
    return attack;
  }

  // Reads a Multiattack description and sets each attack's count (0 = not part of multiattack).
  function applyMultiattack(text, attacks) {
    const t = " " + String(text || "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ") + " ";
    const weaponAttacks = attacks.filter((a) => a.bonus != null || a.damage);
    let any = false;
    const counts = attacks.map((a) => {
      const words = a.name.toLowerCase().replace(/\([^)]*\)/g, "").replace(/[^a-z0-9 ]+/g, " ").trim();
      if (!words) return null;
      const stem = singular(words.split(/\s+/).pop());
      // Skipped words may not be another count or a joining word, so "two attacks: one with its beak" counts the beak once.
      const skip = "(?:(?!(?:\\d+|one|two|three|four|five|six|a|an|once|twice|thrice|and|or|then|uses|use|plus)\\b)[a-z]+\\s+)";
      const re = new RegExp("\\b(\\d+|one|two|three|four|five|six|a|an|once|twice|thrice)\\s+" + skip + "{0,3}?(?:with\\s+(?:its|their|his|her)\\s+)?" + skip + "{0,2}?" + stem + "[a-z]*\\b", "g");
      let total = null;
      let m;
      while ((m = re.exec(t))) {
        const n = toInt(m[1]);
        if (n) total = (total || 0) + n;
      }
      if (total == null && new RegExp("\\b" + stem + "[a-z]*\\b").test(t)) total = 1;
      if (total != null) any = true;
      return total;
    });
    if (any) {
      attacks.forEach((a, i) => { a.count = Math.min(20, counts[i] || 0); });
      return;
    }
    const overall = t.match(/makes\s+(\w+)\s+(?:\w+\s+){0,2}?attacks?/);
    const n = overall ? toInt(overall[1]) : null;
    if (n && weaponAttacks.length === 1) {
      attacks.forEach((a) => { a.count = a === weaponAttacks[0] ? Math.min(20, n) : 0; });
    }
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
    const monster = { kind: "creature", name: "", initiative: 0, initiative_bonus: 0, hp: null, max_hp: null, ac: null, traits: "", ma: false, attacks: [], source: "" };

    monster.name = lines.find((l) => !/^(source|monster|stat block)\b/i.test(l)) || lines[0];
    monster.name = monster.name.replace(/\s+(?:CR|Challenge)\s.*$/i, "").trim();

    const ac = flat.match(/(?:Armor Class|\bAC)\s*:?\s*(\d+)/i);
    if (ac) monster.ac = parseInt(ac[1], 10);
    const hp = flat.match(/(?:Hit Points|\bHP)\s*:?\s*(\d+)/i);
    if (hp) monster.hp = monster.max_hp = parseInt(hp[1], 10);
    const src = flat.match(/^Source:?\s*(.+?)(?:,\s*(?:pg|page)\.?.*)?$/im);
    if (src) monster.source = src[1].trim();

    const init = flat.match(/\bInitiative\s*:?\s*([+-]\s*\d+)/i);
    if (init) {
      monster.initiative_bonus = toInt(init[1]);
    } else {
      let dex = flat.match(/\bDEX(?:terity)?\b\s*:?\s*(\d+)\s*\(?\s*[+-]/i);
      if (dex) {
        monster.initiative_bonus = abilityMod(dex[1]);
      } else {
        // Column layout: "STR DEX CON ..." header followed by "14 (+2) 12 (+1) ..."
        const header = lines.findIndex((l) => /\bSTR\b/i.test(l) && /\bDEX\b/i.test(l));
        if (header >= 0) {
          const after = lines.slice(header + 1, header + 8).join(" ");
          const scores = [...after.matchAll(/(\d+)\s*\(\s*[+-]\s*\d+\s*\)/g)];
          if (scores.length >= 2) monster.initiative_bonus = abilityMod(scores[1][1]);
        }
      }
    }

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
    if (multi) {
      monster.ma = true;
      monster.traits = ("Multiattack. " + multi + (monster.traits ? "\n" + monster.traits : "")).trim();
      applyMultiattack(multi, monster.attacks);
    }
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
      ma: false,
      attacks: [],
      source: rec.document__title || "",
    };
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
    if (multi) {
      monster.ma = true;
      traits.unshift("Multiattack. " + multi);
      applyMultiattack(multi, monster.attacks);
    }
    monster.traits = traits.filter(Boolean).join("\n").trim();
    return monster;
  }

  const api = { roll, rollD20, abilityMod, parseAction, applyMultiattack, parseStatBlock, splitStatBlocks, fromOpen5e, isDice };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.GM = api;
})(typeof window !== "undefined" ? window : globalThis);
