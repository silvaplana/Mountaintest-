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
import sys
import traceback
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


# Champs vus dans les sorties de l'API (affichés par GET /mountaintest-ia/ : la doc de l'API n'est pas à jour).
CHAMPS_VUS: set = set()


def _d(v) -> dict:
    """Le champ s'il est un objet, sinon {} : l'API skitour donne parfois une simple chaîne (ou une liste) à la place."""
    return v if isinstance(v, dict) else {}


def _pseudo(v) -> str:
    """Pseudo d'un auteur, donné par l'API comme objet {"pseudo": …} ou directement comme chaîne."""
    return str(v).strip() if isinstance(v, (str, int)) else str(_d(v).get("pseudo") or "")


def _etoiles(x):
    """Étoiles de la sortie si l'API les donne (nom du champ non documenté : on essaie les plus probables)."""
    for k in ("etoiles", "note", "stars", "interet", "qualite"):
        n = _entier(x.get(k))
        if n is not None and 0 <= n <= 5:
            return n
    return None


# L'API ne donne ni les étoiles de la sortie, ni le mot de la skiabilité (seulement un chiffre) :
# on les lit sur la page skitour.fr de la sortie (« ⭐⭐ » dans le titre, « Skiabilité : 🙂 Bonne »), gardés 1 jour.
_PAGES: dict = {}
SKIAB_NOMS: dict = {}  # chiffre de l'API -> « 🙂 Bonne », appris sur les pages lues


def _page_sortie(id_: int) -> dict:
    c = _PAGES.get(id_)
    if c and time.time() - c[0] < 86400 and "liens" in c[1]:
        return c[1]
    req = urllib.request.Request(f"https://skitour.fr/sorties/{id_}", headers={"User-Agent": "Assomoutain"})
    with urllib.request.urlopen(req, timeout=10) as r:
        page = r.read(600_000).decode("utf-8", "replace")
    titre = re.search(r"<h1.*?</h1>", page, re.S | re.I)
    zone = titre.group(0) if titre else page[:page.find("Skiabilit")] if "Skiabilit" in page else ""
    texte = html.unescape(re.sub(r"<[^>]+>", "\n", page))
    m = re.search(r"Skiabilit[ée]\s*:\s*([^\w\s]{1,4})?\s*([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ' -]{1,24}?)\s*(?:\n|  |$)", texte)
    dep = re.search(r"D[ée]part\s*:\s*([^\n(]{2,60}?)\s*(?:\((\d{3,4})\s*m\))?\s*\n", texte)
    # Liens de la page vers le départ, les topos et les sommets (pour les suivre depuis l'appli, comme sur le site).
    liens = []
    for m2 in re.finditer(r'href="(?:https://skitour\.fr)?/(departs|topos|sommets)/(\d+)[^"]*"[^>]*>(.*?)</a>', page, re.S | re.I):
        nom = html.unescape(re.sub(r"<[^>]+>", "", m2.group(3))).strip()
        if nom and not any(l["type"] == m2.group(1) and l["id"] == int(m2.group(2)) for l in liens):
            liens.append({"type": m2.group(1), "id": int(m2.group(2)), "nom": nom, "url": f"https://skitour.fr/{m2.group(1)}/{m2.group(2)}"})
    # Mieux : le lien vers la page du départ, « Val Thorens (2300 m) ».
    lien_dep = next((l["nom"] for l in liens if l["type"] == "departs"), "")
    if lien_dep:
        m3 = re.match(r"(.+?)\s*(?:\((\d{3,4})\s*m\))?$", lien_dep)
        dep = m3 if m3 else dep
    expo = re.search(r"Exposition\s*:?\s*\n*\s*(\d)", texte)
    # Texte « Conditions nivologiques, accès & météo » (secours si l'API ne donne pas la fiche).
    cond = re.search(r"Conditions\s+nivologiques[^\n]*\n(.*?)\n\s*Skiabilit", texte, re.S)
    cond_txt = re.sub(r"\n\s*\n+", "\n", cond.group(1)).strip()[:4000] if cond else ""
    out = {"liens": liens, "conditions": cond_txt, "exposition": expo.group(1) if expo else "",
           "etoiles": zone.count("star1."), "skiabilite": " ".join(x for x in (m.group(1), m.group(2).strip()) if x) if m else "",
           "depart": dep.group(1).strip() if dep else "", "depart_alt": int(dep.group(2)) if dep and dep.group(2) else None}
    _PAGES[id_] = (time.time(), out)
    return out


def _completer(lignes: list, maxi: int = 60) -> list:
    """Ajoute étoiles et skiabilité en mots (lus sur les pages skitour.fr) aux sorties, en copie."""
    from concurrent.futures import ThreadPoolExecutor
    a_lire = [o["id"] for o in lignes if o.get("id") and o["id"] not in _PAGES][:maxi]

    def lire(i):
        try:
            _page_sortie(i)
        except Exception:  # noqa: BLE001 (page absente : on garde ce que donne l'API)
            pass
    if a_lire:
        with ThreadPoolExecutor(6) as ex:
            list(ex.map(lire, a_lire))
    out = []
    for o in lignes:
        o = dict(o)
        p = (_PAGES.get(o.get("id")) or (0, None))[1]
        num = o.get("skiabilite") or ""
        if p and o.get("parking"):
            # Nom et altitude du parking : pris sur la page skitour.fr si l'API ne les donne pas.
            pk = dict(o["parking"])
            pk["nom"] = pk.get("nom") or p.get("depart", "")
            pk["altitude"] = pk.get("altitude") or p.get("depart_alt")
            o["parking"] = pk
        if p:
            if o.get("etoiles") is None:
                o["etoiles"] = p["etoiles"]
            if p["skiabilite"]:
                if num.isdigit():
                    SKIAB_NOMS[num] = p["skiabilite"]
                o["skiabilite"] = p["skiabilite"]
        if (o.get("skiabilite") or "").isdigit() and o["skiabilite"] in SKIAB_NOMS:
            o["skiabilite"] = SKIAB_NOMS[o["skiabilite"]]
        out.append(o)
    return out


CHAMPS_DEPART: set = set()  # champs vus dans le « depart » de l'API (affichés par GET /mountaintest-ia/)


def _parking(x) -> dict | None:
    """Point de départ (parking) d'une sortie : {nom, altitude, lat, lon}, ou None si l'API ne le place pas."""
    d = x.get("depart") if isinstance(x.get("depart"), dict) else {}
    CHAMPS_DEPART.update(d.keys())
    lat, lon = _nombre(d.get("lat")), _nombre(d.get("lng") if d.get("lng") is not None else d.get("lon"))
    if (lat is None or lon is None) and isinstance(d.get("latlon"), str) and "," in d["latlon"]:
        lat, lon = (_nombre(v) for v in d["latlon"].split(",")[:2])
    if lat is None or lon is None or (lat == 0 and lon == 0):
        return None
    nom = next((str(d[k]).strip() for k in ("nom", "lieu", "depart", "titre", "libelle", "name") if isinstance(d.get(k), str) and d[k].strip()), "")
    alt = next((_entier(d[k]) for k in ("altitude", "alt", "altitude_depart") if _entier(d.get(k))), None)
    return {"nom": html.unescape(nom), "altitude": alt, "lat": lat, "lon": lon}


def _avec_parkings(lignes: list, maxi: int = 30) -> list:
    """Ajoute le parking aux sorties qui n'en ont pas (la liste de l'API ne le donne pas toujours) :
    lu dans la fiche de la sortie, gardé pour toujours (un départ ne bouge pas)."""
    with verrou:
        connus = _lire("cache-skitour-departs2.json", {})
    nouveaux = {}
    for o in lignes:
        k = str(o.get("id"))
        if o.get("parking") or not o.get("id"):
            continue
        if k not in connus and len(nouveaux) < maxi:
            try:
                req = urllib.request.Request(f"https://skitour.fr/api/sortie/{o['id']}", headers={"cle": SKITOUR_CLE, "User-Agent": "Assomoutain"})
                with urllib.request.urlopen(req, timeout=15) as r:
                    x = json.loads(r.read())
                x = (x[0] if x else {}) if isinstance(x, list) else x
                nouveaux[k] = _parking(x) if isinstance(x, dict) and not x.get("ERROR") else None
            except Exception:  # noqa: BLE001 (sans parking, la sortie s'affiche quand même)
                continue
        o["parking"] = nouveaux.get(k, connus.get(k))
    if nouveaux:
        with verrou:
            connus = _lire("cache-skitour-departs2.json", {})
            connus.update(nouveaux)
            _ecrire("cache-skitour-departs2.json", connus)
    return lignes


def _sorties_brutes(jours: int, massif: int | None = None, pages: int = 3) -> list:
    """Sorties publiées ces derniers jours (format brut de l'API), toutes ou d'un massif."""
    # Le filtre « autour d'une position » de l'API (ll=lat,lon) répond en erreur 500 (constaté le 5 nov. 2026) :
    # on prend donc les sorties des derniers jours, par pages de 1000.
    data = []
    for page in range(1, pages + 1):
        q = urllib.parse.urlencode({"j": jours, "c": 1, "l": 1000, "p": page, **({"m": massif} if massif else {})})
        req = urllib.request.Request(f"https://skitour.fr/api/sorties?{q}", headers={"cle": SKITOUR_CLE, "User-Agent": "Assomoutain"})
        with urllib.request.urlopen(req, timeout=30) as r:
            lot = json.loads(r.read())
        if isinstance(lot, dict):
            raise RuntimeError(f"skitour : {lot.get('ERROR', 'erreur')}")
        data += lot
        if lot and isinstance(lot[0], dict):
            CHAMPS_VUS.update(lot[0].keys())
        if len(lot) < 1000:
            break
    return data


def _sommets(x) -> list:
    return [sm for sm in (x.get("sommets") or []) if isinstance(sm, dict) and _nombre(sm.get("lat")) is not None and _nombre(sm.get("lng")) is not None]


def _sortie(x, sm) -> dict:
    return {
        "id": _entier(x.get("id")), "titre": x.get("titre") or "", "date": _entier(x.get("date")),
        "massif": _d(x.get("massif")).get("nom", "") or (x.get("massif") if isinstance(x.get("massif"), str) else ""),
        "sommet": sm.get("sommet") or "", "altitude": _entier(sm.get("altitude")),
        "lat": float(sm["lat"]), "lon": float(sm["lng"]),
        "denivele": _entier(x.get("denivele")), "dif_ski": x.get("dif_ski") or None, "orientation": x.get("orientation") or "",
        "conditions": _texte(x.get("cond"))[:400],
        "auteur": _pseudo(x.get("auteur")),
        "url": f"https://skitour.fr/sorties/{x.get('id')}",
        "skiabilite": _texte(x.get("skiabilite")), "etoiles": _etoiles(x), "parking": _parking(x),
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
    return _completer(_avec_parkings(out))


# ---------- Sorties sur la carte (icône ⛷🗺) : toute la liste d'une période, l'appli garde celles de l'écran ----------
# Une seule requête skitour par période (gardée 1 h) quel que soit l'endroit regardé ; les détails lus sur les pages
# (étoiles, skiabilité en mot, parking) ne sont demandés que pour les sorties à l'écran, 30 au plus à la fois.

_PAR_ID: dict = {}  # id -> sortie brute de l'API (pour les détails)


def toutes_sorties(jours: int) -> list:
    """Toutes les sorties de la période (jours ≥ 3650 = « Tout »), avec un sommet placé sur la carte."""
    c = _liste_memo.get(("tout", jours))
    # Longue période : plus de pages (1000 sorties chacune) mais gardée plus longtemps, pour ménager le quota skitour.
    garde = 3600 if jours <= 30 else 6 * 3600
    if not (c and time.time() - c[0] < garde):
        out = []
        for x in _sorties_brutes(jours, pages=3 if jours <= 90 else 10):
            pts = _sommets(x)
            if pts:
                o = _sortie(x, pts[0])
                o["conditions"] = o["conditions"][:200]
                out.append(o)
                _PAR_ID[o["id"]] = o
        out.sort(key=lambda o: o["date"] or 0, reverse=True)
        c = (time.time(), out)
        _liste_memo[("tout", jours)] = c
    return c[1]


def details_sorties(ids: list) -> dict:
    """Étoiles, skiabilité en mot et parking (avec nom et altitude) des sorties demandées."""
    lignes = [dict(_PAR_ID[i]) for i in ids if i in _PAR_ID]
    lignes += [{"id": i, "skiabilite": "", "etoiles": None, "parking": None} for i in ids if i not in _PAR_ID]
    return {str(o["id"]): {"etoiles": o.get("etoiles"), "skiabilite": o.get("skiabilite") or "", "parking": o.get("parking")}
            for o in _completer(_avec_parkings(lignes), maxi=30)}


# ---------- Sorties en texte (icône ⛷💬) : liste façon skitour.fr, puis fiche détaillée ----------
# Pas de Claude ici : seulement l'API skitour. Les photos ne sont pas reprises (conditions de l'API) : la fiche
# renvoie vers la page skitour.fr de la sortie.

_liste_memo: dict = {}


def _personnes(x) -> str:
    noms = [_pseudo(x.get("auteur"))] + [_pseudo(p) for p in (x.get("participants") or []) if isinstance(p, (dict, str))]
    return ", ".join(n for n in noms if n)


def _ligne(x) -> dict:
    """Une sortie pour la liste : texte court, sans les récits."""
    pts = _sommets(x)
    sm = _d((pts or [s for s in (x.get("sommets") or []) if isinstance(s, dict)] or [{}])[0])
    return {
        "id": _entier(x.get("id")), "titre": x.get("titre") or "", "date": _entier(x.get("date")),
        "massif": _d(x.get("massif")).get("nom", "") or (x.get("massif") if isinstance(x.get("massif"), str) else ""),
        "sommet": sm.get("sommet") or sm.get("nom") or "", "altitude": _entier(sm.get("altitude")),
        "lat": float(sm["lat"]) if pts else None, "lon": float(sm["lng"]) if pts else None,
        "denivele": _entier(x.get("denivele")), "dif_ski": x.get("dif_ski") or None, "orientation": x.get("orientation") or "",
        "auteurs": _personnes(x), "url": f"https://skitour.fr/sorties/{x.get('id')}",
        "skiabilite": _texte(x.get("skiabilite")), "etoiles": _etoiles(x), "parking": _parking(x),
    }


def liste_sorties(jours: int, massifs: list | None = None) -> list:
    """Sorties des derniers jours, de tous les massifs ou de ceux choisis (un appel par massif, gardé 1 h)."""
    out, vus = [], set()
    for m in (massifs or [None]):
        c = _liste_memo.get((jours, m))
        if not (c and time.time() - c[0] < 3600):
            c = (time.time(), [_ligne(x) for x in _sorties_brutes(jours, m)])
            _liste_memo[(jours, m)] = c
        for o in c[1]:
            if o["id"] not in vus:
                vus.add(o["id"]); out.append(o)
    out.sort(key=lambda o: o["date"] or 0, reverse=True)
    return _completer(out)


def liste_massifs() -> list:
    """Massifs de skitour (id, nom, groupe), gardés 1 jour."""
    c = _liste_memo.get("massifs")
    if c and time.time() - c[0] < 86400:
        return c[1]
    req = urllib.request.Request("https://skitour.fr/api/massifs", headers={"cle": SKITOUR_CLE, "User-Agent": "Assomoutain"})
    with urllib.request.urlopen(req, timeout=30) as r:
        data = json.loads(r.read())
    if isinstance(data, dict):
        raise RuntimeError(f"skitour : {data.get('ERROR', 'erreur')}")
    out = [{"id": _entier(m.get("id")), "nom": m.get("nom") or "", "groupe": m.get("groupe") or ""}
           for m in data if isinstance(m, dict) and _entier(m.get("id"))]
    _liste_memo["massifs"] = (time.time(), out)
    return out


def fiche_sortie(id_: int) -> dict:
    req = urllib.request.Request(f"https://skitour.fr/api/sortie/{id_}", headers={"cle": SKITOUR_CLE, "User-Agent": "Assomoutain"})
    with urllib.request.urlopen(req, timeout=30) as r:
        x = json.loads(r.read())
    if isinstance(x, list):
        x = x[0] if x else {}
    base = None
    if not isinstance(x, dict) and _entier(id_) in _PAR_ID:
        # Réponse inattendue de l'API (pas un objet) : on garde ce que la liste de la carte savait de la sortie,
        # complété par sa page skitour.fr (étoiles, skiabilité, départ, topos, sommets).
        print(f"fiche skitour {id_} : réponse {type(x).__name__} {str(x)[:200]!r}", file=sys.stderr, flush=True)
        base = dict(_PAR_ID[_entier(id_)])
        base["auteurs"] = base.get("auteur", "")
        base = _completer([base])[0]
        x = {"id": id_, "cond": ((_PAGES.get(_entier(id_)) or (0, {}))[1] or {}).get("conditions") or base.get("conditions", "")}
    if not isinstance(x, dict) or x.get("ERROR"):
        # Erreur de l'API : {"ERROR": …}, ou parfois un simple texte à la place de la sortie.
        raise RuntimeError(f"skitour : {_d(x).get('ERROR') or (x.strip()[:120] if isinstance(x, str) and x.strip() else 'sortie introuvable')}")
    d = x.get("depart") if isinstance(x.get("depart"), dict) else {}
    neige = []
    for n in x.get("neige") or []:
        if isinstance(n, dict):
            neige.append(" · ".join(str(n.get(k) or "").strip() for k in ("lieu", "alt", "ori", "heure", "qte", "type", "com") if str(n.get(k) or "").strip()))
    base = base or _completer([_ligne(x)])[0]
    page = (_PAGES.get(_entier(x.get("id"))) or (0, {}))[1] or {}
    liens = page.get("liens") or []
    pk = base.get("parking") or {}

    def lien(typ, id_, nom):
        """Lien vers la page skitour.fr (celui de la page de la sortie s'il existe, sinon construit avec l'id de l'API)."""
        for l in liens:
            if l["type"] == typ and (id_ and l["id"] == id_ or not id_ and l["nom"] == nom):
                return l["url"]
        return f"https://skitour.fr/{typ}/{id_}" if id_ else ""
    dep_id = _entier(d.get("id"))
    dep_nom = d.get("nom") or pk.get("nom") or next((l["nom"] for l in liens if l["type"] == "departs"), "")
    dep_alt = _entier(d.get("altitude")) or pk.get("altitude")
    som_api = [sm for sm in (x.get("sommets") or []) if isinstance(sm, dict)]
    sommets_liens = [{"nom": sm.get("sommet") or sm.get("nom") or "", "altitude": _entier(sm.get("altitude")),
                      "lat": _nombre(sm.get("lat")), "lon": _nombre(sm.get("lng")),
                      "url": lien("sommets", _entier(sm.get("id")), sm.get("sommet") or sm.get("nom") or "")} for sm in som_api]
    if not sommets_liens:
        sommets_liens = [{"nom": l["nom"], "altitude": None, "lat": None, "lon": None, "url": l["url"]} for l in liens if l["type"] == "sommets"]
    topos_api = [t for t in (x.get("topos") or []) if isinstance(t, dict)]
    topos_liens = [{"nom": t.get("nom", ""), "url": lien("topos", _entier(t.get("id")), t.get("nom", ""))} for t in topos_api] \
        or [{"nom": l["nom"], "url": l["url"]} for l in liens if l["type"] == "topos"]
    return {
        **base,
        # Fiche façon skitour.fr : départ, topos et sommets avec leur lien (et leur point pour la carte).
        "liens": {
            "depart": {"nom": dep_nom, "altitude": dep_alt, "url": lien("departs", dep_id, dep_nom),
                       "lat": pk.get("lat"), "lon": pk.get("lon")} if (dep_nom or pk) else None,
            "topos": topos_liens, "sommets": sommets_liens,
        },
        "exposition": _texte(x.get("expo") or x.get("exposition")) or page.get("exposition", ""),
        "sommets": [sm.get("sommet") or sm.get("nom") or "" for sm in (x.get("sommets") or []) if isinstance(sm, dict)],
        "depart": (dep_nom or "") + (f" ({dep_alt} m)" if dep_alt else ""),
        "topos": [t.get("nom", "") for t in (x.get("topos") or []) if isinstance(t, dict)],
        "conditions": _texte(x.get("cond") or x.get("conditions")) or page.get("conditions", ""),
        "neige": neige,
        "recit": _texte(x.get("recit")),
        # Photos : seulement dans la fiche de leur sortie, auteur cité (conditions de l'API skitour).
        "photos": [{"url": urllib.parse.urljoin("https://skitour.fr/", str(ph.get("url") or "")),
                    "legende": _texte(ph.get("com")), "auteur": _pseudo(ph.get("auteur")) or _pseudo(x.get("auteur"))}
                   for ph in (x.get("photos") or []) if isinstance(ph, dict) and ph.get("url")],
    }


PHOTO_CHEMIN = re.compile(r"^https://skitour\.fr/[\w/.%-]+\.(jpe?g|png|webp)$", re.I)


def photo_skitour(url: str) -> tuple:
    """Une photo de skitour.fr (pour le hors ligne de l'appli web, qui ne peut pas la lire directement : CORS)."""
    if not PHOTO_CHEMIN.match(url) or ".." in url:
        raise ValueError("adresse de photo refusée")
    req = urllib.request.Request(url, headers={"User-Agent": "Assomoutain"})
    with urllib.request.urlopen(req, timeout=30) as r:
        data = r.read(6_000_000)
        return data, r.headers.get("Content-Type", "image/jpeg")


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
        self._json(200, {"ok": True, "modele": MODELE, "routes": ["randos", "voiture", "voyage", "invitation", "hebergement", "facture", "skitour", "skitour-liste", "skitour-sortie", "skitour-massifs", "skitour-photo", "skitour-tout", "skitour-details"], "skitour": bool(SKITOUR_CLE), "skitour_champs": sorted(CHAMPS_VUS), "skitour_depart": sorted(CHAMPS_DEPART), "mail": MAIL_ACTIF, **cumuls()})

    def do_POST(self):
        chemin = self.path.rstrip("/")
        if not chemin.endswith(("/randos", "/voiture", "/voyage", "/invitation", "/hebergement", "/facture", "/skitour", "/skitour-liste", "/skitour-sortie", "/skitour-massifs", "/skitour-photo", "/skitour-tout", "/skitour-details")):
            return self._json(404, {"erreur": "inconnu"})
        if not MOT_DE_PASSE or not hmac.compare_digest(self.headers.get("X-Mot-De-Passe", ""), MOT_DE_PASSE):
            return self._json(401, {"erreur": "Mot de passe IA incorrect"})
        if chemin.endswith("/invitation"):
            return self._invitation()
        if chemin.endswith("/facture"):
            return self._facture()
        if chemin.endswith("/skitour"):
            return self._skitour()
        if chemin.endswith("/skitour-photo"):
            try:
                d = json.loads(self.rfile.read(min(int(self.headers.get("Content-Length", 0)), 2_000)))
                data, typ = photo_skitour(str(d["url"]))
            except (ValueError, KeyError, TypeError) as ex:
                return self._json(400, {"erreur": str(ex) or "adresse invalide"})
            except Exception as ex:  # noqa: BLE001
                return self._json(502, {"erreur": str(ex)})
            self.send_response(200)
            self._cors()
            self.send_header("Content-Type", typ)
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return
        if chemin.endswith(("/skitour-tout", "/skitour-details")):
            if not SKITOUR_CLE:
                return self._json(503, {"erreur": "clé skitour pas encore installée sur le serveur"})
            try:
                d = json.loads(self.rfile.read(min(int(self.headers.get("Content-Length", 0)), 4_000)) or b"{}")
                jours = max(1, min(int(d.get("jours", 30)), 3650))
                ids = [int(i) for i in (d.get("ids") or [])][:30]
            except (ValueError, TypeError):
                return self._json(400, {"erreur": "demande invalide"})
            try:
                if chemin.endswith("/skitour-tout"):
                    return self._json(200, {"sorties": toutes_sorties(jours)})
                return self._json(200, {"details": details_sorties(ids)})
            except Exception as ex:  # noqa: BLE001
                return self._json(502, {"erreur": str(ex)})
        if chemin.endswith("/skitour-massifs"):
            if not SKITOUR_CLE:
                return self._json(503, {"erreur": "clé skitour pas encore installée sur le serveur"})
            try:
                return self._json(200, {"massifs": liste_massifs()})
            except Exception as ex:  # noqa: BLE001
                return self._json(502, {"erreur": str(ex)})
        if chemin.endswith(("/skitour-liste", "/skitour-sortie")):
            return self._skitour_texte(chemin.endswith("/skitour-liste"))
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
        cle = f"skitour4:{o:.3f},{s:.3f},{e:.3f},{n:.3f},{jours}"
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

    def _skitour_texte(self, liste: bool):
        if not SKITOUR_CLE:
            return self._json(503, {"erreur": "clé skitour pas encore installée sur le serveur"})
        try:
            d = json.loads(self.rfile.read(min(int(self.headers.get("Content-Length", 0)), 2_000)) or b"{}")
            jours = max(1, min(int(d.get("jours", 14)), 186))
            massifs = sorted({int(m) for m in (d.get("massifs") or [])})[:30]
            id_ = None if liste else int(d["id"])
        except (ValueError, KeyError, TypeError):
            return self._json(400, {"erreur": "demande invalide"})
        try:
            if liste:
                return self._json(200, {"sorties": liste_sorties(jours, massifs)})
            cle = f"fiche6:{id_}"
            with verrou:
                cache = _lire("cache-skitour-fiches.json", {})
                c = cache.get(cle)
                if c and time.time() - c["t"] < 86400:
                    return self._json(200, c["r"])
            r = fiche_sortie(id_)
            with verrou:
                cache = {k: x for k, x in _lire("cache-skitour-fiches.json", {}).items() if time.time() - x["t"] < 86400}
                cache[cle] = {"t": time.time(), "r": r}
                _ecrire("cache-skitour-fiches.json", cache)
            self._json(200, r)
        except (RuntimeError, OSError) as ex:
            self._json(502, {"erreur": str(ex)})
        except Exception:  # noqa: BLE001 — bug de lecture : détail dans « docker logs », message simple pour l'appli
            traceback.print_exc()
            self._json(502, {"erreur": "fiche skitour illisible pour l'instant, ouvre-la sur skitour.fr"})

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
