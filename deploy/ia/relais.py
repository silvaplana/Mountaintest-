"""
Relais IA des prototypes Assomountain (tourne sur le VPS, voir deploy/ia/README.md).

L'appli envoie une zone (ouest, sud, est, nord) ; le relais demande à Claude, avec la recherche web,
les randos décrites en ligne dans cette zone, et renvoie pour chacune un point de départ et le lien
de la page où elle a été trouvée. La clé API Anthropic reste ici, jamais dans l'APK.

Garde-fous :
- mot de passe (en-tête X-Mot-De-Passe) que Seb saisit une fois dans l'appli ;
- nombre de recherches par jour limité (RELAIS_MAX_PAR_JOUR), et cache 7 jours par zone ;
- on ne garde que les liens réellement renvoyés par la recherche web (pas de lien inventé)
  et les points situés dans la zone (agrandie de 20 %).
Coût : chaque recherche payante est notée dans /data/couts.jsonl (date, zone, jetons, coût en dollars) ;
la réponse donne son coût et les cumuls du mois et depuis le début, affichés dans l'appli.
"""
import hashlib
import hmac
import html
import urllib.parse
import urllib.request
import re
import smtplib
from email.mime.text import MIMEText
from email.utils import formataddr
import json
import os
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit

import anthropic

MODELE = os.environ.get("RELAIS_MODELE", "claude-opus-5-5")
MOT_DE_PASSE = os.environ.get("RELAIS_MOT_DE_PASSE", "")
MAX_PAR_JOUR = int(os.environ.get("RELAIS_MAX_PAR_JOUR", "40"))
DOSSIER = os.environ.get("RELAIS_DOSSIER", "/data")
CACHE_JOURS = 7
MAX_ZONE_DEG = 0.4

# Prix en dollars (tarif Anthropic, novembre 2026) : par million de jetons, et par recherche web.
# Si un autre modèle est choisi (RELAIS_MODELE), adapter ces prix.
PRIX = {"entree": 4.00, "sortie": 20.00, "cache_lecture": 0.20, "cache_ecriture": 5.00, "recherche_web": 0.01}

client = anthropic.Anthropic()  # lit ANTHROPIC_API_KEY
verrou = threading.Lock()

OUTIL_RESULTAT = {
    "name": "donner_les_randos",
    "description": "Renvoie la liste finale des randonnées trouvées dans la zone. À appeler une seule fois, à la fin.",
    "strict": True,
    "input_schema": {
        "type": "object",
        "properties": {
            "randos": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "nom": {"type": "string"},
                        "lat": {"type": "number", "description": "Latitude du point de départ (WGS84)"},
                        "lon": {"type": "number", "description": "Longitude du point de départ (WGS84)"},
                        "url": {"type": "string", "description": "Adresse exacte de la page trouvée par la recherche web"},
                        "site": {"type": "string", "description": "Nom du site (ex. Visorando, office de tourisme de …)"},
                        "distance_km": {"type": ["number", "null"]},
                        "denivele_m": {"type": ["number", "null"]},
                        "resume": {"type": "string", "description": "Une phrase : départ, difficulté, intérêt"},
                    },
                    "required": ["nom", "lat", "lon", "url", "site", "distance_km", "denivele_m", "resume"],
                    "additionalProperties": False,
                },
            }
        },
        "required": ["randos"],
        "additionalProperties": False,
    },
}

CONSIGNE = """Tu aides des randonneurs. On te donne une zone rectangulaire (coordonnées WGS84).
1. Repère les communes, massifs et sommets de cette zone.
2. Cherche sur le web les randonnées pédestres décrites en ligne dont le départ est dans la zone
   (sites de randonnée, offices de tourisme, parcs, départements, clubs). Vise 10 à 20 randos variées.
3. Pour chacune : le nom, le point de départ (coordonnées du parking ou du village de départ si la page
   ne les donne pas ; approximatif accepté, mais dans la zone), l'adresse exacte de la page trouvée,
   le site, la distance et le dénivelé si la page les donne (sinon null), et une phrase de résumé.
N'invente aucune rando ni aucune adresse : uniquement des pages vues dans tes résultats de recherche.
Termine en appelant l'outil donner_les_randos."""


def _norm(url: str) -> str:
    p = urlsplit(url.strip())
    return f"{p.netloc.lower().removeprefix('www.')}{p.path.rstrip('/')}"


def _urls_vues(blocs) -> set:
    vues = set()
    for b in blocs:
        t = getattr(b, "type", "")
        c = getattr(b, "content", None)
        if t == "web_search_tool_result" and isinstance(c, list):
            vues.update(_norm(r.url) for r in c if getattr(r, "url", None))
        elif t == "web_fetch_tool_result" and getattr(c, "url", None):
            vues.add(_norm(c.url))
    return vues


def chercher(zone: dict) -> dict:
    o, s, e, n = zone["ouest"], zone["sud"], zone["est"], zone["nord"]
    demande = (f"Zone : ouest {o:.5f}, sud {s:.5f}, est {e:.5f}, nord {n:.5f} "
               f"(centre {(s + n) / 2:.5f}, {(o + e) / 2:.5f}).")
    messages = [{"role": "user", "content": demande}]
    vues: set = set()
    randos = None
    cout = 0.0
    jetons = {"entree": 0, "sortie": 0, "recherches_web": 0}
    for _ in range(6):
        r = client.beta.messages.create(
            model=MODELE,
            max_tokens=16000,
            betas=["server-side-fallback-2026-07-01"],
            fallbacks="default",
            output_config={"effort": "medium"},
            system=CONSIGNE,
            tools=[
                {"type": "web_search_20260209", "name": "web_search", "max_uses": 6,
                 "user_location": {"type": "approximate", "country": "FR"}},
                {"type": "web_fetch_20260209", "name": "web_fetch", "max_uses": 4},
                OUTIL_RESULTAT,
            ],
            messages=messages,
        )
        vues |= _urls_vues(r.content)
        u = r.usage
        ent, sor = u.input_tokens or 0, u.output_tokens or 0
        lec, ecr = getattr(u, "cache_read_input_tokens", 0) or 0, getattr(u, "cache_creation_input_tokens", 0) or 0
        stu = getattr(u, "server_tool_use", None)
        rech = (getattr(stu, "web_search_requests", 0) or 0) if stu else 0
        cout += (ent * PRIX["entree"] + sor * PRIX["sortie"] + lec * PRIX["cache_lecture"] + ecr * PRIX["cache_ecriture"]) / 1e6 \
            + rech * PRIX["recherche_web"]
        jetons["entree"] += ent + lec + ecr; jetons["sortie"] += sor; jetons["recherches_web"] += rech
        appel = next((b for b in r.content if b.type == "tool_use" and b.name == OUTIL_RESULTAT["name"]), None)
        if appel:
            randos = appel.input.get("randos", [])
            break
        if r.stop_reason == "refusal":
            raise RuntimeError("Claude a refusé la demande")
        messages.append({"role": "assistant", "content": r.content})
        if r.stop_reason != "pause_turn":
            # Fin sans l'outil : on le redemande une fois.
            messages.append({"role": "user", "content": "Appelle maintenant l'outil donner_les_randos avec ce que tu as trouvé."})
    if randos is None:
        raise RuntimeError("pas de réponse exploitable")

    mx, my = (e - o) * 0.2, (n - s) * 0.2
    gardees, ecartees = [], 0
    for h in randos:
        url = str(h.get("url", ""))
        ok = (url.startswith(("http://", "https://")) and _norm(url) in vues
              and o - mx <= h["lon"] <= e + mx and s - my <= h["lat"] <= n + my)
        if ok:
            gardees.append(h)
        else:
            ecartees += 1
    return {"randos": gardees, "ecartees": ecartees, "modele": MODELE, "cout_usd": round(cout, 4), "jetons": jetons}


# ---------- Voyage en voiture : recherche du modèle, puis coût du trajet ----------

OUTIL_VOITURES = {
    "name": "donner_les_voitures",
    "description": "Renvoie les modèles de voiture correspondant à la recherche. À appeler une seule fois, à la fin.",
    "strict": True,
    "input_schema": {
        "type": "object",
        "properties": {
            "voitures": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "nom": {"type": "string", "description": "Marque, modèle, génération ou années, motorisation courante"},
                        "energies": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "energie": {"type": "string", "enum": ["essence", "diesel", "electrique", "hybride", "gpl"]},
                                    "conso": {"type": "number", "description": "Consommation mixte réelle moyenne"},
                                    "unite": {"type": "string", "enum": ["L/100 km", "kWh/100 km"]},
                                },
                                "required": ["energie", "conso", "unite"],
                                "additionalProperties": False,
                            },
                        },
                    },
                    "required": ["nom", "energies"],
                    "additionalProperties": False,
                },
            }
        },
        "required": ["voitures"],
        "additionalProperties": False,
    },
}

CONSIGNE_VOITURES = """On te donne ce qu'un conducteur a tapé pour décrire sa voiture (marque, modèle, parfois l'année ou le moteur),
n'importe où dans le monde. Propose 1 à 8 modèles qui correspondent, du plus probable au moins probable.
Pour chacun, les énergies disponibles et la consommation mixte réelle moyenne (pas la valeur d'homologation optimiste) :
L/100 km pour essence, diesel, hybride et GPL, kWh/100 km pour l'électrique. Cherche sur le web si tu as un doute.
Termine en appelant l'outil donner_les_voitures."""

OUTIL_COUT = {
    "name": "donner_le_cout",
    "description": "Renvoie le coût du trajet. À appeler une seule fois, à la fin.",
    "strict": True,
    "input_schema": {
        "type": "object",
        "properties": {
            "prix_unitaire": {"type": "number", "description": "Prix moyen actuel de l'énergie en France, en euros par litre ou par kWh"},
            "unite_prix": {"type": "string", "enum": ["€/L", "€/kWh"]},
            "cout_energie": {"type": "number", "description": "Euros d'énergie pour le trajet"},
            "peages": {"type": "number", "description": "Euros de péage, classe 1 (voiture), 0 si aucun"},
            "peages_detail": {"type": "string", "description": "Une phrase : quelles sections sont payantes, et combien"},
            "total": {"type": "number"},
            "explication": {"type": "string", "description": "Deux phrases au plus : hypothèses (prix, conso, péages)"},
        },
        "required": ["prix_unitaire", "unite_prix", "cout_energie", "peages", "peages_detail", "total", "explication"],
        "additionalProperties": False,
    },
}

CONSIGNE_COUT = """Tu chiffres un trajet en voiture en France pour un randonneur. On te donne le départ, l'arrivée, les kilomètres
déjà calculés par l'itinéraire IGN (ne les recalcule pas), la liste des autoroutes empruntées avec leurs kilomètres,
la voiture, l'énergie et la consommation aux 100 km.
1. Cherche sur le web le prix moyen actuel de cette énergie en France (carburant à la pompe, ou électricité pour une
   recharge : prends un mélange réaliste maison et borne rapide, dis-le).
2. Coût de l'énergie = km × conso / 100 × prix.
3. Péages, classe 1 : cherche les tarifs des sections d'autoroute réellement payantes entre ces points
   (certaines portions sont gratuites, notamment autour des grandes villes). 0 si aucune autoroute.
4. Total = énergie + péages. Arrondis à l'euro près pour les péages et le total, aux 10 centimes pour le prix unitaire.
Termine en appelant l'outil donner_le_cout."""


OUTIL_HEBERGEMENTS = {
    "name": "donner_les_hebergements",
    "description": "Renvoie les hébergements trouvés. À appeler une seule fois, à la fin.",
    "strict": True,
    "input_schema": {
        "type": "object",
        "properties": {
            "hebergements": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "nom": {"type": "string"},
                        "type": {"type": "string", "description": "hôtel, gîte, chambre d'hôtes, refuge, camping, appartement…"},
                        "prix_nuit": {"type": ["number", "null"], "description": "Prix indicatif pour la nuit et le groupe, en euros"},
                        "adresse": {"type": "string"},
                        "url": {"type": "string", "description": "Page de l'établissement ou de réservation, vue pendant la recherche"},
                        "resume": {"type": "string", "description": "Une phrase : points forts, capacité, pourquoi il convient"},
                    },
                    "required": ["nom", "type", "prix_nuit", "adresse", "url", "resume"],
                    "additionalProperties": False,
                },
            },
            "conseil": {"type": "string", "description": "Une phrase : disponibilité à vérifier, période chargée, etc."},
        },
        "required": ["hebergements", "conseil"],
        "additionalProperties": False,
    },
}

CONSIGNE_HEBERGEMENTS = """Tu aides un randonneur à trouver où dormir. On te donne une ville (ou un lieu), le nombre de personnes,
le prix maximum de la chambre par nuit et la date d'arrivée avec le nombre de nuits.
Cherche sur le web 3 à 8 hébergements réels dans ce lieu ou tout près (hôtels, gîtes, chambres d'hôtes, refuges…)
qui peuvent loger ce nombre de personnes sous ce prix. Donne pour chacun un lien vers une page réellement vue
(site de l'établissement de préférence, sinon une page de réservation). Tu ne peux pas vérifier les disponibilités en
temps réel : dis-le dans le conseil.
Cherche les meilleurs prix : compare plusieurs sources (site de l'établissement, Booking, Gîtes de France, Airbnb…)
et garde pour chacun le prix le plus bas trouvé. Si une liste « sites » est donnée, ne cherche et ne propose QUE des
hébergements trouvés sur ces sites. Classe la liste du moins cher au plus cher. Termine en appelant l'outil donner_les_hebergements."""


OUTIL_FACTURE = {
    "name": "donner_la_facture",
    "description": "Renvoie ce qui est lu sur la facture ou le ticket.",
    "strict": True,
    "input_schema": {
        "type": "object",
        "properties": {
            "titre": {"type": "string", "description": "Court : commerce ou nature de la dépense (ex. « Carrefour courses », « Gîte du Queyras »)"},
            "montant": {"type": ["number", "null"], "description": "Total TTC payé, en euros ; null si illisible"},
            "date": {"type": ["string", "null"], "description": "Date de la facture au format AAAA-MM-JJ, null si absente"},
        },
        "required": ["titre", "montant", "date"],
        "additionalProperties": False,
    },
}


def lire_facture(image_b64: str, media: str):
    """Une photo de facture → titre, montant, date (Claude, vision). Renvoie (résultat, coût, jetons)."""
    r = client.messages.create(
        model=MODELE, max_tokens=1000,
        tools=[OUTIL_FACTURE], tool_choice={"type": "tool", "name": OUTIL_FACTURE["name"]},
        messages=[{"role": "user", "content": [
            {"type": "image", "source": {"type": "base64", "media_type": media, "data": image_b64}},
            {"type": "text", "text": "Lis cette facture ou ce ticket de caisse : titre court, total payé TTC en euros, date."},
        ]}],
    )
    u = r.usage
    cout = ((u.input_tokens or 0) * PRIX["entree"] + (u.output_tokens or 0) * PRIX["sortie"]) / 1e6
    appel = next((b for b in r.content if b.type == "tool_use"), None)
    if not appel:
        raise RuntimeError("facture illisible")
    return appel.input, round(cout, 4), {"entree": u.input_tokens or 0, "sortie": u.output_tokens or 0, "recherches_web": 0}


# ---------- Sorties de ski de rando (API officielle skitour.fr, clé gardée ici) ----------
# Conditions : lien vers chaque sortie sur skitour.fr, pas de photos hors contexte ; 1000 requêtes / 24 h.

SKITOUR_CLE = os.environ.get("SKITOUR_CLE", "")


def _sorties_brutes(jours: int) -> list:
    """Toutes les sorties publiées ces derniers jours (format brut de l'API)."""
    # Le filtre « autour d'une position » de l'API (ll=lat,lon) répond en erreur 500 (constaté le 5 nov. 2026) :
    # on prend donc les sorties des derniers jours, par pages de 1000.
    data = []
    for page in range(1, 4):
        q = urllib.parse.urlencode({"j": jours, "c": 1, "l": 1000, "p": page})
        req = urllib.request.Request(f"https://skitour.fr/api/sorties?{q}", headers={"cle": SKITOUR_CLE, "User-Agent": "Assomoutain"})
        with urllib.request.urlopen(req, timeout=30) as r:
            lot = json.loads(r.read())
        if isinstance(lot, dict):
            raise RuntimeError(f"skitour : {lot.get('ERROR', 'erreur')}")
        data += lot
        if len(lot) < 1000:
            break
    return data


def _sommets(x) -> list:
    return [sm for sm in (x.get("sommets") or []) if _nombre(sm.get("lat")) is not None and _nombre(sm.get("lng")) is not None]


def _sortie(x, sm) -> dict:
    return {
        "id": _entier(x.get("id")), "titre": x.get("titre") or "", "date": _entier(x.get("date")),
        "massif": (x.get("massif") or {}).get("nom", ""),
        "sommet": sm.get("sommet") or "", "altitude": _entier(sm.get("altitude")),
        "lat": float(sm["lat"]), "lon": float(sm["lng"]),
        "denivele": _entier(x.get("denivele")), "dif_ski": x.get("dif_ski") or None, "orientation": x.get("orientation") or "",
        "conditions": _texte(x.get("cond"))[:400],
        "auteur": (x.get("auteur") or {}).get("pseudo", ""),
        "url": f"https://skitour.fr/sorties/{x.get('id')}",
    }


def sorties_skitour(o: float, s: float, e: float, n: float, jours: int) -> list:
    """Sorties des derniers jours dont un sommet est dans la zone."""
    out = []
    for x in _sorties_brutes(jours):
        # Format de l'API (vérifié le 5 nov. 2026) : tout est en chaînes ; un sommet = {"sommet", "altitude", "lat", "lng"},
        # la date est en secondes Unix, les conditions sont dans "cond" avec un peu de HTML (<br>, &nbsp;).
        dedans = [sm for sm in _sommets(x) if s <= float(sm["lat"]) <= n and o <= float(sm["lng"]) <= e]
        if dedans:
            out.append(_sortie(x, dedans[0]))
    return out


# ---------- Question en texte sur les sorties skitour (icône ⛷ 💬) ----------
# Claude reçoit la question, cherche lui-même dans les sorties récentes (outil chercher_sorties, exécuté ici,
# sans recherche web) puis répond en quelques phrases ; seuls les liens des sorties qu'il a vues sont gardés.

SKI_JOURS_MAX = 60
_ski_memo: dict = {}


def _sorties_recentes(jours: int) -> list:
    """Sorties des derniers jours au format de l'appli, une par sommet repéré ; gardées 1 h en mémoire."""
    c = _ski_memo.get(jours)
    if c and time.time() - c[0] < 3600:
        return c[1]
    out = []
    for x in _sorties_brutes(jours):
        pts = _sommets(x)
        if pts:
            o = _sortie(x, pts[0])
            o["autres_sommets"] = [sm.get("sommet") or "" for sm in pts[1:]]
            out.append(o)
    _ski_memo[jours] = (time.time(), out)
    return out


def _sans_accents(t: str) -> str:
    import unicodedata
    return "".join(ch for ch in unicodedata.normalize("NFD", t.lower()) if unicodedata.category(ch) != "Mn")


def chercher_sorties(sorties: list, mots: str = "", jours: int = 14, lat=None, lon=None, rayon_km: float = 25) -> list:
    """Les 25 sorties les plus pertinentes : mots trouvés dans titre / massif / sommets, ou autour d'un point."""
    import math
    depuis = time.time() - jours * 86400
    termes = [m for m in re.split(r"[^a-z0-9]+", _sans_accents(mots)) if len(m) > 2]
    notes = []
    for o in sorties:
        if (o["date"] or 0) < depuis:
            continue
        note = 0
        if termes:
            texte = _sans_accents(" ".join([o["titre"], o["massif"], o["sommet"], *o.get("autres_sommets", [])]))
            note = sum(1 for m in termes if m in texte)
            if not note:
                continue
        if lat is not None and lon is not None:
            d = math.hypot((o["lat"] - lat) * 111, (o["lon"] - lon) * 111 * math.cos(math.radians(lat)))
            if d > rayon_km:
                continue
        notes.append((note, o["date"] or 0, o))
    notes.sort(key=lambda t: (t[0], t[1]), reverse=True)
    return [o for _, _, o in notes[:25]]


OUTIL_SKI_CHERCHER = {
    "name": "chercher_sorties",
    "description": "Cherche dans les sorties de ski de rando publiées sur skitour.fr ces derniers jours. "
                   "Par mots (sommet, massif, col, vallée : ex. « Belledonne », « Grand Veymont ») et/ou autour d'un point. "
                   "Renvoie au plus 25 sorties, les plus récentes et pertinentes d'abord. Peut être appelé plusieurs fois.",
    "input_schema": {
        "type": "object",
        "properties": {
            "mots": {"type": "string", "description": "Noms à chercher (vide pour tout prendre autour du point)."},
            "jours": {"type": "integer", "description": f"Sorties des N derniers jours (1 à {SKI_JOURS_MAX}, 14 par défaut)."},
            "lat": {"type": "number"}, "lon": {"type": "number"},
            "rayon_km": {"type": "number", "description": "Rayon autour du point (25 km par défaut)."},
        },
    },
}
OUTIL_SKI_REPONSE = {
    "name": "repondre",
    "description": "Donne la réponse finale à l'utilisateur. À appeler une seule fois, à la fin.",
    "input_schema": {
        "type": "object",
        "properties": {
            "texte": {"type": "string", "description": "Réponse en français simple, quelques phrases ou une courte liste, sans Markdown."},
            "sorties": {"type": "array", "items": {"type": "integer"}, "description": "Identifiants des sorties citées (8 au plus)."},
        },
        "required": ["texte", "sorties"],
    },
}
CONSIGNE_SKI = """Tu aides un skieur de randonnée (association de montagne, France). Il pose une question en texte libre sur
les sorties publiées sur skitour.fr : conditions de neige, sommets faits récemment, idées de sortie, etc.
Utilise l'outil chercher_sorties (plusieurs fois si utile : autre orthographe, massif voisin, période plus longue).
Base-toi uniquement sur ce que l'outil renvoie ; si rien ne correspond, dis-le simplement. Donne les dates
(« le 3 novembre »), les sommets, les conditions décrites et qui les décrit. Pas de conseil de sécurité inventé :
rappelle seulement, si la question touche au risque, de consulter le bulletin d'avalanche (BERA).
Termine en appelant l'outil repondre. Aujourd'hui : {date}.{position}"""


def repondre_ski(question: str, lat=None, lon=None) -> dict:
    sorties = _sorties_recentes(SKI_JOURS_MAX)
    par_id = {o["id"]: o for o in sorties}
    vues: set = set()
    position = f" Position de la carte de l'utilisateur : lat {lat:.4f}, lon {lon:.4f}." if lat is not None and lon is not None else ""
    systeme = CONSIGNE_SKI.format(date=time.strftime("%d/%m/%Y"), position=position)
    messages = [{"role": "user", "content": question}]
    cout, jetons = 0.0, {"entree": 0, "sortie": 0, "recherches_web": 0}
    for _ in range(6):
        r = client.beta.messages.create(
            model=MODELE, max_tokens=3000,
            betas=["server-side-fallback-2026-07-01"], fallbacks="default",
            output_config={"effort": "low"},
            system=systeme, tools=[OUTIL_SKI_CHERCHER, OUTIL_SKI_REPONSE], messages=messages,
        )
        u = r.usage
        ent, sor = u.input_tokens or 0, u.output_tokens or 0
        lec, ecr = getattr(u, "cache_read_input_tokens", 0) or 0, getattr(u, "cache_creation_input_tokens", 0) or 0
        cout += (ent * PRIX["entree"] + sor * PRIX["sortie"] + lec * PRIX["cache_lecture"] + ecr * PRIX["cache_ecriture"]) / 1e6
        jetons["entree"] += ent + lec + ecr; jetons["sortie"] += sor
        fin = next((b for b in r.content if b.type == "tool_use" and b.name == "repondre"), None)
        if fin:
            ids = [i for i in (fin.input.get("sorties") or []) if i in vues][:8]
            return {"texte": str(fin.input.get("texte", "")).strip(), "sorties": [par_id[i] for i in ids],
                    "cout_usd": round(cout, 4), "jetons": jetons}
        if r.stop_reason == "refusal":
            raise RuntimeError("Claude a refusé la demande")
        appels = [b for b in r.content if b.type == "tool_use" and b.name == "chercher_sorties"]
        messages.append({"role": "assistant", "content": r.content})
        if not appels:
            messages.append({"role": "user", "content": "Appelle maintenant l'outil repondre."})
            continue
        resultats = []
        for b in appels:
            a = b.input or {}
            trouve = chercher_sorties(sorties, str(a.get("mots", ""))[:200], max(1, min(int(a.get("jours", 14) or 14), SKI_JOURS_MAX)),
                                      _nombre(a.get("lat")), _nombre(a.get("lon")), max(1.0, min(_nombre(a.get("rayon_km")) or 25, 150)))
            vues.update(o["id"] for o in trouve)
            compact = [{"id": o["id"], "date": time.strftime("%d/%m/%Y", time.localtime(o["date"] or 0)), "titre": o["titre"],
                        "massif": o["massif"], "sommet": o["sommet"], "altitude": o["altitude"], "denivele": o["denivele"],
                        "ski": o["dif_ski"], "orientation": o["orientation"], "auteur": o["auteur"], "conditions": o["conditions"]}
                       for o in trouve]
            resultats.append({"type": "tool_result", "tool_use_id": b.id, "content": json.dumps(compact, ensure_ascii=False)})
        messages.append({"role": "user", "content": resultats})
    raise RuntimeError("pas de réponse exploitable")


def _nombre(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _entier(v):
    n = _nombre(v)
    return int(n) if n is not None else None


def _texte(v) -> str:
    """Texte brut d'un champ HTML de skitour (sauts de ligne gardés, balises et entités retirées)."""
    t = re.sub(r"<br\s*/?>", "\n", str(v or ""), flags=re.I)
    t = re.sub(r"<[^>]+>", "", t)
    return html.unescape(t).strip()


def appeler(consigne: str, demande: str, outil: dict, recherches: int = 4, domaines: list | None = None):
    """Un échange avec Claude (recherche web permise) jusqu'à l'appel de l'outil final. Renvoie (entrée de l'outil, coût, jetons)."""
    messages = [{"role": "user", "content": demande}]
    cout, jetons = 0.0, {"entree": 0, "sortie": 0, "recherches_web": 0}
    for _ in range(5):
        r = client.beta.messages.create(
            model=MODELE, max_tokens=8000,
            betas=["server-side-fallback-2026-07-01"], fallbacks="default",
            output_config={"effort": "low"},
            system=consigne,
            tools=[{"type": "web_search_20260209", "name": "web_search", "max_uses": recherches,
                    "user_location": {"type": "approximate", "country": "FR"},
                    **({"allowed_domains": domaines} if domaines else {})}, outil],
            messages=messages,
        )
        u = r.usage
        ent, sor = u.input_tokens or 0, u.output_tokens or 0
        lec, ecr = getattr(u, "cache_read_input_tokens", 0) or 0, getattr(u, "cache_creation_input_tokens", 0) or 0
        stu = getattr(u, "server_tool_use", None)
        rech = (getattr(stu, "web_search_requests", 0) or 0) if stu else 0
        cout += (ent * PRIX["entree"] + sor * PRIX["sortie"] + lec * PRIX["cache_lecture"] + ecr * PRIX["cache_ecriture"]) / 1e6 \
            + rech * PRIX["recherche_web"]
        jetons["entree"] += ent + lec + ecr; jetons["sortie"] += sor; jetons["recherches_web"] += rech
        appel = next((b for b in r.content if b.type == "tool_use" and b.name == outil["name"]), None)
        if appel:
            return appel.input, round(cout, 4), jetons
        if r.stop_reason == "refusal":
            raise RuntimeError("Claude a refusé la demande")
        messages.append({"role": "assistant", "content": r.content})
        if r.stop_reason != "pause_turn":
            messages.append({"role": "user", "content": f"Appelle maintenant l'outil {outil['name']}."})
    raise RuntimeError("pas de réponse exploitable")


def lire_voyage(d: dict) -> dict:
    """Valide et borne la demande de coût (texte court, nombres raisonnables)."""
    t = lambda k, n=120: str(d.get(k, ""))[:n]
    autoroutes = [{"numero": str(a.get("numero", ""))[:12], "km": float(a.get("km", 0))}
                  for a in (d.get("autoroutes") or [])[:20] if isinstance(a, dict)]
    v = {"depart": t("depart"), "arrivee": t("arrivee"), "km": float(d["km"]), "duree_min": float(d.get("duree_min", 0)),
         "autoroutes": autoroutes, "voiture": t("voiture"), "energie": t("energie", 20),
         "conso": float(d["conso"]), "unite": t("unite", 12)}
    if not (0 < v["km"] < 5000 and 0 < v["conso"] < 100):
        raise ValueError("valeurs hors limites")
    return v


# ---------- Invitation par e-mail (partage des frais) ----------
# Même envoi que contretemps : SMTP de Brevo, variables SMTP_* copiées dans ia.env (deploy/ia/activer-mail.sh).

LIEN_APK = "https://silvaplana.cloud/mountaintest/apk/"
SMTP = {k: os.environ.get(k, "") for k in ("SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASSWORD", "SMTP_FROM_EMAIL", "SMTP_REPLY_TO")}
MAIL_ACTIF = bool(SMTP["SMTP_HOST"] and SMTP["SMTP_USER"] and SMTP["SMTP_PASSWORD"])
MAX_MAILS_PAR_JOUR = 30


def envoyer_invitation(email: str, nom: str, groupe: str, de: str) -> None:
    corps = (f"Bonjour {nom},\n\n{de or 'Un ami'} t'invite à partager les frais du groupe « {groupe} » "
             f"dans l'appli de randonnée Assomoutain.\n\n"
             f"Pour l'installer sur un téléphone Android : {LIEN_APK}\n"
             f"(choisis l'une des deux versions, puis autorise l'installation quand le téléphone le demande).\n\n"
             f"À bientôt sur les sentiers !")
    m = MIMEText(corps, "plain", "utf-8")
    m["Subject"] = f"{de or 'Un ami'} t'invite : partage des frais « {groupe} »"
    m["From"] = formataddr(("Assomoutain", SMTP["SMTP_FROM_EMAIL"] or SMTP["SMTP_USER"]))
    m["To"] = email
    if SMTP["SMTP_REPLY_TO"]:
        m["Reply-To"] = SMTP["SMTP_REPLY_TO"]
    with smtplib.SMTP(SMTP["SMTP_HOST"], int(SMTP["SMTP_PORT"] or 587), timeout=20) as s:
        s.starttls()
        s.login(SMTP["SMTP_USER"], SMTP["SMTP_PASSWORD"])
        s.send_message(m)


# ---------- Cache et quota ----------

def _fichier(nom):
    os.makedirs(DOSSIER, exist_ok=True)
    return os.path.join(DOSSIER, nom)


def _lire(nom, defaut):
    try:
        with open(_fichier(nom)) as f:
            return json.load(f)
    except (OSError, ValueError):
        return defaut


def _ecrire(nom, valeur):
    tmp = _fichier(nom + ".tmp")
    with open(tmp, "w") as f:
        json.dump(valeur, f)
    os.replace(tmp, _fichier(nom))


def noter_cout(z, r):
    """Une ligne par recherche payante dans couts.jsonl (journal), et renvoie les cumuls (mois, total)."""
    ligne = {"date": time.strftime("%Y-%m-%d %H:%M:%S"), "zone": [z[k] for k in ("ouest", "sud", "est", "nord")],
             "randos": len(r["randos"]), "cout_usd": r["cout_usd"], **r["jetons"]}
    with open(_fichier("couts.jsonl"), "a") as f:
        f.write(json.dumps(ligne) + "\n")
    return cumuls()


def cumuls():
    mois, total, n = time.strftime("%Y-%m"), 0.0, 0
    du_mois = 0.0
    try:
        with open(_fichier("couts.jsonl")) as f:
            for l in f:
                try:
                    c = json.loads(l)
                except ValueError:
                    continue
                total += c.get("cout_usd", 0); n += 1
                if c.get("date", "").startswith(mois):
                    du_mois += c.get("cout_usd", 0)
    except OSError:
        pass
    return {"cumul_mois_usd": round(du_mois, 4), "cumul_total_usd": round(total, 4), "recherches_payantes": n}


def cle_zone(z):
    # Zones arrondies au centième de degré (~1 km) : un cadre presque identique réutilise la réponse.
    return hashlib.sha1(json.dumps([round(z[k], 2) for k in ("ouest", "sud", "est", "nord")]).encode()).hexdigest()


class Relais(BaseHTTPRequestHandler):
    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, X-Mot-De-Passe")

    def _json(self, code, obj):
        data = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(code)
        self._cors()
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self):
        # Page d'état : modèle et cumul des coûts (aucune donnée sensible).
        self._json(200, {"ok": True, "modele": MODELE, "routes": ["randos", "voiture", "voyage", "invitation", "hebergement", "facture", "skitour", "skitour-texte"], "skitour": bool(SKITOUR_CLE), "mail": MAIL_ACTIF, **cumuls()})

    def do_POST(self):
        chemin = self.path.rstrip("/")
        if not chemin.endswith(("/randos", "/voiture", "/voyage", "/invitation", "/hebergement", "/facture", "/skitour", "/skitour-texte")):
            return self._json(404, {"erreur": "inconnu"})
        if not MOT_DE_PASSE or not hmac.compare_digest(self.headers.get("X-Mot-De-Passe", ""), MOT_DE_PASSE):
            return self._json(401, {"erreur": "Mot de passe IA incorrect"})
        if chemin.endswith("/invitation"):
            return self._invitation()
        if chemin.endswith("/facture"):
            return self._facture()
        if chemin.endswith("/skitour"):
            return self._skitour()
        if chemin.endswith("/skitour-texte"):
            return self._skitour_texte()
        if chemin.endswith(("/voiture", "/voyage", "/hebergement")):
            return self._voyage(chemin.rsplit("/", 1)[1])
        try:
            z = json.loads(self.rfile.read(min(int(self.headers.get("Content-Length", 0)), 10_000)))
            z = {k: float(z[k]) for k in ("ouest", "sud", "est", "nord")}
        except (ValueError, KeyError, TypeError):
            return self._json(400, {"erreur": "zone invalide"})
        if not (z["ouest"] < z["est"] and z["sud"] < z["nord"]) or z["est"] - z["ouest"] > MAX_ZONE_DEG or z["nord"] - z["sud"] > MAX_ZONE_DEG:
            return self._json(400, {"erreur": "zone trop grande ou invalide"})

        cle = cle_zone(z)
        jour = time.strftime("%Y-%m-%d")
        with verrou:
            cache = _lire("cache.json", {})
            c = cache.get(cle)
            if c and time.time() - c["t"] < CACHE_JOURS * 86400:
                return self._json(200, {**c["r"], "cache": True, "cout_usd": 0, **cumuls()})
            quota = _lire("quota.json", {})
            if quota.get(jour, 0) >= MAX_PAR_JOUR:
                return self._json(429, {"erreur": f"Limite de {MAX_PAR_JOUR} recherches par jour atteinte"})
            _ecrire("quota.json", {jour: quota.get(jour, 0) + 1})
        try:
            t0 = time.time()
            r = chercher(z)
            r["secondes"] = round(time.time() - t0)
        except anthropic.APIError as e:
            return self._json(502, {"erreur": f"Claude : {getattr(e, 'message', e)}"})
        except Exception as e:  # noqa: BLE001 - on renvoie l'erreur à l'appli
            return self._json(502, {"erreur": str(e)})
        with verrou:
            cache = _lire("cache.json", {})
            cache = {k: v for k, v in cache.items() if time.time() - v["t"] < CACHE_JOURS * 86400}
            cache[cle] = {"t": time.time(), "r": r}
            _ecrire("cache.json", cache)
            totaux = noter_cout(z, r)
        print(f"{jour} zone {cle[:8]} : {len(r['randos'])} randos ({r['ecartees']} écartées), {r['secondes']} s, "
              f"{r['cout_usd']:.3f} $ (cumul {totaux['cumul_total_usd']:.2f} $)", flush=True)
        self._json(200, {**r, **totaux})


    def _skitour(self):
        if not SKITOUR_CLE:
            return self._json(503, {"erreur": "clé skitour pas encore installée sur le serveur"})
        try:
            d = json.loads(self.rfile.read(min(int(self.headers.get("Content-Length", 0)), 2_000)))
            o, s, e, n = (float(d[k]) for k in ("ouest", "sud", "est", "nord"))
            jours = max(1, min(int(d.get("jours", 30)), 400))
            if not (o < e and s < n and e - o <= 2 and n - s <= 2):
                raise ValueError
        except (ValueError, KeyError, TypeError):
            return self._json(400, {"erreur": "zone invalide (2° au plus)"})
        cle = f"skitour:{o:.3f},{s:.3f},{e:.3f},{n:.3f},{jours}"
        with verrou:
            cache = _lire("cache-skitour.json", {})
            c = cache.get(cle)
            if c and time.time() - c["t"] < 3600:
                return self._json(200, {"sorties": c["r"], "cache": True})
        try:
            r = sorties_skitour(o, s, e, n, jours)
        except Exception as ex:  # noqa: BLE001
            return self._json(502, {"erreur": str(ex)})
        with verrou:
            cache = {k: x for k, x in _lire("cache-skitour.json", {}).items() if time.time() - x["t"] < 3600}
            cache[cle] = {"t": time.time(), "r": r}
            _ecrire("cache-skitour.json", cache)
        self._json(200, {"sorties": r})

    def _skitour_texte(self):
        if not SKITOUR_CLE:
            return self._json(503, {"erreur": "clé skitour pas encore installée sur le serveur"})
        try:
            d = json.loads(self.rfile.read(min(int(self.headers.get("Content-Length", 0)), 4_000)))
            question = str(d["question"]).strip()[:500]
            lat, lon = _nombre(d.get("lat")), _nombre(d.get("lon"))
            if len(question) < 3:
                raise ValueError
        except (ValueError, KeyError, TypeError):
            return self._json(400, {"erreur": "question vide"})
        jour = time.strftime("%Y-%m-%d")
        with verrou:
            quota = _lire("quota.json", {})
            if quota.get(jour, 0) >= MAX_PAR_JOUR:
                return self._json(429, {"erreur": f"Limite de {MAX_PAR_JOUR} demandes par jour atteinte"})
            _ecrire("quota.json", {jour: quota.get(jour, 0) + 1})
        try:
            r = repondre_ski(question, lat, lon)
        except anthropic.APIError as e:
            return self._json(502, {"erreur": f"Claude : {getattr(e, 'message', e)}"})
        except Exception as e:  # noqa: BLE001
            return self._json(502, {"erreur": str(e)})
        with verrou:
            with open(_fichier("couts.jsonl"), "a") as f:
                f.write(json.dumps({"date": time.strftime("%Y-%m-%d %H:%M:%S"), "type": "skitour-texte",
                                    "cout_usd": r["cout_usd"], **r["jetons"]}) + "\n")
        self._json(200, {**r, **cumuls()})

    def _facture(self):
        try:
            n = int(self.headers.get("Content-Length", 0))
            if n > 8_000_000:
                return self._json(413, {"erreur": "photo trop lourde"})
            d = json.loads(self.rfile.read(n))
            img = str(d["image"])
            media = str(d.get("type", "image/jpeg"))
            if media not in ("image/jpeg", "image/png", "image/webp") or len(img) < 100:
                raise ValueError
        except (ValueError, KeyError, TypeError):
            return self._json(400, {"erreur": "photo invalide"})
        jour = time.strftime("%Y-%m-%d")
        with verrou:
            quota = _lire("quota.json", {})
            if quota.get(jour, 0) >= MAX_PAR_JOUR:
                return self._json(429, {"erreur": f"Limite de {MAX_PAR_JOUR} demandes par jour atteinte"})
            _ecrire("quota.json", {jour: quota.get(jour, 0) + 1})
        try:
            r, cout, jetons = lire_facture(img, media)
        except anthropic.APIError as e:
            return self._json(502, {"erreur": f"Claude : {getattr(e, 'message', e)}"})
        except Exception as e:  # noqa: BLE001
            return self._json(502, {"erreur": str(e)})
        with verrou:
            with open(_fichier("couts.jsonl"), "a") as f:
                f.write(json.dumps({"date": time.strftime("%Y-%m-%d %H:%M:%S"), "type": "facture", "cout_usd": cout, **jetons}) + "\n")
        self._json(200, {**r, "cout_usd": cout, **cumuls()})

    def _invitation(self):
        if not MAIL_ACTIF:
            return self._json(503, {"erreur": "envoi de mail pas encore activé sur le serveur"})
        try:
            d = json.loads(self.rfile.read(min(int(self.headers.get("Content-Length", 0)), 5_000)))
            email = str(d["email"]).strip()[:120]
            if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email):
                raise ValueError
            nom, groupe, de = (" ".join(str(d.get(k, "")).split())[:60] for k in ("nom", "groupe", "de"))
        except (ValueError, KeyError, TypeError):
            return self._json(400, {"erreur": "adresse e-mail invalide"})
        jour = time.strftime("%Y-%m-%d")
        with verrou:
            q = _lire("mails.json", {})
            if q.get(jour, 0) >= MAX_MAILS_PAR_JOUR:
                return self._json(429, {"erreur": f"Limite de {MAX_MAILS_PAR_JOUR} invitations par jour atteinte"})
            _ecrire("mails.json", {jour: q.get(jour, 0) + 1})
        try:
            envoyer_invitation(email, nom, groupe, de)
        except Exception as e:  # noqa: BLE001
            return self._json(502, {"erreur": f"envoi impossible : {e}"})
        print(f"{jour} invitation envoyée", flush=True)
        self._json(200, {"ok": True})

    def _voyage(self, quoi):
        """/voiture : modèles et consommations d'après le texte tapé ; /voyage : coût d'un trajet (énergie + péages)."""
        try:
            d = json.loads(self.rfile.read(min(int(self.headers.get("Content-Length", 0)), 20_000)))
            if quoi == "voiture":
                q = " ".join(str(d["recherche"]).split())[:80]
                if len(q) < 2:
                    raise ValueError
                cle, demande = "voiture:" + q.lower(), f"Voiture tapée : « {q} »"
                consigne, outil, rech, garde = CONSIGNE_VOITURES, OUTIL_VOITURES, 2, 30
            elif quoi == "hebergement":
                v = {"ville": " ".join(str(d["ville"]).split())[:80], "personnes": int(d["personnes"]),
                     "prix_max_nuit": float(d["prix_max"]), "arrivee": str(d.get("arrivee", ""))[:10], "nuits": int(d.get("nuits", 1)),
                     # Sites cochés dans l'appli : la recherche web ne regarde qu'eux (vide : tout le web).
                     "sites": sorted({str(x).lower().strip().removeprefix("https://").removeprefix("http://").removeprefix("www.").strip("/")
                                      for x in (d.get("sites") or [])[:10]})}
                if any(not re.fullmatch(r"[a-z0-9-]+(\.[a-z0-9-]+)+", x) for x in v["sites"]):
                    raise ValueError
                if len(v["ville"]) < 2 or not (1 <= v["personnes"] <= 30 and 0 < v["prix_max_nuit"] < 5000 and 1 <= v["nuits"] <= 30):
                    raise ValueError
                cle = "hebergement:" + hashlib.sha1(json.dumps(v, sort_keys=True).encode()).hexdigest()
                demande = json.dumps(v, ensure_ascii=False)
                consigne, outil, rech, garde = CONSIGNE_HEBERGEMENTS, OUTIL_HEBERGEMENTS, 8, 1
            else:
                v = lire_voyage(d)
                cle = "voyage:" + hashlib.sha1(json.dumps(v, sort_keys=True).encode()).hexdigest()
                demande = json.dumps(v, ensure_ascii=False)
                consigne, outil, rech, garde = CONSIGNE_COUT, OUTIL_COUT, 5, 1
        except (ValueError, KeyError, TypeError):
            return self._json(400, {"erreur": "demande invalide"})
        jour = time.strftime("%Y-%m-%d")
        with verrou:
            cache = _lire("cache-voyage.json", {})
            c = cache.get(cle)
            if c and time.time() - c["t"] < garde * 86400:
                return self._json(200, {**c["r"], "cache": True, "cout_usd": 0, **cumuls()})
            quota = _lire("quota.json", {})
            if quota.get(jour, 0) >= MAX_PAR_JOUR:
                return self._json(429, {"erreur": f"Limite de {MAX_PAR_JOUR} demandes par jour atteinte"})
            _ecrire("quota.json", {jour: quota.get(jour, 0) + 1})
        try:
            r, cout, jetons = appeler(consigne, demande, outil, rech, (v.get("sites") or None) if quoi == "hebergement" else None)
        except anthropic.APIError as e:
            return self._json(502, {"erreur": f"Claude : {getattr(e, 'message', e)}"})
        except Exception as e:  # noqa: BLE001 - on renvoie l'erreur à l'appli
            return self._json(502, {"erreur": str(e)})
        r = {**r, "modele": MODELE, "cout_usd": cout}
        with verrou:
            cache = _lire("cache-voyage.json", {})
            cache = {k: x for k, x in cache.items() if time.time() - x["t"] < 30 * 86400}
            cache[cle] = {"t": time.time(), "r": r}
            _ecrire("cache-voyage.json", cache)
            ligne = {"date": time.strftime("%Y-%m-%d %H:%M:%S"), "type": quoi, "cout_usd": cout, **jetons}
            with open(_fichier("couts.jsonl"), "a") as f:
                f.write(json.dumps(ligne) + "\n")
        print(f"{jour} {quoi} : {cout:.3f} $", flush=True)
        self._json(200, {**r, **cumuls()})


if __name__ == "__main__":
    print(f"Relais IA prêt (modèle {MODELE}, {MAX_PAR_JOUR} recherches par jour)", flush=True)
    ThreadingHTTPServer(("0.0.0.0", 8080), Relais).serve_forever()
