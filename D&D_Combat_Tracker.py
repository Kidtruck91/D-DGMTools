"""Standalone Tkinter combat tracker. Run with: python Saltmarsh_Combat_Tracker.py"""
import json
import random
import re
import tkinter as tk
from pathlib import Path
from tkinter import filedialog, messagebox, simpledialog, ttk

DATA = Path(__file__).with_name("saltmarsh_monsters.json")
TERM = re.compile(r"([+-]?)(?:(\d*)d(\d+)|(\d+))$", re.I)


def roll(expression):
    expression = expression.replace(" ", "").lower()
    if not expression:
        raise ValueError("Enter a dice expression, such as 2d6+3.")
    parts = re.findall(r"[+-]?[^+-]+", expression)
    if "".join(parts) != expression:
        raise ValueError("Invalid dice expression.")
    total, details = 0, []
    for part in parts:
        match = TERM.fullmatch(part)
        if not match:
            raise ValueError("Use dice terms such as d20, 2d6+3, or 1d8-1.")
        sign, count, sides, flat = match.groups()
        factor = -1 if sign == "-" else 1
        if sides:
            n, d = int(count or 1), int(sides)
            if not 1 <= n <= 100 or not 2 <= d <= 1000:
                raise ValueError("Use 1–100 dice with 2–1000 sides each.")
            values = [random.randint(1, d) for _ in range(n)]
            total += factor * sum(values)
            details.append(f"{'-' if factor < 0 else '+'}[{', '.join(map(str, values))}]")
        else:
            total += factor * int(flat)
            details.append(f"{'-' if factor < 0 else '+'}{flat}")
    return total, " ".join(details).lstrip("+ ")


class Tracker(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("Saltmarsh Combat Tracker")
        self.geometry("1110x720")
        self.minsize(850, 560)
        self.combat = []
        self.monsters = self.load_monsters()
        self.turn = None
        self.round = 1
        self.tabs = ttk.Notebook(self)
        self.tabs.pack(fill="both", expand=True, padx=8, pady=8)
        self.combat_tab = ttk.Frame(self.tabs)
        self.monster_tab = ttk.Frame(self.tabs)
        self.dice_tab = ttk.Frame(self.tabs)
        for frame, name in ((self.combat_tab, "Combat"), (self.monster_tab, "Monsters"), (self.dice_tab, "Dice Roller")):
            self.tabs.add(frame, text=name)
        self.make_combat()
        self.make_monsters()
        self.make_dice()

    def load_monsters(self):
        try:
            data = json.loads(DATA.read_text(encoding="utf-8"))
            return data if isinstance(data, list) else []
        except FileNotFoundError:
            return []
        except (OSError, ValueError):
            messagebox.showwarning("Monster library", "The monster library could not be read. Starting with an empty library.")
            return []

    def save_monsters(self):
        DATA.write_text(json.dumps(self.monsters, indent=2, ensure_ascii=False), encoding="utf-8")

    def button(self, parent, label, action):
        ttk.Button(parent, text=label, command=action).pack(side="left", padx=3, pady=4)

    def make_combat(self):
        bar = ttk.Frame(self.combat_tab)
        bar.pack(fill="x")
        for label, action in (("Add Creature", self.add_creature), ("Add Event", self.add_event), ("Add Saved Monster", self.add_saved), ("Edit Selected", self.edit_selected), ("Remove", self.remove_selected), ("Next Turn", self.next_turn), ("New Combat", self.new_combat), ("Save Combat", self.save_combat), ("Load Combat", self.load_combat)):
            self.button(bar, label, action)
        self.round_label = ttk.Label(self.combat_tab, text="Round 1 — choose Next Turn to begin", font=("Segoe UI", 12, "bold"))
        self.round_label.pack(anchor="w", pady=6)
        main = ttk.Panedwindow(self.combat_tab, orient="horizontal")
        main.pack(fill="both", expand=True)
        left, right = ttk.Frame(main), ttk.Frame(main)
        main.add(left, weight=3)
        main.add(right, weight=2)
        self.table = ttk.Treeview(left, columns=("init", "name", "kind", "hp", "ac"), show="headings", selectmode="browse")
        for col, width in (("init", 75), ("name", 210), ("kind", 80), ("hp", 95), ("ac", 60)):
            self.table.heading(col, text=col.upper())
            self.table.column(col, width=width, anchor="w")
        self.table.pack(side="left", fill="both", expand=True)
        self.table.bind("<<TreeviewSelect>>", lambda event: self.show_selected())
        ttk.Scrollbar(left, command=self.table.yview).pack(side="right", fill="y")
        self.table.tag_configure("active", background="#c9e8ff")
        self.detail = ttk.Label(right, text="Select a creature or event", wraplength=390, justify="left", font=("Segoe UI", 11))
        self.detail.pack(fill="x", padx=10, pady=10)
        hpbar = ttk.Frame(right)
        hpbar.pack(fill="x", padx=8)
        ttk.Label(hpbar, text="HP amount:").pack(side="left")
        self.hp_amount = ttk.Entry(hpbar, width=8)
        self.hp_amount.pack(side="left", padx=5)
        self.button(hpbar, "Damage", lambda: self.change_hp(-1))
        self.button(hpbar, "Heal", lambda: self.change_hp(1))
        self.attack_frame = ttk.LabelFrame(right, text="Selected creature attacks")
        self.attack_frame.pack(fill="x", padx=8, pady=8)
        self.log = tk.Text(right, height=12, state="disabled", wrap="word")
        self.log.pack(fill="both", expand=True, padx=8, pady=8)

    def make_monsters(self):
        bar = ttk.Frame(self.monster_tab)
        bar.pack(fill="x")
        for label, action in (("Create Monster", self.create_monster), ("Edit Monster", self.edit_monster), ("Delete Monster", self.delete_monster), ("Add to Combat", self.add_saved)):
            self.button(bar, label, action)
        self.monster_list = tk.Listbox(self.monster_tab, font=("Segoe UI", 11))
        self.monster_list.pack(fill="both", expand=True, padx=8, pady=8)
        self.refresh_monsters()

    def make_dice(self):
        frame = ttk.Frame(self.dice_tab, padding=20)
        frame.pack(fill="both", expand=True)
        ttk.Label(frame, text="Dice expression (e.g. 2d6+3)").pack(anchor="w")
        self.dice_entry = ttk.Entry(frame, width=25)
        self.dice_entry.pack(anchor="w", pady=5)
        self.dice_entry.insert(0, "d20")
        self.button(frame, "Roll", self.general_roll)
        self.dice_entry.bind("<Return>", lambda event: self.general_roll())
        self.dice_log = tk.Text(frame, state="disabled", height=20, wrap="word")
        self.dice_log.pack(fill="both", expand=True, pady=12)

    def append(self, widget, line):
        widget.configure(state="normal")
        widget.insert("end", line + "\n")
        widget.see("end")
        widget.configure(state="disabled")

    def general_roll(self):
        try:
            result, detail = roll(self.dice_entry.get())
            self.append(self.dice_log, f"{self.dice_entry.get()} → {result}   ({detail})")
        except ValueError as error:
            messagebox.showerror("Dice", str(error))

    def selected_index(self):
        selection = self.table.selection()
        return int(selection[0]) if selection else None

    def refresh_combat(self, select=None):
        self.combat.sort(key=lambda item: -item["initiative"])
        self.table.delete(*self.table.get_children())
        for i, item in enumerate(self.combat):
            hp = "—" if item["kind"] == "event" or item.get("hp") is None else f'{item["hp"]}/{item.get("max_hp", item["hp"])}'
            self.table.insert("", "end", iid=str(i), values=(item["initiative"], item["name"], item["kind"], hp, item.get("ac") if item["kind"] == "creature" and item.get("ac") is not None else "—"), tags=("active",) if i == self.turn else ())
        if select is not None and self.combat:
            self.table.selection_set(str(select))
        self.round_label.configure(text=f"Round {self.round}" + (f' — {self.combat[self.turn]["name"]}\'s turn' if self.turn is not None and self.combat else " — choose Next Turn to begin"))
        self.show_selected()

    def show_selected(self):
        i = self.selected_index()
        for child in self.attack_frame.winfo_children():
            child.destroy()
        if i is None or i >= len(self.combat):
            self.detail.configure(text="Select a creature or event")
            return
        item = self.combat[i]
        if item["kind"] == "event":
            self.detail.configure(text=f'{item["name"]}\n\n{item.get("description", "")}')
            return
        self.detail.configure(text=f'{item["name"]}\nHP: {item.get("hp") if item.get("hp") is not None else "not tracked"}   AC: {item.get("ac") if item.get("ac") is not None else "not tracked"}\nMultiattack: {"Yes" if item.get("ma") else "No"}\n\nTraits: {item.get("traits") or "—"}')
        for attack in item.get("attacks", []):
            row = ttk.Frame(self.attack_frame)
            row.pack(fill="x")
            ttk.Label(row, text=attack["name"], width=18).pack(side="left")
            self.button(row, "Attack", lambda a=attack: self.roll_attack(a))
            self.button(row, "Damage", lambda a=attack: self.roll_damage(a))
            if attack.get("description"):
                ttk.Label(self.attack_frame, text=attack["description"], wraplength=340, justify="left").pack(anchor="w", padx=10, pady=(0, 6))
        if item.get("ma") and item.get("attacks"):
            ttk.Button(self.attack_frame, text="Roll Multiattack", command=lambda unit=item: self.roll_multiattack(unit)).pack(anchor="w", pady=5)

    def change_hp(self, sign):
        i = self.selected_index()
        if i is None or self.combat[i]["kind"] != "creature":
            return
        try:
            amount = int(self.hp_amount.get())
            if amount < 0:
                raise ValueError
        except ValueError:
            messagebox.showerror("HP", "Enter a nonnegative whole number.")
            return
        unit = self.combat[i]
        if unit.get("hp") is None:
            messagebox.showinfo("HP", "Edit this creature to set its starting HP first.")
            return
        unit["hp"] = max(0, unit["hp"] + sign * amount)
        self.append(self.log, f'{unit["name"]}: {"healed" if sign > 0 else "took"} {amount}; HP {unit["hp"]}')
        self.refresh_combat(i)

    def roll_attack(self, attack):
        value, dice = roll("d20")
        bonus = int(attack.get("bonus", 0))
        self.append(self.log, f'{attack["name"]}: {value} + {bonus} = {value + bonus}' + (" [natural 20]" if value == 20 else " [natural 1]" if value == 1 else ""))
        if attack.get("description"):
            self.append(self.log, f'Effect: {attack["description"]}')

    def roll_damage(self, attack):
        if not attack.get("damage"):
            self.append(self.log, f'{attack["name"]}: special effect; no damage dice configured')
            return
        try:
            result, detail = roll(attack["damage"])
            self.append(self.log, f'{attack["name"]} damage: {result} ({detail})')
        except ValueError as error:
            messagebox.showerror("Damage", str(error))

    def roll_multiattack(self, unit):
        for attack in unit.get("attacks", []):
            for _ in range(max(0, min(20, int(attack.get("count", 1))))):
                self.roll_attack(attack)
                self.roll_damage(attack)

    def next_turn(self):
        if not self.combat:
            return
        if self.turn is None:
            self.turn = 0
        elif self.turn + 1 >= len(self.combat):
            self.turn = 0
            self.round += 1
        else:
            self.turn += 1
        self.refresh_combat(self.turn)
        unit = self.combat[self.turn]
        self.append(self.log, f'Round {self.round}: {unit["name"]}' + (f' — {unit.get("description", "")}' if unit["kind"] == "event" else ""))

    def entity_dialog(self, kind, initial=None):
        dialog = tk.Toplevel(self)
        dialog.title("Edit " + kind.title())
        dialog.transient(self)
        dialog.grab_set()
        dialog.geometry("570x610" if kind == "creature" else "510x290")
        fields = {}
        body = ttk.Frame(dialog, padding=12)
        body.pack(fill="both", expand=True)
        specifications = [("name", "Name"), ("initiative", "Initiative")]
        if kind == "creature":
            specifications += [("initiative_bonus", "Initiative bonus"), ("hp", "HP (optional)"), ("ac", "AC (optional)"), ("traits", "Traits / features")]
        else:
            specifications += [("description", "What happens")]
        for key, label in specifications:
            ttk.Label(body, text=label).pack(anchor="w")
            if key in ("traits", "description"):
                widget = tk.Text(body, height=5, width=54)
                widget.pack(fill="x", pady=(0, 7))
            else:
                widget = ttk.Entry(body, width=55)
                widget.pack(fill="x", pady=(0, 7))
            fields[key] = widget
        if kind == "creature":
            def roll_initiative():
                try:
                    bonus = int(fields["initiative_bonus"].get() or 0)
                except ValueError:
                    messagebox.showerror("Initiative", "Enter a whole-number initiative bonus.", parent=dialog)
                    return
                die = random.randint(1, 20)
                fields["initiative"].delete(0, "end")
                fields["initiative"].insert(0, str(die + bonus))
                messagebox.showinfo("Initiative", f"d20 ({die}) + {bonus} = {die + bonus}", parent=dialog)
            ttk.Button(body, text="Roll Initiative", command=roll_initiative).pack(anchor="w")
        if kind == "creature":
            ma = tk.BooleanVar(value=bool((initial or {}).get("ma", False)))
            ttk.Checkbutton(body, text="Multiattack (roll each attack its count of times)", variable=ma).pack(anchor="w")
            attacks = json.loads(json.dumps((initial or {}).get("attacks", [])))
            attack_box = ttk.LabelFrame(body, text="Attacks")
            attack_box.pack(fill="both", expand=True, pady=6)
            attack_list = tk.Listbox(attack_box, height=5)
            attack_list.pack(fill="both", expand=True, padx=5)
            def refresh_attacks():
                attack_list.delete(0, "end")
                for attack in attacks:
                    attack_list.insert("end", f'{attack["name"]}  +{attack.get("bonus", 0)}  {attack.get("damage") or "Special"}  ×{attack.get("count", 1)}')
            def edit_attack(new=False):
                selection = attack_list.curselection()
                if not new and not selection:
                    return
                index = selection[0] if selection else None
                updated = self.attack_dialog(dialog, None if new else attacks[index])
                if updated:
                    if new:
                        attacks.append(updated)
                    else:
                        attacks[index] = updated
                    refresh_attacks()
            def remove_attack():
                selection = attack_list.curselection()
                if selection:
                    attacks.pop(selection[0])
                    refresh_attacks()
            attack_buttons = ttk.Frame(attack_box)
            attack_buttons.pack(anchor="w")
            self.button(attack_buttons, "Add", lambda: edit_attack(True))
            self.button(attack_buttons, "Edit", edit_attack)
            self.button(attack_buttons, "Remove", remove_attack)
            refresh_attacks()
        if initial:
            for key, widget in fields.items():
                value = initial.get(key)
                value = "" if value is None else str(value)
                if isinstance(widget, tk.Text):
                    widget.insert("1.0", value)
                else:
                    widget.insert(0, value)
        result = []

        def submit():
            try:
                values = {key: (widget.get("1.0", "end") if isinstance(widget, tk.Text) else widget.get()).strip() for key, widget in fields.items()}
                if not values["name"]:
                    raise ValueError("A name is required.")
                item = {"kind": kind, "name": values["name"], "initiative": int(values["initiative"] or 0)}
                if kind == "event":
                    item["description"] = values["description"]
                else:
                    item.update({"initiative_bonus": int(values["initiative_bonus"] or 0), "hp": int(values["hp"]) if values["hp"] else None, "ac": int(values["ac"]) if values["ac"] else None, "traits": values["traits"], "ma": ma.get(), "attacks": attacks})
                    item["max_hp"] = (initial or {}).get("max_hp", item["hp"]) if initial and values["hp"] == str(initial.get("hp")) else item["hp"]
                result.append(item)
                dialog.destroy()
            except ValueError as error:
                messagebox.showerror("Invalid entry", str(error), parent=dialog)

        ttk.Button(body, text="Save", command=submit).pack(anchor="e", pady=5)
        dialog.wait_window()
        return result[0] if result else None

    def attack_dialog(self, parent, initial=None):
        dialog = tk.Toplevel(parent)
        dialog.title("Attack Builder")
        dialog.transient(parent)
        dialog.grab_set()
        dialog.geometry("530x390")
        body = ttk.Frame(dialog, padding=12)
        body.pack(fill="both", expand=True)
        fields = {}
        for key, label, default in (("name", "Attack name", ""), ("bonus", "Attack bonus", "0"), ("damage", "Damage dice and bonus (e.g. 2d6+3; blank for special)", ""), ("count", "Uses in multiattack", "1")):
            ttk.Label(body, text=label).pack(anchor="w")
            entry = ttk.Entry(body)
            entry.insert(0, str((initial or {}).get(key, default)))
            entry.pack(fill="x", pady=(0, 5))
            fields[key] = entry
        ttk.Label(body, text="Description / other effects (saves, conditions, reach, etc.)").pack(anchor="w")
        description = tk.Text(body, height=5)
        description.insert("1.0", (initial or {}).get("description", ""))
        description.pack(fill="both", expand=True)
        result = []
        def submit():
            try:
                name = fields["name"].get().strip()
                if not name:
                    raise ValueError("Enter an attack name.")
                damage = fields["damage"].get().strip()
                if damage:
                    roll(damage)
                count = int(fields["count"].get())
                if not 1 <= count <= 20:
                    raise ValueError("Multiattack uses must be 1–20.")
                result.append({"name": name, "bonus": int(fields["bonus"].get()), "damage": damage, "count": count, "description": description.get("1.0", "end").strip()})
                dialog.destroy()
            except ValueError as error:
                messagebox.showerror("Attack Builder", str(error), parent=dialog)
        ttk.Button(body, text="Save Attack", command=submit).pack(anchor="e", pady=5)
        dialog.wait_window()
        return result[0] if result else None

    def add_creature(self):
        item = self.entity_dialog("creature")
        if item:
            self.insert_entity(item)

    def add_event(self):
        item = self.entity_dialog("event")
        if item:
            self.insert_entity(item)

    def insert_entity(self, item):
        active = self.combat[self.turn] if self.turn is not None and self.combat else None
        self.combat.append(item)
        self.combat.sort(key=lambda unit: -unit["initiative"])
        self.turn = next((i for i, unit in enumerate(self.combat) if unit is active), None)
        self.refresh_combat(self.combat.index(item))

    def edit_selected(self):
        i = self.selected_index()
        if i is None:
            return
        old = self.combat[i]
        updated = self.entity_dialog(old["kind"], old)
        if updated:
            active = self.combat[self.turn] if self.turn is not None else None
            self.combat[i] = updated
            if active is old:
                active = updated
            self.combat.sort(key=lambda unit: -unit["initiative"])
            self.turn = next((j for j, unit in enumerate(self.combat) if unit is active), None)
            self.refresh_combat(self.combat.index(updated))

    def remove_selected(self):
        i = self.selected_index()
        if i is None:
            return
        self.combat.pop(i)
        if self.turn is not None:
            self.turn = None if not self.combat else min(self.turn - (i < self.turn), len(self.combat) - 1)
        self.refresh_combat()

    def new_combat(self):
        if self.combat and not messagebox.askyesno("New Combat", "Clear the current combat? Save it first if you need it later."):
            return
        self.combat, self.turn, self.round = [], None, 1
        self.refresh_combat()

    def save_combat(self):
        path = filedialog.asksaveasfilename(defaultextension=".json", filetypes=[("JSON", "*.json")])
        if path:
            try:
                Path(path).write_text(json.dumps({"round": self.round, "turn": self.turn, "entities": self.combat}, indent=2, ensure_ascii=False), encoding="utf-8")
            except OSError as error:
                messagebox.showerror("Save Combat", str(error))

    def load_combat(self):
        path = filedialog.askopenfilename(filetypes=[("JSON", "*.json")])
        if not path:
            return
        try:
            data = json.loads(Path(path).read_text(encoding="utf-8"))
            entities = data["entities"]
            if not isinstance(entities, list) or any(e.get("kind") not in ("creature", "event") or not isinstance(e.get("initiative"), int) or not e.get("name") for e in entities):
                raise ValueError("Invalid combat file.")
            self.combat = entities
            self.round = max(1, int(data.get("round", 1)))
            turn = data.get("turn")
            self.turn = turn if isinstance(turn, int) and 0 <= turn < len(entities) else None
            self.refresh_combat(self.turn)
        except (OSError, ValueError, KeyError, TypeError, AttributeError) as error:
            messagebox.showerror("Load Combat", str(error))

    def refresh_monsters(self):
        self.monster_list.delete(0, "end") if hasattr(self, "monster_list") else None
        if hasattr(self, "monster_list"):
            for item in self.monsters:
                self.monster_list.insert("end", f'{item["name"]}   HP {item.get("hp") or "—"}   AC {item.get("ac") or "—"}')

    def monster_index(self):
        selection = self.monster_list.curselection()
        return selection[0] if selection else None

    def create_monster(self):
        item = self.entity_dialog("creature")
        if item:
            self.monsters.append(item)
            self.save_monsters()
            self.refresh_monsters()

    def edit_monster(self):
        i = self.monster_index()
        if i is None:
            return
        item = self.entity_dialog("creature", self.monsters[i])
        if item:
            self.monsters[i] = item
            self.save_monsters()
            self.refresh_monsters()

    def delete_monster(self):
        i = self.monster_index()
        if i is not None and messagebox.askyesno("Delete Monster", f'Delete {self.monsters[i]["name"]} from the library?'):
            self.monsters.pop(i)
            self.save_monsters()
            self.refresh_monsters()

    def add_saved(self):
        i = self.monster_index()
        if i is None:
            self.tabs.select(self.monster_tab)
            messagebox.showinfo("Add Saved Monster", "Select a monster in the Monsters tab first.")
            return
        item = json.loads(json.dumps(self.monsters[i]))
        name = simpledialog.askstring("Combat name", "Name for this combatant:", initialvalue=item["name"], parent=self)
        if name is None:
            return
        item["name"] = name.strip() or item["name"]
        initiative = self.prompt_initiative(item)
        if initiative is None:
            return
        item["initiative"] = initiative
        self.insert_entity(item)
        self.tabs.select(self.combat_tab)

    def prompt_initiative(self, item):
        dialog = tk.Toplevel(self)
        dialog.title("Initiative")
        dialog.transient(self)
        dialog.grab_set()
        ttk.Label(dialog, text=f'{item["name"]} — initiative bonus {int(item.get("initiative_bonus", 0)):+d}').pack(padx=18, pady=10)
        entry = ttk.Entry(dialog, width=14)
        entry.insert(0, str(item.get("initiative", 0)))
        entry.pack(padx=18)
        result = []
        def accept():
            try:
                result.append(int(entry.get()))
                dialog.destroy()
            except ValueError:
                messagebox.showerror("Initiative", "Enter a whole number.", parent=dialog)
        def rolled():
            die = random.randint(1, 20)
            bonus = int(item.get("initiative_bonus", 0))
            result.append(die + bonus)
            self.append(self.log, f'{item["name"]} initiative: {die} + {bonus} = {die + bonus}')
            dialog.destroy()
        buttons = ttk.Frame(dialog)
        buttons.pack(pady=12)
        ttk.Button(buttons, text="Use Entered", command=accept).pack(side="left", padx=5)
        ttk.Button(buttons, text="Roll d20 + Bonus", command=rolled).pack(side="left", padx=5)
        ttk.Button(buttons, text="Cancel", command=dialog.destroy).pack(side="left", padx=5)
        dialog.bind("<Return>", lambda event: accept())
        dialog.wait_window()
        return result[0] if result else None


if __name__ == "__main__":
    Tracker().mainloop()
