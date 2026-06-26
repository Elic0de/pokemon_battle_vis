import os
from typing import Any

from cg.api import Observation, to_observation_class


AREA_NAMES = {
    1: "deck",
    2: "hand",
    3: "discard",
    4: "active",
    5: "bench",
    6: "prize",
    7: "stadium",
    12: "looking",
}

OPTION_TYPE_NAMES = {
    0: "Number",
    1: "Yes",
    2: "No",
    3: "Card",
    4: "ToolCard",
    5: "EnergyCard",
    6: "Energy",
    7: "Play",
    8: "Attach",
    9: "Evolve",
    10: "Ability",
    11: "Discard",
    12: "Retreat",
    13: "Attack",
    14: "End",
    15: "Skill",
    16: "SpecialCondition",
}

SELECT_CONTEXT_NAMES = {
    0: "Main",
    1: "SetupActivePokemon",
    2: "SetupBenchPokemon",
    3: "Switch",
    4: "ToActive",
    5: "ToBench",
    6: "ToField",
    7: "ToHand",
    8: "Discard",
    9: "ToDeck",
    10: "ToDeckBottom",
    15: "Damage",
    17: "Heal",
    18: "EvolvesFrom",
    19: "EvolvesTo",
    21: "AttachFrom",
    22: "AttachTo",
    35: "Attack",
    37: "Evolve",
    38: "DrawCount",
    41: "IsFirst",
    43: "Activate",
}

CARD_META = {
    3: {"name": "Basic {W} Energy", "stage": "Basic Energy", "hp": 0, "damages": []},
    721: {"name": "Kyogre", "stage": "Basic Pokemon", "hp": 150, "damages": [20, 130]},
    722: {"name": "Snover", "stage": "Basic Pokemon", "hp": 90, "damages": [10, 30]},
    723: {"name": "Mega Abomasnow ex", "stage": "Stage 1 Pokemon", "hp": 350, "damages": [100, 200]},
    1145: {"name": "Mega Signal", "stage": "Item", "hp": 0, "damages": []},
    1158: {"name": "Maximum Belt", "stage": "Pokemon Tool", "hp": 0, "damages": []},
    1205: {"name": "Cyrano", "stage": "Supporter", "hp": 0, "damages": []},
    1227: {"name": "Lillie's Determination", "stage": "Supporter", "hp": 0, "damages": []},
    1235: {"name": "Waitress", "stage": "Supporter", "hp": 0, "damages": []},
}


def read_deck_csv() -> list[int]:
    file_path = "deck.csv"
    if not os.path.exists(file_path):
        file_path = "/kaggle_simulations/agent/" + file_path
    with open(file_path, "r", encoding="utf-8") as file:
        rows = file.read().splitlines()
    return [int(rows[i]) for i in range(60)]


def option_to_dict(option: Any) -> dict[str, Any]:
    if isinstance(option, dict):
        return option
    data = {}
    for name in (
        "type",
        "area",
        "index",
        "playerIndex",
        "inPlayArea",
        "inPlayIndex",
        "attackId",
        "number",
        "count",
        "energyIndex",
        "toolIndex",
    ):
        if hasattr(option, name):
            data[name] = getattr(option, name)
    return data


def normalize_name(value: Any) -> str:
    if isinstance(value, int):
        return OPTION_TYPE_NAMES.get(value, str(value))
    if value is None:
        return ""
    return str(value).split(".")[-1].replace("_", "").replace(" ", "")


def normalize_context(value: Any) -> str:
    if isinstance(value, int):
        return SELECT_CONTEXT_NAMES.get(value, str(value))
    if value is None:
        return ""
    return str(value).split(".")[-1].replace("_", "").replace(" ", "")


def safe_list(value: Any) -> list[Any]:
    if value is None:
        return []
    return value if isinstance(value, list) else [value]


def get_player(current: dict[str, Any], player_index: int | None) -> dict[str, Any]:
    players = current.get("players", [])
    if not isinstance(players, list) or player_index is None:
        return {}
    if player_index < 0 or player_index >= len(players):
        return {}
    return players[player_index] if isinstance(players[player_index], dict) else {}


def get_card_from_area(current: dict[str, Any], player_index: int | None, area: Any, index: Any) -> dict[str, Any] | None:
    if not isinstance(area, int) or not isinstance(index, int):
        return None
    zone = AREA_NAMES.get(area)
    if zone is None:
        return None
    if zone in ("stadium", "looking"):
        cards = safe_list(current.get(zone))
    else:
        cards = safe_list(get_player(current, player_index).get(zone))
    if 0 <= index < len(cards) and isinstance(cards[index], dict):
        return cards[index]
    return None


def active_card(current: dict[str, Any], player_index: int) -> dict[str, Any] | None:
    active = safe_list(get_player(current, player_index).get("active"))
    return active[0] if active and isinstance(active[0], dict) else None


def card_name(card: dict[str, Any] | None) -> str:
    if isinstance(card, dict):
        name = str(card.get("name", "") or "")
        if name:
            return name
        meta = card_meta(card)
        if meta:
            return str(meta.get("name", "") or "")
    return ""


def card_id(card: dict[str, Any] | None) -> int:
    return int(card.get("id", 0) or card.get("cardId", 0) or 0) if isinstance(card, dict) else 0


def card_meta(card: dict[str, Any] | None) -> dict[str, Any]:
    return CARD_META.get(card_id(card), {}) if isinstance(card, dict) else {}


def meta_stage(meta: dict[str, Any]) -> str:
    return str(meta.get("stage", "") or "").lower()


def is_basic_pokemon(meta: dict[str, Any]) -> bool:
    stage = meta_stage(meta)
    return "basic" in stage and ("pokemon" in stage or "pokémon" in stage)


def is_evolution(meta: dict[str, Any]) -> bool:
    stage = meta_stage(meta)
    return "stage 1" in stage or "stage 2" in stage


def is_energy(meta: dict[str, Any]) -> bool:
    return "energy" in meta_stage(meta)


def is_supporter(meta: dict[str, Any]) -> bool:
    return "supporter" in meta_stage(meta)


def is_item_like(meta: dict[str, Any]) -> bool:
    stage = meta_stage(meta)
    return "item" in stage or "tool" in stage or "stadium" in stage


def max_attack_damage(meta: dict[str, Any], attack_id: Any) -> int:
    damages = meta.get("damages", []) if isinstance(meta, dict) else []
    if isinstance(attack_id, int) and 0 <= attack_id < len(damages):
        return int(damages[attack_id])
    return max([int(value) for value in damages], default=0)


def card_meta_score(meta: dict[str, Any]) -> float:
    if not meta:
        return 0.0
    score = 0.0
    stage = meta_stage(meta)
    hp_value = int(meta.get("hp", 0) or 0)
    if is_basic_pokemon(meta):
        score += 12.0
        if hp_value >= 120:
            score += 10.0
        elif hp_value >= 90:
            score += 5.0
    elif is_evolution(meta):
        score += 16.0
        if hp_value >= 160:
            score += 8.0
    elif "basic energy" in stage:
        score += 4.0
    elif "special energy" in stage:
        score += 8.0
    elif is_supporter(meta):
        score += 12.0
    elif is_item_like(meta):
        score += 8.0
    return score




def hp(card: dict[str, Any] | None) -> int:
    return int(card.get("hp", 0) or 0) if isinstance(card, dict) else 0


def max_hp(card: dict[str, Any] | None) -> int:
    return int(card.get("maxHp", 0) or 0) if isinstance(card, dict) else 0


def has_energy(card: dict[str, Any] | None) -> bool:
    if not isinstance(card, dict):
        return False
    return bool(card.get("energies") or card.get("energyCards"))


def hand_count(current: dict[str, Any], player_index: int) -> int:
    player = get_player(current, player_index)
    return int(player.get("handCount", 0) or len(safe_list(player.get("hand"))))


def deck_count(current: dict[str, Any], player_index: int) -> int:
    player = get_player(current, player_index)
    return int(player.get("deckCount", 0) or len(safe_list(player.get("deck"))))


def bench_count(current: dict[str, Any], player_index: int) -> int:
    return len(safe_list(get_player(current, player_index).get("bench")))


def classify(type_name: str, option: dict[str, Any], select: dict[str, Any], card: dict[str, Any] | None) -> str:
    context = normalize_context(select.get("context"))
    text = f"{type_name} {option} {context}".lower()
    name = card_name(card).lower()
    meta = card_meta(card)
    if type_name == "End":
        return "end_turn"
    if type_name == "Attack":
        return "attack"
    if type_name == "Retreat":
        return "switch"
    if type_name == "Evolve":
        return "evolve"
    if type_name == "Attach":
        return "attach_energy"
    if type_name == "Ability":
        return "ability"
    if type_name in ("Yes", "No"):
        return "yes_no"
    if type_name in ("Energy", "EnergyCard"):
        return "energy_choice"
    if type_name == "Number":
        return "number"
    if type_name == "Card":
        if context in ("SetupActivePokemon", "SetupBenchPokemon", "ToBench", "ToField"):
            return "bench_basic"
        if context in ("Switch", "ToActive"):
            return "switch_target"
        if context in ("Discard", "ToDeck", "ToDeckBottom"):
            return "discard_choice"
        if context in ("ToHand", "Look", "NotMove"):
            return "search_or_draw"
        if context in ("EvolvesFrom", "EvolvesTo", "Evolve"):
            return "evolve_candidate"
        if context in ("AttachFrom", "AttachTo"):
            return "attach_energy" if is_energy(meta) else "attach_target"
        if context in ("Heal",):
            return "heal"
        if context in ("Damage", "EffectTarget"):
            return "effect_target"
        if is_basic_pokemon(meta):
            return "bench_basic"
        if is_evolution(meta):
            return "evolve_candidate"
        if is_energy(meta):
            return "energy_choice"
        if is_supporter(meta):
            return "support_or_draw"
        if is_item_like(meta):
            if any(word in name for word in ("ball", "signal", "search")):
                return "setup_or_search"
            return "trainer_choice"
        if "setup" in text or "bench" in text:
            return "bench_basic"
        if "active" in text or "switch" in text:
            return "switch_target"
        if "discard" in text:
            return "discard_choice"
        if "hand" in text:
            return "search_or_draw"
        return "card_choice"
    if type_name == "Play":
        if is_supporter(meta):
            return "support_or_draw"
        if is_item_like(meta) and any(word in name for word in ("ball", "signal", "search")):
            return "setup_or_search"
        if any(word in name for word in ("ball", "poffin", "nest", "ultra")):
            return "setup_or_search"
        if any(word in name for word in ("professor", "research", "iono", "hilda", "dawn", "lana", "draw")):
            return "support_or_draw"
        if any(word in name for word in ("potion", "heal", "aid")):
            return "heal"
        if any(word in name for word in ("switch", "cart", "balloon")):
            return "switch"
        return "play_card"
    return "other"


def card_name_score(name: str) -> float:
    text = name.lower()
    score = 0.0
    if any(word in text for word in ("professor", "research", "iono", "hilda", "dawn", "draw")):
        score += 28.0
    if any(word in text for word in ("ball", "poffin", "nest", "ultra", "search")):
        score += 24.0
    if any(word in text for word in ("boss", "catcher", "switch")):
        score += 18.0
    if any(word in text for word in ("potion", "heal", "aid")):
        score += 14.0
    if any(word in text for word in ("hammer", "stretcher", "ash")):
        score += 10.0
    return score


def score_option(index: int, raw_option: Any, obs_dict: dict[str, Any]) -> float:
    current = obs_dict.get("current") if isinstance(obs_dict.get("current"), dict) else {}
    select = obs_dict.get("select") if isinstance(obs_dict.get("select"), dict) else {}
    your_index = int(current.get("yourIndex", 0) or 0)
    opp_index = 1 - your_index
    option = option_to_dict(raw_option)
    type_name = normalize_name(option.get("type"))
    player_index = option.get("playerIndex", your_index)
    area = option.get("area")
    if type_name == "Play" and area is None and isinstance(option.get("index"), int):
        area = 2
        player_index = your_index
    card = get_card_from_area(current, player_index, area, option.get("index"))
    meta = card_meta(card)
    category = classify(type_name, option, select, card)
    my_active = active_card(current, your_index)
    opp_active = active_card(current, opp_index)
    active_meta = card_meta(my_active)
    my_hp = hp(my_active)
    my_max_hp = max_hp(my_active)
    opp_hp = hp(opp_active)
    turn = int(current.get("turn", 0) or 0)
    my_hand = hand_count(current, your_index)
    my_deck = deck_count(current, your_index)
    my_bench = bench_count(current, your_index)
    score = 0.0

    if category == "end_turn":
        score -= 70.0
    elif category == "attack":
        damage = max_attack_damage(active_meta, option.get("attackId"))
        score += 58.0
        if damage:
            score += min(damage, 220) * 0.15
        if opp_hp > 0 and damage >= opp_hp:
            score += 130.0
        elif opp_hp > 0:
            score += 24.0 if opp_hp <= 60 else 14.0 if opp_hp <= 100 else 8.0 if opp_hp <= 150 else 0.0
    elif category == "attach_energy":
        score += 48.0 + (24.0 if turn <= 3 else 0.0)
        if option.get("inPlayArea") == 4 or (my_active and not has_energy(my_active)):
            score += 14.0
    elif category == "attach_target":
        score += 20.0 + (10.0 if option.get("area") == 4 or option.get("inPlayArea") == 4 else 0.0)
    elif category == "bench_basic":
        score += 42.0 + card_meta_score(meta) + (28.0 if turn <= 3 else 0.0) + (18.0 if my_bench == 0 else 0.0)
    elif category == "evolve":
        score += 82.0 + card_meta_score(meta) + (18.0 if turn >= 2 else 0.0)
    elif category == "evolve_candidate":
        score += 42.0 + card_meta_score(meta) + (16.0 if turn >= 2 else 0.0)
    elif category == "ability":
        score += 38.0 + (10.0 if my_hand <= 3 else 0.0)
    elif category == "support_or_draw":
        score += 36.0 + card_name_score(card_name(card)) + card_meta_score(meta)
        score += 32.0 if my_hand <= 3 else 12.0 if my_hand <= 5 else 0.0
        score -= 20.0 if my_deck <= 5 else 0.0
    elif category == "setup_or_search":
        score += 32.0 + card_name_score(card_name(card)) + card_meta_score(meta)
        score += 24.0 if turn <= 4 else 0.0
        score += 14.0 if my_bench <= 2 else 0.0
    elif category == "trainer_choice":
        score += 16.0 + card_name_score(card_name(card)) * 0.7 + card_meta_score(meta)
    elif category == "play_card":
        score += 18.0 + card_name_score(card_name(card)) + card_meta_score(meta)
    elif category in ("switch", "switch_target"):
        score += 22.0
        if my_hp > 0 and my_max_hp > 0 and my_hp <= max(40, my_max_hp // 3):
            score += 38.0
    elif category == "heal":
        score += 24.0
        if my_hp > 0 and my_max_hp > 0 and my_hp <= my_max_hp // 2:
            score += 36.0
    elif category == "effect_target":
        score += 16.0 + (12.0 if player_index == opp_index else 0.0)
    elif category == "yes_no":
        score += 8.0 if type_name == "Yes" else -2.0
    elif category == "number":
        score += float(option.get("number", 0) or 0)
    elif category == "discard_choice":
        score -= 8.0 + card_name_score(card_name(card)) * 0.5
    elif category in ("search_or_draw", "card_choice"):
        score += 10.0 + card_name_score(card_name(card)) * 0.5 + card_meta_score(meta) * 0.7
    else:
        score += 4.0

    return score - index * 0.001


def clamp_count(select: dict[str, Any], option_count: int) -> int:
    min_count = int(select.get("minCount", 1) or 1)
    max_count = int(select.get("maxCount", min_count) or min_count)
    if option_count <= 0:
        return 0
    return max(min_count, min(max_count, option_count))


def normalize_action(indices: list[int], select: dict[str, Any]) -> list[int]:
    options = select.get("option", [])
    option_count = len(options) if isinstance(options, list) else 0
    count = clamp_count(select, option_count)
    result = []
    seen = set()

    for idx in indices:
        if isinstance(idx, int) and 0 <= idx < option_count and idx not in seen:
            result.append(idx)
            seen.add(idx)
        if len(result) >= count:
            return result

    for idx in range(option_count):
        if idx not in seen:
            result.append(idx)
        if len(result) >= count:
            return result
    return result


def rule_based_agent(obs_dict: dict[str, Any]) -> list[int]:
    select = obs_dict.get("select")
    if not isinstance(select, dict):
        return []
    options = select.get("option", [])
    if not isinstance(options, list) or not options:
        return []

    try:
        ranked = sorted(
            range(len(options)),
            key=lambda i: score_option(i, options[i], obs_dict),
            reverse=True,
        )
    except Exception:
        ranked = list(range(len(options)))
    return normalize_action(ranked, select)


def agent(obs_dict: dict) -> list[int]:
    obs: Observation = to_observation_class(obs_dict)
    if obs.select is None:
        return read_deck_csv()
    return rule_based_agent(obs_dict)
