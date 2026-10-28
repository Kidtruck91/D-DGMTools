/* GM Tools — combat tracker, monster library, built-in bestiary and dice roller. */
(function () {
  "use strict";
  const GM = window.GM;
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const CONDITIONS = ["Blinded", "Charmed", "Concentrating", "Deafened", "Frightened", "Grappled", "Incapacitated", "Invisible", "Paralyzed", "Petrified", "Poisoned", "Prone", "Restrained", "Stunned", "Unconscious"];

  /* ---------- Storage ---------- */
  const store = {
    get(key, fallback) {
      try { const v = localStorage.getItem("gmtools." + key); return v == null ? fallback : JSON.parse(v); }
      catch (e) { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem("gmtools." + key, JSON.stringify(value)); return true; }
      catch (e) { toast("Couldn't save on this device. Export your monsters to a file to keep them."); return false; }
    },
  };

  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
  let orderCounter = Date.now();

  const state = {
    combat: store.get("combat", { round: 1, activeId: null, entities: [] }),
    monsters: store.get("monsters", []),
    prefs: store.get("prefs", {}),
    selectedId: null,
    lastRoll: null,
    log: store.get("log", []),
  };
  // Older saves kept multiattack as the first line of traits, with a count on each attack.
  function upgradeMonster(m) {
    if (!m || m.kind === "event") return m;
    if (!m.multiattack && m.traits) {
      const line = m.traits.match(/^Multiattack\.\s*(.+)$/m);
      if (line) { m.multiattack = line[1].trim(); m.traits = m.traits.replace(line[0], "").replace(/^\n+/, "").trim(); }
    }
    delete m.ma;
    const names = (m.attacks || []).map((a) => a.name);
    (m.attacks || []).forEach((a) => {
      delete a.count;
      // Damage saved before choices were split ("2d6+4+2d8+4"): read it again from the description.
      if (!a.alt && /,?\s+or\s+\d+\s*\(\s*\d+d\d+/i.test(a.description || "")) {
        const fresh = GM.parseAction(a.name, a.description);
        if (fresh.damage && fresh.alt) { a.damage = fresh.damage; a.alt = fresh.alt; }
      }
    });
    // Pastes from before the D&D Beyond fix left a doubled name at the end of the previous entry.
    if (m.multiattack) names.forEach((n) => { if (n && m.multiattack.endsWith(" " + n)) m.multiattack = m.multiattack.slice(0, -n.length - 1); });
    if (m.traits) {
      const lines = m.traits.split("\n");
      for (let i = 0; i < lines.length - 1; i++) {
        const next = lines[i + 1].match(/^([^.]{1,60})\.\s/);
        if (next && lines[i].endsWith(" " + next[1])) lines[i] = lines[i].slice(0, -next[1].length - 1);
      }
      m.traits = lines.join("\n");
    }
    return m;
  }
  state.combat.entities.forEach((e) => { e.id = e.id || uid(); e.order = e.order || ++orderCounter; upgradeMonster(e); });
  state.monsters.forEach((m) => { m.id = m.id || uid(); upgradeMonster(m); });

  const saveCombat = () => { store.set("combat", state.combat); store.set("log", state.log.slice(0, 80)); };
  const saveMonsters = () => store.set("monsters", state.monsters);
  const savePrefs = () => store.set("prefs", state.prefs);

  /* ---------- Small helpers ---------- */
  function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  function int(v, fallback) {
    const t = String(v == null ? "" : v).trim().replace(/[−–]/g, "-");
    if (t === "") return fallback;
    if (!/^[+-]?\d+$/.test(t)) throw new Error("“" + t + "” isn't a whole number.");
    return parseInt(t, 10);
  }
  const signed = (n) => (n >= 0 ? "+" : "−") + Math.abs(n);
  const clone = (o) => JSON.parse(JSON.stringify(o));
  let toastTimer;
  function toast(msg) {
    const t = $("#toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("show"), 2600);
  }
  function hpClass(hp, max) {
    const f = max ? hp / max : 1;
    return f <= 0.25 ? "low" : f <= 0.5 ? "mid" : "";
  }
  function download(name, data) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  function pickFile(handler) {
    const input = $("#file-input");
    input.value = "";
    input.onchange = () => {
      const file = input.files[0];
      if (!file) return;
      file.text().then((text) => {
        let data;
        try { data = JSON.parse(text); } catch (e) { toast("That file isn't valid JSON."); return; }
        handler(data, file.name);
      });
    };
    input.click();
  }

  /* ---------- Views ---------- */
  function showView(name) {
    $$(".tab").forEach((t) => {
      if (t.dataset.view === name) t.setAttribute("aria-current", "page");
      else t.removeAttribute("aria-current");
    });
    $$(".view").forEach((v) => { v.hidden = v.id !== "view-" + name; });
    state.prefs.view = name;
    savePrefs();
    if (name === "monsters") renderLibrary();
  }
  $$(".tab").forEach((t) => t.addEventListener("click", () => showView(t.dataset.view)));

  function applyTheme() {
    const theme = state.prefs.theme || (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
    document.documentElement.dataset.theme = theme;
    $("#theme-btn").textContent = theme === "dark" ? "Light" : "Dark";
    $('meta[name="theme-color"]').setAttribute("content", theme === "dark" ? "#15232A" : "#E4EBE8");
  }
  $("#theme-btn").addEventListener("click", () => {
    state.prefs.theme = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    savePrefs();
    applyTheme();
  });

  // Keep the tablet screen awake during play.
  let wakeLock = null;
  async function setWake(on) {
    const btn = $("#wake-btn");
    if (!("wakeLock" in navigator)) { btn.hidden = true; return; }
    try {
      if (on) { wakeLock = await navigator.wakeLock.request("screen"); wakeLock.addEventListener("release", () => { if (!document.hidden) updateWakeBtn(false); }); }
      else if (wakeLock) { await wakeLock.release(); wakeLock = null; }
      updateWakeBtn(on);
    } catch (e) { updateWakeBtn(false); toast("This browser won't keep the screen on right now."); }
  }
  function updateWakeBtn(on) {
    const btn = $("#wake-btn");
    btn.setAttribute("aria-pressed", String(on));
    btn.textContent = "Screen stays on: " + (on ? "on" : "off");
    state.prefs.wake = on;
    savePrefs();
  }
  $("#wake-btn").addEventListener("click", () => setWake($("#wake-btn").getAttribute("aria-pressed") !== "true"));
  document.addEventListener("visibilitychange", () => { if (!document.hidden && state.prefs.wake && !wakeLock) setWake(true); });

  /* ---------- Combat model ---------- */
  function sorted() {
    return state.combat.entities.slice().sort((a, b) =>
      (b.initiative - a.initiative) ||
      ((a.kind === "event") - (b.kind === "event")) ||
      ((b.initiative_bonus || 0) - (a.initiative_bonus || 0)) ||
      (a.order - b.order));
  }
  const byId = (id) => state.combat.entities.find((e) => e.id === id);

  function addLog(text) {
    state.log.unshift(text);
    state.log.length = Math.min(state.log.length, 80);
  }

  function addEntity(item) {
    item.id = uid();
    item.order = ++orderCounter;
    if (item.kind === "creature") {
      item.conditions = item.conditions || [];
      if (item.hp != null && item.max_hp == null) item.max_hp = item.hp;
    }
    state.combat.entities.push(item);
    return item;
  }

  function nextTurn() {
    const list = sorted();
    if (!list.length) { toast("Add a creature or event first."); return; }
    const idx = list.findIndex((e) => e.id === state.combat.activeId);
    let next;
    if (idx < 0) { next = 0; }
    else if (idx + 1 >= list.length) { next = 0; state.combat.round += 1; }
    else { next = idx + 1; }
    setActive(list[next]);
  }
  function prevTurn() {
    const list = sorted();
    const idx = list.findIndex((e) => e.id === state.combat.activeId);
    if (idx < 0) return;
    if (idx === 0) {
      if (state.combat.round === 1) { toast("This is the first turn."); return; }
      state.combat.round -= 1;
      setActive(list[list.length - 1], true);
    } else {
      setActive(list[idx - 1], true);
    }
  }
  function setActive(entity, back) {
    state.combat.activeId = entity.id;
    state.selectedId = entity.id;
    addLog((back ? "Back to " : "") + "Round " + state.combat.round + ": " + entity.name + (entity.kind === "event" && entity.description ? " — " + entity.description : ""));
    saveCombat();
    renderCombat();
    const row = $('[data-id="' + entity.id + '"]');
    if (row) row.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  function removeEntity(id) {
    const list = sorted();
    const idx = list.findIndex((e) => e.id === id);
    if (idx < 0) return;
    const entity = list[idx];
    state.combat.entities = state.combat.entities.filter((e) => e.id !== id);
    if (state.combat.activeId === id) {
      // The removed creature's turn ends; the next one in order takes over.
      const rest = sorted();
      if (!rest.length) state.combat.activeId = null;
      else if (idx >= rest.length) { state.combat.round += 1; state.combat.activeId = rest[0].id; }
      else state.combat.activeId = rest[idx].id;
    }
    if (state.selectedId === id) state.selectedId = state.combat.activeId;
    addLog("Removed " + entity.name);
    saveCombat();
    renderCombat();
  }

  function changeHp(entity, mode, amount) {
    if (entity.hp == null) { toast("Edit this creature to set its HP first."); return; }
    const max = entity.max_hp != null ? entity.max_hp : entity.hp;
    if (mode === "damage") {
      let left = amount;
      const temp = entity.temp_hp || 0;
      if (temp) { const used = Math.min(temp, left); entity.temp_hp = temp - used; left -= used; }
      entity.hp = Math.max(0, entity.hp - left);
      addLog(entity.name + " takes " + amount + (temp ? " (" + (amount - left) + " from temp HP)" : "") + " → " + entity.hp + "/" + max);
      if (entity.hp === 0) toast(entity.name + " is down.");
      const conc = (entity.conditions || []).includes("Concentrating");
      if (conc && amount > 0) addLog(entity.name + " makes a Concentration save, DC " + Math.max(10, Math.floor(amount / 2)));
    } else if (mode === "heal") {
      entity.hp = Math.min(max, entity.hp + amount);
      addLog(entity.name + " heals " + amount + " → " + entity.hp + "/" + max);
    } else if (mode === "temp") {
      entity.temp_hp = Math.max(entity.temp_hp || 0, amount);
      addLog(entity.name + " has " + entity.temp_hp + " temp HP");
    }
    saveCombat();
    renderCombat();
  }

  /* ---------- Rolling ---------- */
  function showRoll(num, what, kind) {
    state.lastRoll = { num, what, kind: kind || "" };
    addLog(what + " = " + num);
    saveCombat();
    renderDetail();
  }
  function rollAttack(entity, attack, mode) {
    const d = GM.rollD20(mode);
    const bonus = attack.bonus || 0;
    const tag = d.value === 20 ? "crit" : d.value === 1 ? "fumble" : "";
    const dice = d.rolls.length > 1 ? "[" + d.rolls.join(", ") + "] " + (mode === "adv" ? "adv" : "dis") : d.value;
    showRoll(d.value + bonus, entity.name + " · " + attack.name + " to hit: " + dice + " " + signed(bonus) + (tag === "crit" ? " — natural 20" : tag === "fumble" ? " — natural 1" : ""), tag);
  }
  function rollDamage(entity, attack, crit) {
    if (!attack.damage) { toast(attack.name + " has no damage dice."); return; }
    try {
      const r = GM.roll(attack.damage, { crit });
      const label = entity.name + " · " + attack.name + (crit ? " critical" : "") + " damage";
      if (!(attack.alt || []).length) { showRoll(r.total, label + ": " + r.detail, crit ? "crit" : ""); return; }
      // Damage with a choice (one- or two-handed, full or half HP): roll every option.
      const options = [{ total: r.total, text: r.total + " (" + attack.damage + ": " + r.detail + ")" }];
      attack.alt.forEach((o) => {
        try { const x = GM.roll(o.damage, { crit }); options.push({ total: x.total, text: x.total + " " + o.label + " (" + o.damage + ": " + x.detail + ")" }); }
        catch (e) { /* skip a bad option */ }
      });
      showRoll(options.map((o) => o.total).join(" or "), label + ": " + options.map((o) => o.text).join(" or "), crit ? "crit" : "");
    } catch (e) { toast(e.message); }
  }
  function rollCheck(entity, what, bonus) {
    const d = GM.rollD20();
    const tag = d.value === 20 ? "crit" : d.value === 1 ? "fumble" : "";
    showRoll(d.value + bonus, entity.name + " · " + what + ": " + d.value + " " + signed(bonus) + (tag === "crit" ? " — natural 20" : tag === "fumble" ? " — natural 1" : ""), tag);
  }
  function rollInitiative(bonus) { return 1 + Math.floor(Math.random() * 20) + (bonus || 0); }

  /* ---------- Combat rendering ---------- */
  function renderCombat() {
    const { round, activeId } = state.combat;
    const active = byId(activeId);
    $("#round-num").textContent = round;
    $("#turn-who").textContent = active ? active.name + (active.kind === "event" ? "" : "’s turn") : state.combat.entities.length ? "Ready. Start combat when everyone has initiative." : "Add combatants, then start the first turn.";
    $("#next-turn").textContent = active ? "Next turn" : "Start combat";
    $("#prev-turn").disabled = !active;

    const list = sorted();
    const ol = $("#order");
    if (!list.length) {
      ol.innerHTML = '<li class="order-empty">No one is in this fight yet. Use Add monsters to pull from your library, or Add creature for players and one-off foes.</li>';
    } else {
      ol.innerHTML = list.map((e) => {
        const cls = ["combatant", e.kind === "event" ? "event" : "", e.id === activeId ? "active" : "", e.kind === "creature" && e.hp === 0 ? "down" : ""].join(" ");
        let sub = "";
        if (e.kind === "creature") {
          const max = e.max_hp != null ? e.max_hp : e.hp;
          if (e.hp != null) sub += '<span class="mini-bar" aria-hidden="true"><i class="' + hpClass(e.hp, max) + '" style="width:' + (max ? Math.round((e.hp / max) * 100) : 0) + '%"></i></span><span>' + e.hp + "/" + max + (e.temp_hp ? " +" + e.temp_hp : "") + "</span>";
          (e.conditions || []).forEach((c) => { sub += '<span class="chip">' + esc(c) + "</span>"; });
        } else {
          sub = '<span>' + esc((e.description || "Event").slice(0, 70)) + "</span>";
        }
        return '<li class="' + cls + '" data-id="' + e.id + '" role="option" tabindex="0" aria-selected="' + (e.id === state.selectedId) + '">' +
          '<span class="init-badge">' + e.initiative + "</span>" +
          '<div class="c-main"><div class="c-name">' + esc(e.name) + "</div><div class=\"c-sub\">" + sub + "</div></div>" +
          '<span class="c-ac">' + (e.kind === "creature" && e.ac != null ? "AC " + e.ac : "") + "</span></li>";
      }).join("");
    }
    renderDetail();
  }

  let detailShownId = null;
  const ABILITY_NAMES = { str: "Strength", dex: "Dexterity", con: "Constitution", int: "Intelligence", wis: "Wisdom", cha: "Charisma" };
  const saveBonus = (e, k) => (e.saves && e.saves[k] != null ? e.saves[k] : e.abilities && e.abilities[k] != null ? GM.abilityMod(e.abilities[k]) : null);
  // One compact row under the HP bar. The switch decides whether a tap rolls an ability check or a save.
  // A bestiary monster with the same name, preferring the core rules.
  function bestiaryMatch(name) {
    if (!bestiary) return null;
    const base = String(name || "").toLowerCase().replace(/\s+\d+$/, "").trim();
    const hits = bestiary.monsters.filter((m) => m.name.toLowerCase() === base);
    return hits.find((m) => m.source === "5e Core Rules") || hits[0] || null;
  }
  function statsHtml(e) {
    const hasAbilities = e.abilities && GM.ABILITIES.some((k) => e.abilities[k] != null);
    const saves = e.saves || {};
    const skills = Object.entries(e.skills || {});
    if (!hasAbilities && !Object.keys(saves).length && !skills.length) {
      if (!bestiary) { loadBestiary().then(() => renderDetail()).catch(() => {}); }
      const match = bestiaryMatch(e.name);
      return '<div class="abilities missing"><span class="hint">No ability scores saved for this creature.</span>' +
        (match ? '<button class="btn small" data-act="fill-stats" data-id="' + esc(match.id) + '">Fill from bestiary (' + esc(match.source) + ")</button>" : "") +
        '<button class="btn small ghost" data-act="edit">Enter them</button></div>';
    }
    const saveMode = !!state.prefs.saveMode;
    let html = '<div class="abilities"><div class="abilities-head"><span class="abilities-title">Abilities</span>' +
      '<button class="switch" data-act="save-mode" role="switch" aria-checked="' + saveMode + '"><span class="track" aria-hidden="true"><span class="knob"></span></span>Saving throws</button></div><div class="stats">';
    GM.ABILITIES.forEach((k) => {
      const score = e.abilities ? e.abilities[k] : null;
      const bonus = saveMode ? saveBonus(e, k) : score != null ? GM.abilityMod(score) : null;
      const prof = saveMode && saves[k] != null;
      const name = k.replace(/^./, (c) => c.toUpperCase());
      html += bonus == null
        ? '<div class="stat empty"><span class="stat-name">' + name + '</span><span class="stat-score">' + (score != null ? score : "—") + '</span><span class="stat-bonus">—</span></div>'
        : '<button class="stat' + (prof ? " prof" : "") + '" data-ab="' + k + '" aria-label="' + ABILITY_NAMES[k] + (saveMode ? " save " : " check ") + signed(bonus) + (prof ? ", proficient" : "") + '">' +
          '<span class="stat-name">' + name + '</span><span class="stat-score">' + (score != null ? score : "—") + '</span><span class="stat-bonus">' + signed(bonus) + "</span></button>";
    });
    html += "</div>";
    if (skills.length) {
      html += '<div class="skills">' + skills.map(([name, v]) => '<button class="cond" data-skill="' + esc(name) + '">' + esc(name.replace(/\b\w/g, (c) => c.toUpperCase())) + " " + signed(v) + "</button>").join("") + "</div>";
    }
    return html + "</div>";
  }

  function renderDetail() {
    const el = $("#detail");
    if (detailShownId !== state.selectedId) { el.scrollTop = 0; detailShownId = state.selectedId; }
    const e = byId(state.selectedId);
    const last = state.lastRoll;
    const lastHtml = last ? '<div class="last-roll ' + last.kind + '"><span class="num">' + esc(last.num) + '</span><span class="what">' + esc(last.what) + "</span></div>" : "";
    const logHtml = state.log.length ? '<div class="d-section"><h3>Combat log</h3><ol class="log">' + state.log.slice(0, 40).map((l) => "<li>" + esc(l) + "</li>").join("") + "</ol></div>" : "";
    if (!e) {
      el.innerHTML = '<p class="detail-empty">Tap a combatant to see their stats, roll their attacks and track their HP.</p>' + lastHtml + logHtml;
      return;
    }
    const head = '<div class="d-head"><div style="flex:1"><h2>' + esc(e.name) + '</h2><div class="d-meta">Initiative ' + e.initiative + (e.kind === "creature" ? " · bonus " + signed(e.initiative_bonus || 0) : " · event") + (e.source ? " · " + esc(e.source) : "") + "</div></div>" +
      '<div class="d-actions"><button class="btn small" data-act="edit">Edit</button><button class="btn small ghost danger-text" data-act="remove">Remove</button></div></div>';
    if (e.kind === "event") {
      el.innerHTML = head + '<p class="traits">' + esc(e.description || "No description.") + "</p>" + lastHtml + logHtml;
      return;
    }
    const max = e.max_hp != null ? e.max_hp : e.hp;
    const vitals = '<div class="vitals">' +
      (e.hp != null
        ? '<div class="hp-read"><span class="now">' + e.hp + '</span><span class="max"> / ' + max + "</span>" + (e.temp_hp ? '<span class="temp">+' + e.temp_hp + " temp HP</span>" : "") + "</div>" +
          '<div><div class="hp-bar" role="meter" aria-label="Hit points" aria-valuemin="0" aria-valuemax="' + max + '" aria-valuenow="' + e.hp + '"><i class="' + hpClass(e.hp, max) + '" style="width:' + (max ? Math.round((e.hp / max) * 100) : 0) + '%"></i></div>' +
          '<div class="ac-read">AC <b>' + (e.ac != null ? e.ac : "—") + "</b></div></div>" +
          '<div class="hp-entry"><input id="hp-amount" inputmode="numeric" pattern="[0-9]*" placeholder="Amount" aria-label="HP amount">' +
          '<button class="btn hurt" data-hp="damage">Damage</button><button class="btn mend" data-hp="heal">Heal</button><button class="btn ghost" data-hp="temp">Temp HP</button></div>'
        : '<div class="ac-read">HP not tracked · AC <b>' + (e.ac != null ? e.ac : "—") + "</b></div>") +
      "</div>";
    const conds = '<div class="d-section"><h3>Conditions</h3><div class="conditions">' + CONDITIONS.map((c) => '<button class="cond" data-cond="' + c + '" aria-pressed="' + (e.conditions || []).includes(c) + '">' + c + "</button>").join("") + "</div></div>";
    const attacks = (e.attacks || []).map((a, i) =>
      '<div class="attack"><div class="attack-name">' + esc(a.name) + "</div>" +
      '<div class="attack-stats">' + (a.bonus != null ? signed(a.bonus) + " to hit" : "No attack roll") + (a.damage ? " · " + esc(a.damage) + (a.alt || []).map((o) => " or " + esc(o.damage) + " " + esc(o.label)).join("") : "") + "</div>" +
      '<div class="attack-buttons">' +
      (a.bonus != null ? '<button class="btn small" data-atk="' + i + '" data-roll="hit">Attack</button><button class="btn small ghost" data-atk="' + i + '" data-roll="adv" title="Attack with advantage">Adv</button><button class="btn small ghost" data-atk="' + i + '" data-roll="dis" title="Attack with disadvantage">Dis</button>' : "") +
      (a.damage ? '<button class="btn small" data-atk="' + i + '" data-roll="dmg">Damage</button>' + (a.bonus != null ? '<button class="btn small ghost" data-atk="' + i + '" data-roll="crit">Crit</button>' : "") : "") +
      "</div>" +
      (a.description ? "<details><summary>Details</summary>" + esc(a.description) + "</details>" : "") +
      "</div>").join("");
    const attackSection = (e.attacks || []).length || e.multiattack
      ? '<div class="d-section"><h3>Attacks and actions</h3>' + (e.multiattack ? '<p class="multi-text"><b>Multiattack.</b> ' + esc(e.multiattack) + "</p>" : "") + '<div class="attacks">' + attacks + "</div></div>"
      : "";
    const traits = e.traits ? '<div class="d-section"><h3>Traits</h3><div class="traits">' + esc(e.traits) + "</div></div>" : "";
    el.innerHTML = head + vitals + statsHtml(e) + lastHtml + attackSection + conds + traits + logHtml;
  }

  // Combat events
  $("#order").addEventListener("click", (ev) => {
    const row = ev.target.closest("[data-id]");
    if (!row) return;
    state.selectedId = row.dataset.id;
    renderCombat();
  });
  $("#order").addEventListener("keydown", (ev) => {
    if ((ev.key === "Enter" || ev.key === " ") && ev.target.dataset.id) { ev.preventDefault(); state.selectedId = ev.target.dataset.id; renderCombat(); $('[data-id="' + state.selectedId + '"]').focus(); }
  });
  $("#detail").addEventListener("click", (ev) => {
    const e = byId(state.selectedId);
    if (!e) return;
    const t = ev.target.closest("button");
    if (!t) return;
    if (t.dataset.act === "edit") return e.kind === "event" ? openEventEditor(e) : openCreatureEditor({ mode: "combat", item: e });
    if (t.dataset.act === "remove") { if (confirm("Remove " + e.name + " from combat?")) removeEntity(e.id); return; }
    if (t.dataset.hp) {
      const raw = $("#hp-amount").value.trim();
      if (!/^\d+$/.test(raw)) { toast("Enter a whole number of hit points."); $("#hp-amount").focus(); return; }
      return changeHp(e, t.dataset.hp, parseInt(raw, 10));
    }
    if (t.dataset.cond) {
      const c = t.dataset.cond;
      e.conditions = e.conditions || [];
      e.conditions = e.conditions.includes(c) ? e.conditions.filter((x) => x !== c) : e.conditions.concat(c);
      addLog(e.name + (e.conditions.includes(c) ? " is now " : " is no longer ") + c.toLowerCase());
      saveCombat();
      return renderCombat();
    }
    if (t.dataset.act === "fill-stats") {
      const src = bestiary && bestiary.monsters.find((m) => m.id === t.dataset.id);
      if (!src) return;
      const copy = (target) => {
        if (src.abilities) target.abilities = clone(src.abilities);
        if (src.saves) target.saves = clone(src.saves);
        if (src.skills) target.skills = clone(src.skills);
      };
      copy(e);
      // Fix the saved copy in your monsters too, so the next fight has them.
      const base = e.name.toLowerCase().replace(/\s+\d+$/, "").trim();
      const saved = state.monsters.filter((m) => m.name.toLowerCase() === base && !m.abilities);
      saved.forEach(copy);
      state.combat.entities.filter((x) => x !== e && x.kind === "creature" && !x.abilities && x.name.toLowerCase().replace(/\s+\d+$/, "").trim() === base).forEach(copy);
      if (saved.length) saveMonsters();
      saveCombat();
      renderDetail();
      toast("Stats filled from " + src.source + (saved.length ? ", and saved to your monsters." : "."));
      return;
    }
    if (t.dataset.act === "save-mode") { state.prefs.saveMode = !state.prefs.saveMode; savePrefs(); return renderDetail(); }
    if (t.dataset.ab) {
      const k = t.dataset.ab;
      if (state.prefs.saveMode) return rollCheck(e, ABILITY_NAMES[k] + " save", saveBonus(e, k));
      return rollCheck(e, ABILITY_NAMES[k] + " check", GM.abilityMod(e.abilities[k]));
    }
    if (t.dataset.skill) { const k = t.dataset.skill; return rollCheck(e, k.replace(/\b\w/g, (c) => c.toUpperCase()), e.skills[k]); }
    if (t.dataset.atk != null) {
      const a = e.attacks[+t.dataset.atk];
      const r = t.dataset.roll;
      if (r === "hit") rollAttack(e, a);
      else if (r === "adv" || r === "dis") rollAttack(e, a, r);
      else if (r === "dmg") rollDamage(e, a, false);
      else if (r === "crit") rollDamage(e, a, true);
    }
  });
  $("#detail").addEventListener("keydown", (ev) => {
    if (ev.key === "Enter" && ev.target.id === "hp-amount") { ev.preventDefault(); $('[data-hp="damage"]').click(); }
  });
  $("#next-turn").addEventListener("click", nextTurn);
  $("#prev-turn").addEventListener("click", prevTurn);
  $("#add-creature").addEventListener("click", () => openCreatureEditor({ mode: "combat" }));
  $("#add-event").addEventListener("click", () => openEventEditor());
  $("#add-from-library").addEventListener("click", openAddDialog);
  $("#new-combat").addEventListener("click", () => {
    closeMenus();
    if (state.combat.entities.length && !confirm("Clear this combat? Save it to a file first if you want it later.")) return;
    state.combat = { round: 1, activeId: null, entities: [] };
    state.selectedId = null;
    state.lastRoll = null;
    state.log = [];
    saveCombat();
    renderCombat();
  });
  $("#save-combat").addEventListener("click", () => {
    closeMenus();
    const list = sorted();
    download("combat-round-" + state.combat.round + ".json", { version: 2, round: state.combat.round, activeId: state.combat.activeId, turn: list.findIndex((e) => e.id === state.combat.activeId), entities: list });
  });
  $("#load-combat").addEventListener("click", () => {
    closeMenus();
    pickFile((data) => {
      const entities = data && data.entities;
      if (!Array.isArray(entities) || entities.some((e) => !e || !["creature", "event"].includes(e.kind) || !e.name || !Number.isInteger(e.initiative))) {
        toast("That file isn't a saved combat.");
        return;
      }
      // Older files from the Python tracker store the active turn as a position in the list.
      const legacyActive = Number.isInteger(data.turn) && data.turn >= 0 ? entities[data.turn] : null;
      state.combat = { round: Math.max(1, parseInt(data.round, 10) || 1), activeId: null, entities: [] };
      entities.forEach((e) => { const item = clone(e); const keepId = item.id; addEntity(item); if (keepId) item.id = keepId; });
      const active = data.activeId ? byId(data.activeId) : legacyActive ? state.combat.entities[entities.indexOf(legacyActive)] : null;
      state.combat.activeId = active ? active.id : null;
      state.selectedId = state.combat.activeId;
      state.log = ["Loaded combat at round " + state.combat.round];
      saveCombat();
      renderCombat();
      toast("Combat loaded.");
    });
  });
  function closeMenus() { $$("details.menu[open]").forEach((d) => d.removeAttribute("open")); }
  document.addEventListener("click", (ev) => { if (!ev.target.closest("details.menu")) closeMenus(); });

  /* ---------- Creature editor ---------- */
  let editorCtx = null;
  function attackRow(a) {
    const div = document.createElement("div");
    div.className = "attack-row";
    div.innerHTML =
      '<label class="name">Name<input data-f="name" value="' + esc(a.name) + '"></label>' +
      '<label>Attack bonus<input data-f="bonus" inputmode="numeric" placeholder="None" value="' + esc(a.bonus == null ? "" : a.bonus) + '"></label>' +
      '<label>Damage<input data-f="damage" placeholder="2d6+3" value="' + esc(a.damage) + '"></label>' +
      '<label class="alt">Or instead (optional)<input data-f="alt" placeholder="1d8+3 two-handed" value="' + esc((a.alt || []).map((o) => o.damage + " " + o.label).join("; ")) + '"></label>' +
      '<button type="button" class="btn ghost small danger-text" data-remove-attack aria-label="Remove attack">Remove</button>' +
      '<label class="desc">Description<textarea data-f="description" rows="2">' + esc(a.description) + "</textarea></label>";
    return div;
  }
  function refreshSourceOptions() {
    const sources = Array.from(new Set(state.monsters.map((m) => m.source).filter(Boolean))).sort();
    $("#source-options").innerHTML = sources.map((s) => '<option value="' + esc(s) + '">').join("");
    return sources;
  }
  function readAbilities(form) {
    const out = {};
    GM.ABILITIES.forEach((k) => {
      const v = form["ab_" + k].value.trim();
      if (v === "") return;
      if (!/^\d{1,2}$/.test(v)) throw new Error(k.toUpperCase() + " should be a score from 1 to 30.");
      out[k] = parseInt(v, 10);
    });
    return Object.keys(out).length ? out : null;
  }
  function openCreatureEditor(ctx) {
    editorCtx = ctx;
    const form = $("#creature-form");
    const item = ctx.item || { name: "", initiative: "", initiative_bonus: "", hp: null, max_hp: null, ac: null, source: ctx.mode === "library" ? state.prefs.lastSource || "" : "", traits: "", attacks: [] };
    $("#creature-title").textContent = ctx.title || (ctx.item && !ctx.fresh ? "Edit " + item.name : ctx.mode === "library" ? "New monster" : "Add creature");
    $("#creature-save").textContent = ctx.mode === "library" ? "Save to my monsters" : ctx.item && !ctx.fresh ? "Save changes" : "Add to combat";
    $$("[data-combat-only]", form).forEach((el) => { el.hidden = ctx.mode === "library"; });
    form.name.value = item.name || "";
    form.initiative.value = item.initiative == null ? "" : item.initiative;
    form.initiative_bonus.value = item.initiative_bonus == null ? "" : item.initiative_bonus;
    form.hp.value = item.hp == null ? "" : item.hp;
    form.max_hp.value = item.max_hp == null || item.max_hp === item.hp ? "" : item.max_hp;
    form.ac.value = item.ac == null ? "" : item.ac;
    form.source.value = item.source || "";
    form.traits.value = item.traits || "";
    GM.ABILITIES.forEach((k) => { form["ab_" + k].value = item.abilities && item.abilities[k] != null ? item.abilities[k] : ""; });
    form.saves.value = GM.formatBonuses(item.saves);
    form.skills.value = GM.formatBonuses(item.skills);
    form.multiattack.value = item.multiattack || "";
    const rows = $("#attack-rows");
    rows.innerHTML = "";
    (item.attacks || []).forEach((a) => rows.appendChild(attackRow(a)));
    $("#creature-error").textContent = "";
    refreshSourceOptions();
    $("#creature-dialog").showModal();
    if (!item.name) form.name.focus();
  }
  $("#add-attack-row").addEventListener("click", () => {
    const row = attackRow({ name: "", bonus: "", damage: "", description: "" });
    $("#attack-rows").appendChild(row);
    row.querySelector("input").focus();
  });
  $("#attack-rows").addEventListener("click", (ev) => { if (ev.target.closest("[data-remove-attack]")) ev.target.closest(".attack-row").remove(); });
  $("#roll-init").addEventListener("click", () => {
    const form = $("#creature-form");
    let bonus = 0;
    try { bonus = int(form.initiative_bonus.value, 0); } catch (e) { $("#creature-error").textContent = "Initiative bonus: " + e.message; return; }
    const total = rollInitiative(bonus);
    form.initiative.value = total;
    toast("Initiative: d20 " + signed(bonus) + " = " + total);
  });
  $("#creature-form").addEventListener("submit", (ev) => {
    ev.preventDefault();
    const form = ev.target;
    try {
      const name = form.name.value.trim();
      if (!name) throw new Error("Give the creature a name.");
      const hp = int(form.hp.value, null);
      const attacks = $$(".attack-row", form).map((row, i) => {
        const f = (k) => row.querySelector('[data-f="' + k + '"]').value.trim();
        const label = "Attack " + (i + 1) + ": ";
        if (!f("name")) throw new Error(label + "give it a name or remove it.");
        const damage = f("damage").replace(/\s+/g, "");
        if (damage && !GM.isDice(damage)) throw new Error(label + "damage should look like 2d6+3.");
        let bonus;
        try { bonus = int(f("bonus"), null); } catch (e) { throw new Error(label + "attack bonus must be a number, or blank."); }
        const alt = f("alt") ? f("alt").split(";").map((part) => {
          const m = part.trim().match(/^(\S+)\s*(.*)$/);
          if (!m || !GM.isDice(m[1])) throw new Error(label + "“Or instead” should look like 1d8+3 two-handed.");
          return { damage: m[1], label: m[2].trim() || "alternate" };
        }) : [];
        const out = { name: f("name"), bonus, damage, description: f("description") };
        if (alt.length) out.alt = alt;
        return out;
      });
      const data = {
        kind: "creature",
        name,
        initiative_bonus: int(form.initiative_bonus.value, 0),
        hp,
        max_hp: int(form.max_hp.value, hp),
        ac: int(form.ac.value, null),
        source: form.source.value.trim(),
        traits: form.traits.value.trim(),
        abilities: readAbilities(form),
        saves: GM.parseSaves(form.saves.value),
        skills: GM.parseSkills(form.skills.value),
        multiattack: form.multiattack.value.trim(),
        attacks,
      };
      if (editorCtx.mode === "library") {
        if (data.source) { state.prefs.lastSource = data.source; savePrefs(); }
        if (editorCtx.item && !editorCtx.fresh) Object.assign(editorCtx.item, data);
        else state.monsters.push(Object.assign({ id: uid() }, data));
        saveMonsters();
        renderLibrary();
        toast(name + " saved to your monsters.");
      } else {
        data.initiative = int(form.initiative.value, null);
        if (data.initiative == null) data.initiative = rollInitiative(data.initiative_bonus);
        if (editorCtx.item && !editorCtx.fresh) {
          const target = editorCtx.item;
          if (target.hp != null && data.hp != null && data.max_hp === data.hp && target.max_hp != null && form.max_hp.value === "") data.max_hp = Math.max(target.max_hp, data.hp);
          Object.assign(target, data);
          addLog("Edited " + name);
        } else {
          const added = addEntity(data);
          state.selectedId = added.id;
          addLog(name + " joins at initiative " + data.initiative);
        }
        saveCombat();
        renderCombat();
      }
      $("#creature-dialog").close();
    } catch (e) {
      $("#creature-error").textContent = e.message;
    }
  });

  /* ---------- Event editor ---------- */
  let eventTarget = null;
  function openEventEditor(item) {
    eventTarget = item || null;
    const form = $("#event-form");
    form.name.value = item ? item.name : "";
    form.initiative.value = item ? item.initiative : 20;
    form.description.value = item ? item.description || "" : "";
    $("#event-dialog").showModal();
  }
  $("#event-form").addEventListener("submit", (ev) => {
    ev.preventDefault();
    const form = ev.target;
    let initiative;
    try { initiative = int(form.initiative.value, 20); } catch (e) { toast("Initiative: " + e.message); return; }
    const data = { kind: "event", name: form.name.value.trim() || "Event", initiative, initiative_bonus: 0, description: form.description.value.trim() };
    if (eventTarget) Object.assign(eventTarget, data);
    else { const added = addEntity(data); state.selectedId = added.id; addLog(data.name + " added at initiative " + initiative); }
    saveCombat();
    renderCombat();
    $("#event-dialog").close();
  });

  $$("[data-close]").forEach((b) => b.addEventListener("click", () => b.closest("dialog").close()));

  /* ---------- Monster library ---------- */
  function fillSourceSelect(select, sources, current) {
    select.innerHTML = '<option value="">All sources</option>' + sources.map((s) => '<option value="' + esc(s) + '"' + (s === current ? " selected" : "") + ">" + esc(s) + "</option>").join("") +
      (state.monsters.some((m) => !m.source) ? '<option value="__none"' + (current === "__none" ? " selected" : "") + ">No source set</option>" : "");
  }
  function filterMonsters(query, source) {
    const q = query.trim().toLowerCase();
    return state.monsters
      .filter((m) => (!q || m.name.toLowerCase().includes(q)) && (!source || (source === "__none" ? !m.source : m.source === source)))
      .sort((a, b) => a.name.localeCompare(b.name));
  }
  function monsterMeta(m) {
    return [m.source || "No source", m.hp != null ? "HP " + m.hp : null, m.ac != null ? "AC " + m.ac : null, "Init " + signed(m.initiative_bonus || 0), (m.attacks || []).length + " attack" + ((m.attacks || []).length === 1 ? "" : "s")].filter(Boolean).join(" · ");
  }
  function renderLibrary() {
    const sources = refreshSourceOptions();
    const sel = $("#lib-source");
    const current = sel.value || state.prefs.libSource || "";
    fillSourceSelect(sel, sources, current);
    const list = filterMonsters($("#lib-search").value, sel.value);
    $("#lib-count").textContent = state.monsters.length ? list.length + " of " + state.monsters.length + " monsters" : "";
    $("#lib-list").innerHTML = list.length
      ? list.map((m) => '<li class="mon"><div><div class="mon-name">' + esc(m.name) + '</div><div class="mon-meta">' + esc(monsterMeta(m)) + "</div></div>" +
          '<div class="mon-actions"><button class="btn small primary" data-lib="add" data-id="' + m.id + '">Add to combat</button><button class="btn small" data-lib="edit" data-id="' + m.id + '">Edit</button><button class="btn small ghost" data-lib="copy" data-id="' + m.id + '">Duplicate</button><button class="btn small ghost danger-text" data-lib="delete" data-id="' + m.id + '">Delete</button></div></li>').join("")
      : state.monsters.length
        ? '<li class="empty">No monsters match. Clear the search or pick another source.</li>'
        : '<li class="empty">Your library is empty. Paste a stat block from D&amp;D Beyond, copy one from the Bestiary, or import the saltmarsh_monsters.json file from the old tracker with File → Import.</li>';
  }
  $("#lib-search").addEventListener("input", renderLibrary);
  $("#lib-source").addEventListener("change", () => { state.prefs.libSource = $("#lib-source").value; savePrefs(); renderLibrary(); });
  $("#new-monster").addEventListener("click", () => openCreatureEditor({ mode: "library" }));
  $("#lib-list").addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-lib]");
    if (!b) return;
    const m = state.monsters.find((x) => x.id === b.dataset.id);
    if (!m) return;
    if (b.dataset.lib === "edit") openCreatureEditor({ mode: "library", item: m });
    if (b.dataset.lib === "copy") openCreatureEditor({ mode: "library", item: Object.assign(clone(m), { name: m.name + " (copy)" }), fresh: true, title: "Duplicate " + m.name });
    if (b.dataset.lib === "delete" && confirm("Delete " + m.name + " from your monsters?")) { state.monsters = state.monsters.filter((x) => x !== m); saveMonsters(); renderLibrary(); }
    if (b.dataset.lib === "add") { openAddDialog(); chooseForAdd(m.id); }
  });
  $("#export-lib").addEventListener("click", () => { closeMenus(); download("gm-tools-monsters.json", state.monsters.map(({ id, ...rest }) => rest)); });
  $("#import-lib").addEventListener("click", () => {
    closeMenus();
    pickFile((data) => {
      const list = Array.isArray(data) ? data : data && Array.isArray(data.monsters) ? data.monsters : null;
      if (!list) { toast("That file doesn't contain a monster list."); return; }
      const fallbackSource = prompt("Source book for monsters that don't have one (leave blank to skip):", state.prefs.lastSource || "") || "";
      const key = (m) => (m.name + "|" + (m.source || "")).toLowerCase();
      const existing = new Set(state.monsters.map(key));
      let added = 0, skipped = 0;
      list.forEach((raw) => {
        if (!raw || !raw.name) { skipped++; return; }
        const m = Object.assign({ kind: "creature", initiative_bonus: 0, hp: null, ac: null, traits: "", attacks: [] }, clone(raw));
        delete m.initiative; delete m.conditions; delete m.temp_hp; delete m.order;
        upgradeMonster(m);
        m.source = m.source || fallbackSource.trim();
        if (m.max_hp == null) m.max_hp = m.hp;
        if (existing.has(key(m))) { skipped++; return; }
        m.id = uid();
        existing.add(key(m));
        state.monsters.push(m);
        added++;
      });
      saveMonsters();
      renderLibrary();
      toast("Imported " + added + " monster" + (added === 1 ? "" : "s") + (skipped ? "; skipped " + skipped + " already in your library" : "") + ".");
    });
  });

  /* ---------- Paste stat block ---------- */
  $("#paste-statblock").addEventListener("click", () => {
    const form = $("#paste-form");
    form.text.value = "";
    form.source.value = state.prefs.lastSource || "";
    $("#paste-error").textContent = "";
    refreshSourceOptions();
    $("#paste-dialog").showModal();
    form.text.focus();
  });
  $("#paste-form").addEventListener("submit", (ev) => {
    ev.preventDefault();
    const form = ev.target;
    try {
      const source = form.source.value.trim();
      if (source) { state.prefs.lastSource = source; savePrefs(); }
      const chunks = GM.splitStatBlocks(form.text.value);
      if (chunks.length > 1) {
        const parsed = chunks.map((chunk) => {
          try { const m = GM.parseStatBlock(chunk); if (!m.source) m.source = source; return m; }
          catch (e) { return null; }
        }).filter(Boolean);
        $("#paste-dialog").close();
        openBulkReview(parsed);
        return;
      }
      const m = GM.parseStatBlock(form.text.value);
      if (!m.source) m.source = source;
      $("#paste-dialog").close();
      openCreatureEditor({ mode: "library", item: m, fresh: true, title: "Check " + m.name });
      const found = [m.hp != null && "HP", m.ac != null && "AC", m.attacks.length && m.attacks.length + " attacks"].filter(Boolean);
      toast(found.length ? "Read " + found.join(", ") + ". Check the details, then save." : "Couldn't find stats in that text. Fill them in by hand.");
    } catch (e) {
      $("#paste-error").textContent = e.message;
    }
  });

  /* ---------- Review several pasted monsters ---------- */
  let bulkItems = [];
  const monsterKey = (m) => (m.name + "|" + (m.source || "")).toLowerCase();
  function openBulkReview(items) {
    bulkItems = items;
    const existing = new Set(state.monsters.map(monsterKey));
    $("#bulk-title").textContent = "Review " + items.length + " monsters";
    $("#bulk-list").innerHTML = items.map((m, i) => {
      const have = existing.has(monsterKey(m));
      const warn = [m.hp == null && "no HP found", m.ac == null && "no AC found", !m.attacks.length && "no attacks found", have && "already in your library"].filter(Boolean);
      return '<li><label><input type="checkbox" data-bulk="' + i + '"' + (have ? "" : " checked") + "><span>" +
        '<span class="b-name">' + esc(m.name) + '</span><br><span class="b-meta">' + esc(monsterMeta(m)) + "</span>" +
        (warn.length ? '<br><span class="b-warn">' + esc(warn.join(", ").replace(/^./, (c) => c.toUpperCase())) + "</span>" : "") +
        "</span></label></li>";
    }).join("");
    updateBulkButton();
    $("#bulk-dialog").showModal();
  }
  function updateBulkButton() {
    const n = $$("[data-bulk]:checked").length;
    const btn = $("#bulk-save");
    btn.textContent = n === 1 ? "Save 1 monster" : "Save " + n + " monsters";
    btn.disabled = n === 0;
  }
  $("#bulk-list").addEventListener("change", updateBulkButton);
  $("#bulk-all").addEventListener("click", () => { $$("[data-bulk]").forEach((b) => { b.checked = true; }); updateBulkButton(); });
  $("#bulk-none").addEventListener("click", () => { $$("[data-bulk]").forEach((b) => { b.checked = false; }); updateBulkButton(); });
  $("#bulk-form").addEventListener("submit", (ev) => {
    ev.preventDefault();
    const chosen = $$("[data-bulk]:checked").map((b) => bulkItems[+b.dataset.bulk]);
    chosen.forEach((m) => state.monsters.push(Object.assign({ id: uid() }, m)));
    saveMonsters();
    renderLibrary();
    $("#bulk-dialog").close();
    toast("Saved " + chosen.length + " monster" + (chosen.length === 1 ? "" : "s") + " to your library.");
  });

  /* ---------- Add monsters to combat ---------- */
  let addChoice = null;
  function openAddDialog() {
    const form = $("#add-form");
    addChoice = null;
    form.reset();
    $("#add-options").disabled = true;
    $("#add-confirm").disabled = true;
    $("#add-chosen").textContent = "Choose a monster above";
    $("[data-fixed]", form).hidden = true;
    const fillSources = () => fillSourceSelect($("#add-source"), Array.from(new Set(refreshSourceOptions().concat(bestiarySources()))), $("#add-source").value || state.prefs.libSource || "");
    fillSources();
    renderAddList();
    $("#add-dialog").showModal();
    if (!bestiary) loadBestiary().then(() => { fillSources(); renderAddList(); }).catch(() => {});
  }
  const ADD_LIMIT = 80;
  function renderAddList() {
    const q = $("#add-search").value;
    const src = $("#add-source").value;
    const mine = filterMonsters(q, src);
    const built = src === "__none" ? [] : filterBestiary(q, src, "");
    const all = mine.map((m) => ({ id: m.id, name: m.name, meta: monsterMeta(m) }))
      .concat(built.map((m) => ({ id: m.id, name: m.name, meta: bestiaryMeta(m) })));
    const shown = all.slice(0, ADD_LIMIT);
    $("#add-list").innerHTML = shown.length
      ? shown.map((m) => '<li><button type="button" data-pick="' + esc(m.id) + '" aria-pressed="' + !!(addChoice && addChoice.id === m.id) + '"><span>' + esc(m.name) + '</span><span class="meta">' + esc(m.meta) + "</span></button></li>").join("") +
        (all.length > ADD_LIMIT ? '<li class="empty" style="padding:12px">' + (all.length - ADD_LIMIT) + " more. Type a name or pick a source to narrow the list.</li>" : "")
      : '<li class="empty" style="padding:12px">No monsters match.</li>';
  }
  function chooseForAdd(id) {
    const mine = state.monsters.find((m) => m.id === id);
    const built = !mine && bestiary ? bestiary.monsters.find((m) => m.id === id) : null;
    addChoice = mine || (built ? fullMonster(built) : null);
    if (!addChoice) return;
    const form = $("#add-form");
    form.name.value = addChoice.name;
    $("#add-options").disabled = false;
    $("#add-confirm").disabled = false;
    $("#add-chosen").textContent = addChoice.name + " · initiative " + signed(addChoice.initiative_bonus || 0);
    renderAddList();
  }
  $("#add-search").addEventListener("input", renderAddList);
  $("#add-source").addEventListener("change", renderAddList);
  $("#add-list").addEventListener("click", (ev) => { const b = ev.target.closest("[data-pick]"); if (b) chooseForAdd(b.dataset.pick); });
  $("#add-form").initMode.addEventListener("change", (ev) => { $("[data-fixed]", ev.target.form).hidden = ev.target.value !== "fixed"; });
  $("#add-form").addEventListener("submit", (ev) => {
    ev.preventDefault();
    if (!addChoice) return;
    const form = ev.target;
    const count = Math.max(1, Math.min(20, parseInt(form.count.value, 10) || 1));
    const base = form.name.value.trim() || addChoice.name;
    const bonus = addChoice.initiative_bonus || 0;
    let fixed = null;
    if (form.initMode.value === "fixed") {
      try { fixed = int(form.initValue.value, null); } catch (e) { toast(e.message); return; }
      if (fixed == null) { toast("Enter an initiative value."); return; }
    }
    const group = form.initMode.value === "group" ? rollInitiative(bonus) : null;
    let first = null;
    for (let i = 1; i <= count; i++) {
      const item = clone(addChoice);
      delete item.id;
      item.kind = "creature";
      item.name = count > 1 ? base + " " + i : base;
      item.initiative = fixed != null ? fixed : group != null ? group : rollInitiative(bonus);
      item.max_hp = item.max_hp != null ? item.max_hp : item.hp;
      const added = addEntity(item);
      first = first || added;
      addLog(item.name + " joins at initiative " + item.initiative);
    }
    state.selectedId = first.id;
    saveCombat();
    $("#add-dialog").close();
    showView("combat");
    renderCombat();
    toast(count > 1 ? "Added " + count + " × " + base + "." : base + " added.");
  });

  /* ---------- Bestiary: Open5e monsters bundled with the app ---------- */
  let bestiary = null;
  let bestiaryLoading = null;
  let bestShown = 60;
  function loadBestiary() {
    if (bestiaryLoading) return bestiaryLoading;
    bestiaryLoading = fetch("data/open5e-monsters.json")
      .then((r) => { if (!r.ok) throw new Error("status " + r.status); return r.json(); })
      .then((data) => {
        data.monsters.forEach((m) => { m._search = m.name.toLowerCase(); });
        bestiary = data;
        fillBestiaryFilters();
        return data;
      })
      .catch((e) => { bestiaryLoading = null; throw e; });
    return bestiaryLoading;
  }
  // Bundled entries leave out empty fields to stay small; fill them back in before use.
  function fullMonster(m) {
    const c = clone(m);
    delete c._search;
    const out = Object.assign({ kind: "creature", initiative_bonus: 0, hp: null, ac: null, traits: "", source: "" }, c);
    out.max_hp = out.max_hp != null ? out.max_hp : out.hp;
    out.attacks = (c.attacks || []).map((a) => Object.assign({ name: "", bonus: null, damage: "", description: "" }, a));
    return out;
  }
  const crNumber = (cr) => { const t = String(cr); if (t.includes("/")) { const [a, b] = t.split("/"); return a / b; } return parseFloat(t) || 0; };
  function bestiarySources() { return bestiary ? bestiary.sources.map((s) => s.title) : []; }
  function fillBestiaryFilters() {
    $("#best-source").innerHTML = '<option value="">All sources</option>' + bestiary.sources.map((s) => '<option value="' + esc(s.title) + '">' + esc(s.title) + " (" + s.count + ")</option>").join("");
    const crs = Array.from(new Set(bestiary.monsters.map((m) => m.cr).filter((c) => c !== undefined && c !== ""))).sort((a, b) => crNumber(a) - crNumber(b));
    $("#best-cr").innerHTML = '<option value="">Any CR</option>' + crs.map((c) => '<option value="' + esc(c) + '">CR ' + esc(c) + "</option>").join("");
  }
  function filterBestiary(query, source, cr) {
    if (!bestiary) return [];
    const q = String(query || "").trim().toLowerCase();
    return bestiary.monsters.filter((m) => (!q || m._search.includes(q)) && (!source || m.source === source) && (!cr || m.cr === cr));
  }
  function bestiaryMeta(m) {
    return [m.source, m.type, m.cr !== undefined && m.cr !== "" ? "CR " + m.cr : null, m.hp != null ? "HP " + m.hp : null, m.ac != null ? "AC " + m.ac : null].filter(Boolean).join(" · ");
  }
  function renderBestiary() {
    if (!bestiary) {
      $("#best-status").textContent = "Loading the bestiary…";
      loadBestiary().then(renderBestiary).catch(() => { $("#best-status").textContent = "Couldn't load the bestiary. Open the app once while online so it can be saved for offline use."; });
      return;
    }
    const list = filterBestiary($("#best-search").value, $("#best-source").value, $("#best-cr").value);
    const have = new Set(state.monsters.map(monsterKey));
    $("#best-status").textContent = list.length === bestiary.monsters.length ? list.length + " monsters" : list.length + " of " + bestiary.monsters.length + " monsters";
    $("#best-list").innerHTML = list.length
      ? list.slice(0, bestShown).map((m) => {
          const copied = have.has(monsterKey(m));
          return '<li class="mon"><div><div class="mon-name">' + esc(m.name) + '</div><div class="mon-meta">' + esc(bestiaryMeta(m)) + "</div></div>" +
            '<div class="mon-actions"><button class="btn small primary" data-best="add" data-id="' + esc(m.id) + '">Add to combat</button>' +
            '<button class="btn small" data-best="copy" data-id="' + esc(m.id) + '"' + (copied ? " disabled" : "") + ">" + (copied ? "In my monsters" : "Copy to my monsters") + "</button></div></li>";
        }).join("")
      : '<li class="empty">No monsters match. Try a shorter name, another source or Any CR.</li>';
    $("#best-more").hidden = list.length <= bestShown;
  }
  const resetBestiary = () => { bestShown = 60; renderBestiary(); };
  $("#best-search").addEventListener("input", resetBestiary);
  $("#best-source").addEventListener("change", resetBestiary);
  $("#best-cr").addEventListener("change", resetBestiary);
  $("#best-more").addEventListener("click", () => { bestShown += 120; renderBestiary(); });
  $("#best-list").addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-best]");
    if (!b) return;
    const entry = bestiary && bestiary.monsters.find((m) => m.id === b.dataset.id);
    if (!entry) return;
    if (b.dataset.best === "add") { openAddDialog(); chooseForAdd(entry.id); return; }
    const m = fullMonster(entry);
    m.id = uid();
    state.monsters.push(m);
    saveMonsters();
    b.disabled = true;
    b.textContent = "In my monsters";
    toast(m.name + " copied to your monsters. Edit it there to make changes.");
  });
  $$(".subtab").forEach((t) => t.addEventListener("click", () => {
    $$(".subtab").forEach((x) => x.setAttribute("aria-selected", String(x === t)));
    $("#sub-library").hidden = t.dataset.sub !== "library";
    $("#sub-bestiary").hidden = t.dataset.sub !== "bestiary";
    if (t.dataset.sub === "bestiary") renderBestiary();
    else renderLibrary();
  }));

  /* ---------- Dice ---------- */
  const diceHistory = [];
  function showDice(total, detail, label, kind) {
    const out = $("#dice-result");
    out.className = "dice-result " + (kind || "");
    out.innerHTML = '<span class="dice-total">' + esc(total) + '</span><span class="dice-detail">' + esc(label + (detail ? " · " + detail : "")) + "</span>";
    diceHistory.unshift({ total, label, detail });
    diceHistory.length = Math.min(diceHistory.length, 50);
    $("#dice-history").innerHTML = diceHistory.map((h) => "<li><b>" + esc(h.total) + "</b> — " + esc(h.label) + (h.detail ? " (" + esc(h.detail) + ")" : "") + "</li>").join("");
  }
  function rollExpr(expr) {
    try {
      const r = GM.roll(expr);
      const single = r.dice.length === 1 && r.dice[0].sides === 20 && r.dice[0].values.length === 1 ? r.dice[0].values[0] : 0;
      showDice(r.total, r.detail, expr, single === 20 ? "crit" : single === 1 ? "fumble" : "");
    } catch (e) { toast(e.message); }
  }
  $("#dice-quick").innerHTML = ["d4", "d6", "d8", "d10", "d12", "d20", "d100"].map((d) => '<button class="btn" data-die="' + d + '">' + d + "</button>").join("");
  $("#dice-quick").addEventListener("click", (ev) => { const b = ev.target.closest("[data-die]"); if (b) rollExpr(b.dataset.die); });
  $$("[data-d20]").forEach((b) => b.addEventListener("click", () => {
    const d = GM.rollD20(b.dataset.d20);
    showDice(d.value, "[" + d.rolls.join(", ") + "]", "d20 with " + (b.dataset.d20 === "adv" ? "advantage" : "disadvantage"), d.value === 20 ? "crit" : d.value === 1 ? "fumble" : "");
  }));
  $("#dice-form").addEventListener("submit", (ev) => { ev.preventDefault(); rollExpr($("#dice-expr").value); });

  /* ---------- Start ---------- */
  applyTheme();
  if (state.prefs.wake) setWake(true);
  showView(state.prefs.view || "combat");
  state.selectedId = state.combat.activeId;
  renderCombat();
  renderLibrary();
  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
})();
