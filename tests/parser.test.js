// Run with: node tests/parser.test.js
const assert = require("assert");
const GM = require("../parser.js");

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log("ok  " + name); }
  catch (e) { console.error("FAIL " + name + "\n  " + e.message); process.exitCode = 1; }
}

const seq = (values) => { let i = 0; return () => values[i++ % values.length]; };

test("roll handles modifiers and negatives", () => {
  const r = GM.roll("2d6 + 3", { rng: seq([0, 0.99]) });
  assert.strictEqual(r.total, 1 + 6 + 3);
  assert.strictEqual(GM.roll("1d8-1", { rng: seq([0]) }).total, 0);
  assert.strictEqual(GM.roll("d20", { rng: seq([0.999]) }).total, 20);
});

test("crit doubles dice, not modifiers", () => {
  const r = GM.roll("1d6+2", { rng: seq([0.99]), crit: true });
  assert.strictEqual(r.total, 6 + 6 + 2);
});

test("roll rejects junk", () => {
  assert.throws(() => GM.roll("2d"));
  assert.throws(() => GM.roll("hello"));
  assert.throws(() => GM.roll("101d6"));
});

const classic = `Ogre
Large giant, chaotic evil
Armor Class 11 (hide armor)
Hit Points 59 (7d10 + 21)
Speed 40 ft.
STR DEX CON INT WIS CHA
19 (+4) 8 (-1) 16 (+3) 5 (-3) 7 (-2) 7 (-2)
Senses darkvision 60 ft., passive Perception 8
Languages Common, Giant
Challenge 2 (450 XP)
Actions
Greatclub. Melee Weapon Attack: +6 to hit, reach 5 ft., one target. Hit: 13 (2d8 + 4) bludgeoning damage.
Javelin. Melee or Ranged Weapon Attack: +6 to hit, reach 5 ft. or range 30/120 ft., one target. Hit: 11 (2d6 + 4) piercing damage.`;

test("classic stat block: core numbers", () => {
  const m = GM.parseStatBlock(classic);
  assert.strictEqual(m.name, "Ogre");
  assert.strictEqual(m.ac, 11);
  assert.strictEqual(m.hp, 59);
  assert.strictEqual(m.max_hp, 59);
  assert.strictEqual(m.initiative_bonus, -1);
  assert.strictEqual(m.attacks.length, 2);
  assert.deepStrictEqual([m.attacks[0].name, m.attacks[0].bonus, m.attacks[0].damage], ["Greatclub", 6, "2d8+4"]);
  assert.strictEqual(m.attacks[1].damage, "2d6+4");
  assert.strictEqual(m.multiattack, undefined);
});

const ddbLayout = `Owlbear
Large Monstrosity, Unaligned
Armor Class 13 (Natural Armor)
Hit Points 59 (7d10 + 21)
Speed 40 ft.
STR
20 (+5)
DEX
12 (+1)
CON
17 (+3)
INT
3 (-4)
WIS
12 (+1)
CHA
7 (-2)
Skills Perception +3
Challenge 3 (700 XP)
Proficiency Bonus +2
Keen Sight and Smell. The owlbear has advantage on Wisdom (Perception) checks that rely on sight or smell.
Actions
Multiattack. The owlbear makes two attacks: one with its beak and one with its claws.
Beak. Melee Weapon Attack: +7 to hit, reach 5 ft., one creature. Hit: 10 (1d10 + 5) piercing damage.
Claws. Melee Weapon Attack: +7 to hit, reach 5 ft., one target. Hit: 14 (2d8 + 5) slashing damage.
Source: Basic Rules, pg. 249`;

test("D&D Beyond copy layout: traits, multiattack, source", () => {
  const m = GM.parseStatBlock(ddbLayout);
  assert.strictEqual(m.name, "Owlbear");
  assert.strictEqual(m.initiative_bonus, 1);
  assert.strictEqual(m.multiattack, "The owlbear makes two attacks: one with its beak and one with its claws.");
  assert.deepStrictEqual(m.attacks.map((a) => a.name), ["Beak", "Claws"]);
  assert.ok(!/Multiattack/.test(m.traits));
  assert.ok(/Keen Sight and Smell/.test(m.traits));
  assert.strictEqual(m.source, "Basic Rules");
});

const modern = `Bandit Captain
Medium or Small Humanoid, Neutral
AC 15 Initiative +3 (13)
HP 52 (8d8 + 16)
Speed 30 ft.
Str 15 +2 +4
Dex 16 +3 +5
CR 2 (XP 450; PB +2)
Actions
Multiattack. The bandit makes two Scimitar attacks and uses Pistol.
Scimitar. Melee Attack Roll: +5, reach 5 ft. Hit: 6 (1d6 + 3) Slashing damage.
Pistol. Ranged Attack Roll: +5, range 30/90 ft. Hit: 8 (1d10 + 3) Piercing damage.
Reactions
Parry. Trigger: The bandit is hit by a melee attack roll. Response: The bandit adds 2 to its AC.`;

test("2024 stat block format", () => {
  const m = GM.parseStatBlock(modern);
  assert.strictEqual(m.ac, 15);
  assert.strictEqual(m.hp, 52);
  assert.strictEqual(m.initiative_bonus, 3);
  assert.deepStrictEqual(m.attacks.map((a) => [a.name, a.bonus, a.damage]), [["Scimitar", 5, "1d6+3"], ["Pistol", 5, "1d10+3"]]);
  assert.strictEqual(m.multiattack, "The bandit makes two Scimitar attacks and uses Pistol.");
  assert.ok(/Reactions:/.test(m.traits) && /Parry/.test(m.traits));
});

test("save-based action keeps damage, no attack bonus", () => {
  const a = GM.parseAction("Poison Breath (Recharge 5-6)", "The dragon exhales poisonous gas in a 30-foot cone. Each creature in that area must make a DC 14 Constitution saving throw, taking 42 (12d6) poison damage on a failed save, or half as much damage on a successful one.");
  assert.strictEqual(a.bonus, null);
  assert.strictEqual(a.damage, "12d6");
});

test("extra damage is combined", () => {
  const a = GM.parseAction("Bite", "Melee Weapon Attack: +6 to hit, reach 10 ft., one target. Hit: 15 (2d10 + 4) piercing damage plus 7 (2d6) poison damage.");
  assert.strictEqual(a.damage, "2d10+4+2d6");
});

test("Open5e record mapping", () => {
  const m = GM.fromOpen5e({
    name: "Goblin", armor_class: 15, hit_points: 7, dexterity: 14, document__title: "5e Core Rules",
    special_abilities: [{ name: "Nimble Escape", desc: "The goblin can take the Disengage or Hide action as a bonus action." }],
    actions: [
      { name: "Scimitar", desc: "Melee Weapon Attack: +4 to hit, reach 5 ft., one target. Hit: 5 (1d6 + 2) slashing damage.", attack_bonus: 4, damage_dice: "1d6", damage_bonus: 2 },
      { name: "Shortbow", desc: "Ranged Weapon Attack: +4 to hit. Hit: 5 (1d6 + 2) piercing damage.", attack_bonus: 4, damage_dice: "1d6+2" },
    ],
  });
  assert.strictEqual(m.initiative_bonus, 2);
  assert.strictEqual(m.source, "5e Core Rules");
  assert.deepStrictEqual(m.attacks.map((a) => [a.bonus, a.damage]), [[4, "1d6+2"], [4, "1d6+2"]]);
  assert.ok(/Nimble Escape/.test(m.traits));
});

test("damage choices stay separate", () => {
  const a = GM.parseAction("Spear", "Melee or Ranged Weapon Attack: +7 to hit, reach 5 ft. or range 20/60 ft., one target. Hit: 11 (2d6 + 4) piercing damage, or 13 (2d8 + 4) piercing damage if used with two hands to make a melee attack.");
  assert.strictEqual(a.damage, "2d6+4");
  assert.deepStrictEqual(a.alt, [{ damage: "2d8+4", label: "two-handed" }]);
});

test("a trailing plus applies to every damage choice", () => {
  const a = GM.parseAction("Flame Tongue Longsword", "Melee Weapon Attack: +6 to hit. Hit: 7 (1d8 + 3) slashing damage, or 8 (1d10 + 3) slashing damage if used with two hands, plus 3 (1d6) fire damage.");
  assert.strictEqual(a.damage, "1d8+3+1d6");
  assert.deepStrictEqual(a.alt, [{ damage: "1d10+3+1d6", label: "two-handed" }]);
});

test("swarm half-HP damage is a choice", () => {
  const a = GM.parseAction("Bites", "Melee Weapon Attack: +3 to hit. Hit: 7 (2d6) piercing damage, or 3 (1d6) piercing damage if the swarm has half of its hit points or fewer.");
  assert.strictEqual(a.damage, "2d6");
  assert.deepStrictEqual(a.alt, [{ damage: "1d6", label: "at half HP" }]);
});

test("abilities, saves and skills from 2014 blocks", () => {
  const m = GM.parseStatBlock(classic.replace("Senses", "Saving Throws Str +6, Con +5\nSkills Athletics +6, Sleight of Hand +1\nSenses"));
  assert.deepStrictEqual(m.abilities, { str: 19, dex: 8, con: 16, int: 5, wis: 7, cha: 7 });
  assert.deepStrictEqual(m.saves, { str: 6, con: 5 });
  assert.deepStrictEqual(m.skills, { athletics: 6, "sleight of hand": 1 });
  const o = GM.parseStatBlock(ddbLayout);
  assert.deepStrictEqual(o.abilities, { str: 20, dex: 12, con: 17, int: 3, wis: 12, cha: 7 });
  assert.deepStrictEqual(o.skills, { perception: 3 });
});

test("abilities and saves from 2024 blocks", () => {
  const m = GM.parseStatBlock(modern.replace("Dex 16 +3 +5", "Dex 16 +3 +5\nCon 14 +2 +2\nInt 14 +2 +2\nWis 11 +0 +2\nCha 14 +2 +2"));
  assert.deepStrictEqual(m.abilities, { str: 15, dex: 16, con: 14, int: 14, wis: 11, cha: 14 });
  assert.deepStrictEqual(m.saves, { str: 4, dex: 5, wis: 2 });
});

test("Open5e abilities, saves and skills", () => {
  const m = GM.fromOpen5e({ name: "Gladiator", strength: 18, dexterity: 15, constitution: 16, intelligence: 10, wisdom: 12, charisma: 15, strength_save: 7, dexterity_save: 5, constitution_save: 6, skills: '{"athletics": 10, "intimidation": 5}', actions: [] });
  assert.deepStrictEqual(m.abilities, { str: 18, dex: 15, con: 16, int: 10, wis: 12, cha: 15 });
  assert.deepStrictEqual(m.saves, { str: 7, dex: 5, con: 6 });
  assert.deepStrictEqual(m.skills, { athletics: 10, intimidation: 5 });
});

test("splits several pasted stat blocks", () => {
  const blocks = GM.splitStatBlocks(classic + "\n\n" + ddbLayout + "\n\n" + modern);
  assert.strictEqual(blocks.length, 3);
  assert.deepStrictEqual(blocks.map((b) => GM.parseStatBlock(b).name), ["Ogre", "Owlbear", "Bandit Captain"]);
  // The Owlbear's source line stays with the Owlbear, not the next monster.
  assert.strictEqual(GM.parseStatBlock(blocks[1]).source, "Basic Rules");
  assert.strictEqual(GM.parseStatBlock(blocks[1]).attacks.length, 2);
});

test("separator lines split blocks too", () => {
  const blocks = GM.splitStatBlocks("Monsters for tonight\n---\n" + classic + "\n---\n" + modern);
  assert.deepStrictEqual(blocks.map((b) => GM.parseStatBlock(b).name), ["Ogre", "Bandit Captain"]);
});

test("a single stat block stays whole", () => {
  assert.strictEqual(GM.splitStatBlocks(ddbLayout).length, 1);
});

console.log(`\n${passed} passed`);
