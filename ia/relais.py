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


def _photos_html(page: str) -> list:
    """Photos d'une page skitour.fr : images du site, sans logos, étoiles ni icônes ; grandes images d'abord."""
    photos = []
    for attrs in (r"href|data-full|data-src", r"src"):
        for u in re.findall(r'(?:' + attrs + r')="([^"]+?\.(?:jpe?g|png|webp))"', page, re.I):
            u = urllib.parse.urljoin("https://skitour.fr/", html.unescape(u))
            if PHOTO_CHEMIN.match(u) and not re.search(r"logo|star|icon|picto|avatar|drapeau|flag|meteo|pub|bann|bandeau|fond|sprite|/img/", u, re.I) \
                    and u not in photos:
                photos.append(u)
        if photos:
            break
    return photos[:30]


def _page_sortie(id_: int) -> dict:
    c = _PAGES.get(id_)
    if c and time.time() - c[0] < 86400 and "photos" in c[1]:
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
    # Photos de la page (secours si l'API n'en donne pas) : images de skitour.fr, sans logos, étoiles ni icônes.
    # Les liens vers les grandes images d'abord ; les vignettes seulement s'il n'y en a pas.
    photos = _photos_html(page)
    out = {"liens": liens, "photos": photos[:30], "conditions": cond_txt, "exposition": expo.group(1) if expo else "",
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


def _departs_connus() -> dict:
    """Parkings déjà lus (sous verrou). L'ancien fichier gardait aussi « pas de parking » après une erreur de l'API
    (quota atteint) : on n'en reprend que les parkings trouvés."""
    c = _lire("cache-skitour-departs3.json", None)
    if c is None:
        c = {k: v for k, v in _lire("cache-skitour-departs2.json", {}).items() if v}
    return c


def _avec_parkings(lignes: list, maxi: int = 30) -> list:
    """Ajoute le parking aux sorties qui n'en ont pas (la liste de l'API ne le donne pas toujours) :
    lu dans la fiche de la sortie, gardé pour toujours (un départ ne bouge pas)."""
    with verrou:
        connus = _departs_connus()
    nouveaux = {}
    for o in lignes:
        k = str(o.get("id"))
        if o.get("parking") or not o.get("id"):
            continue
        if k not in connus and len(nouveaux) < maxi:
            try:
                req = _requete_api(f"https://skitour.fr/api/sortie/{o['id']}")
                with urllib.request.urlopen(req, timeout=15) as r:
                    x = json.loads(r.read())
                x = (x[0] if x else {}) if isinstance(x, list) else x
                if not isinstance(x, dict) or x.get("ERROR"):
                    # Erreur de l'API (quota du jour atteint…) : on ne retient rien, on redemandera plus tard.
                    print(f"départ skitour {k} : {_d(x).get('ERROR') or 'réponse vide'}", file=sys.stderr, flush=True)
                    continue
                nouveaux[k] = _parking(x)
            except Exception:  # noqa: BLE001 (sans parking, la sortie s'affiche quand même)
                continue
        o["parking"] = nouveaux.get(k, connus.get(k))
    if nouveaux:
        with verrou:
            connus = _departs_connus()
            connus.update(nouveaux)
            _ecrire("cache-skitour-departs3.json", connus)
    return lignes


# ---------- Demandes à l'API skitour : comptées (quota de 1000 par jour), affichées dans 📊 de l'appli ----------
QUOTA_SKITOUR = 1000
_APPELS_FICHIER = "skitour-appels.json"


def _type_appel(url: str) -> str:
    chemin = urllib.parse.urlparse(url).path.rstrip("/").split("/")
    return {"sorties": "sorties", "sortie": "sortie", "topo": "topo", "topos": "topos", "massifs": "massifs"}.get(
        chemin[2] if len(chemin) > 2 else "", "autre")


def _requete_api(url: str):
    """Requête vers l'API skitour (clé dans l'en-tête), comptée par jour et par type dans skitour-appels.json."""
    jour, t = time.strftime("%Y-%m-%d"), _type_appel(url)
    with verrou:
        c = _lire(_APPELS_FICHIER, {})
        j = c.setdefault(jour, {})
        j[t] = j.get(t, 0) + 1
        for vieux in sorted(c)[:-30]:  # 30 jours gardés
            del c[vieux]
        _ecrire(_APPELS_FICHIER, c)
    return urllib.request.Request(url, headers={"cle": SKITOUR_CLE, "User-Agent": "Assomoutain"})


def appels_skitour() -> dict:
    """Demandes faites aujourd'hui (par type) et les 7 derniers jours, pour l'écran 📊."""
    with verrou:
        c = _lire(_APPELS_FICHIER, {})
    jour = time.strftime("%Y-%m-%d")
    return {"skitour_appels": {"quota": QUOTA_SKITOUR, "aujourdhui": sum(c.get(jour, {}).values()), "par_type": c.get(jour, {}),
                               "jours": {k: sum(v.values()) for k, v in sorted(c.items())[-7:]}}}


def _pages(jours: int) -> int:
    """Pages de 1000 sorties à demander : plus pour les longues périodes (sinon « Tout » ou « 4 ans » ne montraient
    que la dernière année, toutes les sorties de tous les massifs ne tenant pas dans 10 pages)."""
    return 3 if jours <= 90 else 10 if jours <= 365 else 25


def _garde(jours: int) -> int:
    """Durée pendant laquelle une liste reste fraîche : 1 h, 6 h au-delà d'un mois, 1 jour au-delà d'un an."""
    return 3600 if jours <= 30 else 6 * 3600 if jours <= 365 else 86400


def _sorties_brutes(jours: int, massif: int | None = None, pages: int = 3) -> list:
    """Sorties publiées ces derniers jours (format brut de l'API), toutes ou d'un massif.
    Gardées sur le disque (1 h, 6 h au-delà d'un mois) : une liste plus longue encore fraîche sert aussi aux périodes
    plus courtes, et un redémarrage du relais ne coûte plus rien au quota de l'API."""
    garde = _garde(jours)
    m = massif or "tous"
    try:
        noms = os.listdir(DOSSIER)
    except OSError:
        noms = []
    for nom in noms:
        g = re.fullmatch(r"cache-skitour-sorties-(\d+)-(\w+)\.json", nom)
        if not g or g.group(2) != str(m) or int(g.group(1)) < jours:
            continue
        with verrou:
            c = _lire(nom, {})
        if time.time() - c.get("t", 0) < garde:
            depuis = time.time() - jours * 86400
            return [x for x in c.get("data", []) if isinstance(x, dict) and (_entier(x.get("date")) or 0) >= depuis]
    data = _sorties_api(jours, massif, pages)
    with verrou:
        _ecrire(f"cache-skitour-sorties-{jours}-{m}.json", {"t": time.time(), "data": data})
    return data


def _sorties_api(jours: int, massif: int | None, pages: int) -> list:
    # Le filtre « autour d'une position » de l'API (ll=lat,lon) répond en erreur 500 (constaté le 5 nov. 2026) :
    # on prend donc les sorties des derniers jours, par pages de 1000.
    data = []
    for page in range(1, pages + 1):
        q = urllib.parse.urlencode({"j": jours, "c": 1, "l": 1000, "p": page, **({"m": massif} if massif else {})})
        req = _requete_api(f"https://skitour.fr/api/sorties?{q}")
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


def _gpx(x) -> str:
    """Trace GPX de la sortie : l'API donne « gpx » (adresse, relative dans la liste) seulement quand il y en a une."""
    g = x.get("gpx") if isinstance(x, dict) else None
    if not isinstance(g, str) or not g.strip():
        return ""
    g = g.strip()
    return g if g.startswith("https://skitour.fr/") else ("https://skitour.fr" + g if g.startswith("/") else "")


def _sortie(x, sm) -> dict:
    return {
        "id": _entier(x.get("id")), "titre": _texte(x.get("titre")), "date": _entier(x.get("date")),
        "massif": _d(x.get("massif")).get("nom", "") or (x.get("massif") if isinstance(x.get("massif"), str) else ""),
        "sommet": sm.get("sommet") or "", "altitude": _entier(sm.get("altitude")),
        "lat": float(sm["lat"]), "lon": float(sm["lng"]),
        "denivele": _entier(x.get("denivele")), "dif_ski": x.get("dif_ski") or None, "orientation": x.get("orientation") or "",
        "conditions": _texte(x.get("cond"))[:400],
        "auteur": _pseudo(x.get("auteur")),
        "url": f"https://skitour.fr/sorties/{x.get('id')}", "gpx": _gpx(x),
        "skiabilite": _texte(x.get("skiabilite")), "etoiles": _etoiles(x), "parking": _parking(x),
        # Topos liés (leur itinéraire GPX est lu à la demande, pour la case « Itinéraire » de la carte).
        "topos_ids": [i for i in (_entier(_d(t).get("id")) for t in (x.get("topos") or [])) if i][:3],
        "sommets_ids": [i for i in (_entier(_d(t).get("id")) for t in (x.get("sommets") or [])) if i][:2],
        "depart_id": _entier(_d(x.get("depart")).get("id")),
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
    garde = _garde(jours)
    if not (c and time.time() - c[0] < garde):
        out = []
        for x in _sorties_brutes(jours, pages=_pages(jours)):
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


GPX_CHEMIN = re.compile(r"^https://skitour\.fr/[\w/.%-]+\.gpx$", re.I)
_TRACES: dict = {}  # adresse GPX -> trace simplifiée [[lon, lat], …] (une trace ne change pas)


def _trace(url: str, maxi: int = 80) -> list:
    """Trace GPX d'une sortie (points de trace ou d'itinéraire), réduite à maxi points pour la carte."""
    if not url or not GPX_CHEMIN.match(url):
        return []
    if url in _TRACES:
        return _TRACES[url]
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Assomoutain"})
        with urllib.request.urlopen(req, timeout=10) as r:
            gpx = r.read(3_000_000).decode("utf-8", "replace")
    except OSError as ex:
        print(f"trace skitour {url} : {ex}", file=sys.stderr, flush=True)
        return []
    pts = []
    for m in re.finditer(r"<(?:\w+:)?(?:trkpt|rtept)\b([^>]*)>", gpx):
        la = re.search(r'\blat\s*=\s*["\']([-\d.]+)', m.group(1))
        lo = re.search(r'\blon\s*=\s*["\']([-\d.]+)', m.group(1))
        if la and lo:
            pts.append([round(float(lo.group(1)), 5), round(float(la.group(1)), 5)])
    if len(pts) > maxi:
        pas = (len(pts) - 1) / (maxi - 1)
        pts = [pts[round(k * pas)] for k in range(maxi)]
    if len(_TRACES) > 3000:
        _TRACES.clear()
    _TRACES[url] = pts
    return pts


_TOPOS_GPX: dict = {}  # id du topo -> adresse de son GPX ("" s'il n'en a pas)


def _gpx_topo(id_: int) -> str:
    """Adresse du GPX d'un topo (itinéraire), lue une fois par topo dans l'API skitour."""
    k = str(id_)
    if not _TOPOS_GPX:
        with verrou:
            _TOPOS_GPX.update(_lire("cache-skitour-topos-gpx.json", {}))
    if k not in _TOPOS_GPX:
        try:
            req = _requete_api(f"https://skitour.fr/api/topo/{id_}")
            with urllib.request.urlopen(req, timeout=10) as r:
                x = json.loads(r.read())
            x = x[0] if isinstance(x, list) and x else x
            if not isinstance(x, dict) or x.get("ERROR"):
                # Erreur de l'API (quota du jour atteint…) : rien de retenu, on redemandera.
                print(f"topo skitour {id_} : {_d(x).get('ERROR') or 'réponse vide'}", file=sys.stderr, flush=True)
                return ""
            _TOPOS_GPX[k] = _gpx(x)
            with verrou:  # gardé sur le disque : le relais redémarre à chaque mise à jour, le quota de l'API est de 1000 par jour
                _ecrire("cache-skitour-topos-gpx.json", _TOPOS_GPX)
        except (OSError, ValueError) as ex:
            print(f"topo skitour {id_} : {ex}", file=sys.stderr, flush=True)
            return ""
    return _TOPOS_GPX[k]


_FICHES_TOPO: dict = {}  # id -> (heure, fiche)


def _point(x) -> dict:
    """Départ ou sommet d'un topo : nom, altitude, position. Formats vus ou documentés : latlon [lat, lon] ou "lat,lon",
    lat/lng (comme les sorties), lat/lon, latitude/longitude."""
    x = _d(x) if not isinstance(x, str) else {"nom": x}
    ll = x.get("latlon")
    if isinstance(ll, str) and "," in ll:
        ll = ll.split(",")
    ll = ll if isinstance(ll, list) else []
    lat = _nombre(ll[0]) if len(ll) > 1 else _nombre(next((x[k] for k in ("lat", "latitude") if x.get(k) is not None), None))
    lon = _nombre(ll[1]) if len(ll) > 1 else _nombre(next((x[k] for k in ("lng", "lon", "longitude") if x.get(k) is not None), None))
    if lat is not None and lon is not None and (lat == 0 and lon == 0):
        lat = lon = None
    return {"id": _entier(x.get("id")), "nom": _texte(x.get("nom") or x.get("sommet") or x.get("titre")), "altitude": _entier(x.get("altitude")),
            "lat": lat, "lon": lon}


def _points(v) -> list:
    """Liste de sommets d'un topo, quelle que soit sa forme (liste, objet unique, objet indexé par id)."""
    if isinstance(v, dict):
        v = [v] if any(k in v for k in ("nom", "sommet", "lat", "latlon", "id")) else list(v.values())
    return [_point(s) for s in (v or []) if isinstance(s, (dict, str))] if isinstance(v, list) else []


_POS_PAGES: dict = {}  # adresse d'une page skitour.fr -> (lat, lon) ou None
_HTML: dict = {}  # adresse -> (heure, page) : une lecture par page et par jour


def _html(url: str):
    """Page skitour.fr (texte), gardée un jour en mémoire ; None si illisible."""
    c = _HTML.get(url)
    if c and time.time() - c[0] < 86400:
        return c[1]
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "Assomoutain"}), timeout=10) as r:
            page = r.read(800_000).decode("utf-8", "replace")
    except OSError as ex:
        print(f"page skitour {url} : {ex}", file=sys.stderr, flush=True)
        return None
    if len(_HTML) > 200:
        _HTML.clear()
    _HTML[url] = (time.time(), page)
    return page


def _position_page(url: str):
    """Position lue sur une page skitour.fr (sommet, départ ou topo) : sa carte, ou son lien Géoportail.
    Une page n'est pas une demande à l'API (pas de quota)."""
    if url in _POS_PAGES:
        return _POS_PAGES[url]
    page = _html(url)
    if page is None:
        return None
    ok = lambda la, lo: 40 < la < 52 and -6 < lo < 18  # Alpes, Pyrénées, Corse… (France et voisins)
    pos = None
    for motif, ordre in ((r"[?&]c=(-?\d+\.\d+)(?:,|%2C)(-?\d+\.\d+)", "lonlat"),  # lien Géoportail : c=lon,lat
                         (r"(?:lat|latitude)[\"']?\s*[:=]\s*[\"']?(-?\d+\.\d{3,})[\s\S]{0,80}?(?:lng|lon|longitude)[\"']?\s*[:=]\s*[\"']?(-?\d+\.\d{3,})", "latlon"),
                         (r"data-lat=[\"'](-?\d+\.\d+)[\"'][^>]*data-(?:lng|lon)=[\"'](-?\d+\.\d+)", "latlon"),
                         (r"\[\s*(4\d\.\d{3,})\s*,\s*(-?\d{1,2}\.\d{3,})\s*\]", "latlon")):
        for m in re.finditer(motif, page, re.I):
            a, b = float(m.group(1)), float(m.group(2))
            la, lo = (b, a) if ordre == "lonlat" else (a, b)
            if ok(la, lo):
                pos = (la, lo)
                break
        if pos:
            break
    if not pos:
        print(f"page skitour {url} : pas de position trouvée", file=sys.stderr, flush=True)
    if len(_POS_PAGES) > 2000:
        _POS_PAGES.clear()
    _POS_PAGES[url] = pos
    return pos


TOPO_BRUT: dict = {}  # forme réelle des champs départ / sommets de l'API (affichée sur GET /mountaintest-ia/, pour vérifier)


def fiche_topo(id_: int) -> dict:
    """Fiche d'un topo (itinéraire) pour l'appli : textes de l'API skitour, départ, sommets et trace GPX simplifiée."""
    c = _FICHES_TOPO.get(id_)
    if c and time.time() - c[0] < 86400:
        return c[1]
    req = _requete_api(f"https://skitour.fr/api/topo/{id_}")
    with urllib.request.urlopen(req, timeout=15) as r:
        x = json.loads(r.read())
    x = x[0] if isinstance(x, list) and x else x
    if not isinstance(x, dict) or x.get("ERROR"):
        raise RuntimeError(f"skitour : {_d(x).get('ERROR') or 'topo introuvable'}")
    gpx = _gpx(x)
    f = {
        "id": id_, "nom": _texte(x.get("nom")), "url": f"https://skitour.fr/topos/{id_}",
        "massif": _d(x.get("massif")).get("nom", "") if isinstance(x.get("massif"), dict) else _texte(x.get("massif")),
        "orientation": _texte(x.get("orientation")), "denivele": _entier(x.get("denivele")), "dif_ski": _texte(x.get("dif_ski")),
        "difficulte": _texte(x.get("difficulte")), "expo": _texte(x.get("expo")),
        "depart": _point(x.get("depart")) if x.get("depart") else None,
        "sommets": _points(x.get("sommets") or x.get("sommet")),
        **{k: _texte(x.get(k)) for k in ("presentation", "itineraire", "variantes", "remarques", "materiel", "biblio")},
        "auteur": _pseudo(x.get("auteur")), "gpx": gpx, "trace": _trace(gpx),
    }
    # Photos du topo : celles de l'API, sinon celles de sa page skitour.fr.
    f["photos"] = _photos(x, {"photos": None})
    if not f["photos"]:
        page = _html(f["url"])
        f["photos"] = [{"url": u, "legende": "", "auteur": f["auteur"]} for u in (_photos_html(page) if page else [])]
    TOPO_BRUT["fiche"] = {"cles": sorted(x.keys()), "depart": x.get("depart"), "sommets": x.get("sommets") or x.get("sommet")}
    # Sans position dans l'API : celle de la page du sommet (sa carte), sinon du départ, sinon du topo.
    if not any(p and p.get("lat") is not None for p in [f["depart"], *f["sommets"]]) and not f["trace"]:
        pages = [f"https://skitour.fr/sommets/{p['id']}" for p in f["sommets"] if p.get("id")]
        pages += [f"https://skitour.fr/departs/{f['depart']['id']}"] if f["depart"] and f["depart"].get("id") else []
        for u in pages + [f["url"]]:
            pos = _position_page(u)
            if pos:
                cible = next((p for p in f["sommets"] if u.endswith(f"/{p.get('id')}")), None) or f["depart"] \
                    or (f["sommets"][0] if f["sommets"] else None)
                if cible is None:
                    cible = {"id": None, "nom": f["nom"], "altitude": None}
                    f["sommets"].append(cible)
                cible["lat"], cible["lon"] = pos
                break
    if len(_FICHES_TOPO) > 500:
        _FICHES_TOPO.clear()
    _FICHES_TOPO[id_] = (time.time(), f)
    return f


def _topo_court(t: dict) -> dict:
    """Un topo de la liste de l'API, pour la liste et la carte des topos de l'appli (départ placé)."""
    TOPO_BRUT.setdefault("liste", {"cles": sorted(t.keys()), "depart": t.get("depart"), "sommets": t.get("sommets")})
    dep = _point(t.get("depart")) if isinstance(t.get("depart"), (dict, str)) else None
    return {"id": _entier(t.get("id")), "nom": _texte(t.get("nom")), "url": f"https://skitour.fr/topos/{_entier(t.get('id'))}",
            "massif": _d(t.get("massif")).get("nom", "") if isinstance(t.get("massif"), dict) else _texte(t.get("massif")),
            "orientation": _texte(t.get("orientation")), "denivele": _entier(t.get("denivele")), "dif_ski": _texte(t.get("dif_ski")),
            "difficulte": _texte(t.get("difficulte")), "expo": _texte(t.get("expo")),
            "gpx": t.get("gpx") is None or str(t.get("gpx")).strip() not in ("", "0", "false"),
            "depart": dep and {"nom": dep["nom"], "altitude": dep["altitude"], "lat": dep["lat"], "lon": dep["lon"]}}


def _liste_topos(fichier: str, q: dict, pages: int = 20) -> list:
    """Topos de l'API (/api/topos?…), gardés 7 jours sur le disque : les topos changent peu, le quota est de 1000 par jour."""
    with verrou:
        c = _lire(fichier, None)
    if c and time.time() - c.get("t", 0) < 7 * 86400:
        return c["topos"]
    out, vus = [], set()
    for p in range(1, pages + 1):
        with urllib.request.urlopen(_requete_api(f"https://skitour.fr/api/topos?{urllib.parse.urlencode({**q, 'p': p})}"), timeout=30) as r:
            lot = json.loads(r.read())
        if not isinstance(lot, list):
            raise RuntimeError(f"skitour : {_d(lot).get('ERROR') or 'réponse inattendue'}")
        neufs = [t for t in lot if isinstance(t, dict) and _entier(t.get("id")) and _entier(t.get("id")) not in vus]
        for t in neufs:
            vus.add(_entier(t.get("id"))); out.append(_topo_court(t))
        if len(lot) < 100 or not neufs:  # dernière page (ou pagination ignorée par l'API)
            break
    with verrou:
        _ecrire(fichier, {"t": time.time(), "topos": out})
    return out


def topos_du_massif(m: int) -> list:
    return _liste_topos(f"cache-skitour-topos-m{m}.json", {"m": m})


def _massifs_proches(lat: float, lon: float, maxi: int = 2) -> list:
    """Massifs (id) des sorties dont un sommet est à moins de ~15 km du point, les plus fréquents d'abord.
    Lu dans les listes de sorties gardées sur le disque (sinon celle du mois, 3 demandes au plus)."""
    import math
    noms = sorted((n for n in os.listdir(DOSSIER) if re.fullmatch(r"cache-skitour-sorties-\d+-tous\.json", n)) if os.path.isdir(DOSSIER) else [],
                  key=lambda n: -int(n.split("-")[3]))
    data = None
    for n in noms:
        with verrou:
            data = _lire(n, {}).get("data")
        if data:
            break
    if not data:
        data = _sorties_brutes(30)
    compte: dict = {}
    k = math.cos(math.radians(lat))
    for x in data:
        m = _entier(_d(x.get("massif")).get("id"))
        if not m:
            continue
        for sm in _sommets(x):
            dy, dx = (float(sm["lat"]) - lat) * 111, (float(sm["lng"]) - lon) * 111 * k
            if dx * dx + dy * dy < 15 * 15:
                compte[m] = compte.get(m, 0) + 1
                break
    return [m for m, _ in sorted(compte.items(), key=lambda v: -v[1])[:maxi]]


def topos_autour(lat: float, lon: float) -> list:
    """Topos proches d'un point (carte des topos), par cases de 0,1° pour partager le cache entre écrans voisins.
    Le filtre « ll » de l'API peut répondre en erreur (comme pour les sorties) : on prend alors les topos des massifs
    du coin (repérés par les sorties), gardés 7 jours."""
    la, lo = round(lat, 1), round(lon, 1)
    fichier = f"cache-skitour-topos-ll{la}_{lo}.json"
    try:
        out = _liste_topos(fichier, {"ll": f"{la},{lo}"}, pages=3)
        if any(t.get("depart") and t["depart"].get("lat") is not None for t in out):
            return out
    except (RuntimeError, OSError, ValueError) as ex:
        print(f"topos autour de {la},{lo} : {ex}", file=sys.stderr, flush=True)
    out, vus = [], set()
    for m in _massifs_proches(la, lo):
        for t in topos_du_massif(m):
            if t["id"] not in vus:
                vus.add(t["id"]); out.append(t)
    with verrou:
        _ecrire(fichier, {"t": time.time(), "topos": out})
    return out


_TOPOS_SOMMET: dict = {}  # id du sommet -> (heure, topos bruts de l'API)


def topos_du_sommet(sommet_id: int, depart_id: int | None = None, orientation: str = "", maxi: int = 3) -> list:
    """Topos d'un sommet (API /topos?s=…), ceux du même départ puis de la même orientation d'abord.
    Sert quand une sortie n'a pas de topo associé : on va voir son sommet, comme on le ferait sur le site."""
    if not sommet_id or not SKITOUR_CLE:
        return []
    if not _TOPOS_SOMMET:
        with verrou:
            _TOPOS_SOMMET.update({int(k): tuple(v) for k, v in _lire("cache-skitour-topos-sommets.json", {}).items()})
    c = _TOPOS_SOMMET.get(sommet_id)
    if not (c and time.time() - c[0] < 7 * 86400):  # les topos d'un sommet changent rarement : 7 jours
        try:
            req = _requete_api(f"https://skitour.fr/api/topos?s={sommet_id}")
            with urllib.request.urlopen(req, timeout=10) as r:
                lot = json.loads(r.read())
        except (OSError, ValueError) as ex:
            print(f"topos du sommet {sommet_id} : {ex}", file=sys.stderr, flush=True)
            return []
        if not isinstance(lot, list):
            # Erreur de l'API (quota du jour atteint…) : rien de retenu, on redemandera.
            print(f"topos du sommet {sommet_id} : {_d(lot).get('ERROR') or 'réponse inattendue'}", file=sys.stderr, flush=True)
            return []
        # Gardés en bref (et sur le disque) : id, nom, orientation, départ, GPX ou pas.
        c = (time.time(), [{"id": _entier(t.get("id")), "nom": t.get("nom"), "orientation": t.get("orientation"),
                            "depart": {"id": _entier(_d(t.get("depart")).get("id"))},
                            "gpx": t.get("gpx") is None or str(t.get("gpx")).strip() not in ("", "0", "false")}
                           for t in lot if isinstance(t, dict) and _entier(t.get("id"))])
        _TOPOS_SOMMET[sommet_id] = c
        with verrou:
            _ecrire("cache-skitour-topos-sommets.json", {str(k): list(v) for k, v in _TOPOS_SOMMET.items()})
    ori = (orientation or "").strip().upper()
    def rang(t):
        return (0 if depart_id and _entier(_d(t.get("depart")).get("id")) == depart_id else 1,
                0 if ori and str(t.get("orientation") or "").strip().upper() == ori else 1)
    return [{"id": _entier(t.get("id")), "nom": _texte(t.get("nom")), "url": f"https://skitour.fr/topos/{_entier(t.get('id'))}",
             "gpx": t.get("gpx", True) is not False}
            for t in (lambda tri: [t for t in tri if rang(t) != (1, 1)] or tri)(sorted(c[1], key=rang))[:maxi]]


def _itineraire(o: dict) -> list:
    """Itinéraire du premier topo lié qui a un GPX (sinon d'un topo de son sommet)."""
    ids = list(o.get("topos_ids") or [])
    if not ids:
        for sid in o.get("sommets_ids") or []:
            # Seulement les topos qui ont un GPX (la liste de l'API le dit) : pas de demande inutile.
            ids += [t["id"] for t in topos_du_sommet(sid, o.get("depart_id"), o.get("orientation") or "") if t.get("gpx")]
    for t in ids[:2]:  # deux essais au plus par sortie, pour ménager le quota
        tr = _trace(_gpx_topo(t))
        if tr:
            return tr
    return []


def details_sorties(ids: list) -> dict:
    """Étoiles, skiabilité en mot, parking (avec nom et altitude) et trace GPX des sorties demandées."""
    from concurrent.futures import ThreadPoolExecutor
    lignes = [dict(_PAR_ID[i]) for i in ids if i in _PAR_ID]
    lignes += [{"id": i, "skiabilite": "", "etoiles": None, "parking": None} for i in ids if i not in _PAR_ID]
    lignes = _completer(_avec_parkings(lignes), maxi=30)
    with ThreadPoolExecutor(6) as ex:
        traces = list(ex.map(lambda o: _trace(o.get("gpx") or ""), lignes))
        itis = list(ex.map(_itineraire, lignes))
    return {str(o["id"]): {"etoiles": o.get("etoiles"), "skiabilite": o.get("skiabilite") or "", "parking": o.get("parking"),
                           "trace": t, "itineraire": it}
            for o, t, it in zip(lignes, traces, itis)}


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
        "id": _entier(x.get("id")), "titre": _texte(x.get("titre")), "date": _entier(x.get("date")),
        "massif": _d(x.get("massif")).get("nom", "") or (x.get("massif") if isinstance(x.get("massif"), str) else ""),
        "sommet": _texte(sm.get("sommet") or sm.get("nom")), "altitude": _entier(sm.get("altitude")),
        "lat": float(sm["lat"]) if pts else None, "lon": float(sm["lng"]) if pts else None,
        "denivele": _entier(x.get("denivele")), "dif_ski": x.get("dif_ski") or None, "orientation": x.get("orientation") or "",
        "auteurs": _personnes(x), "url": f"https://skitour.fr/sorties/{x.get('id')}", "gpx": _gpx(x),
        "skiabilite": _texte(x.get("skiabilite")), "etoiles": _etoiles(x), "parking": _parking(x),
    }


def liste_sorties(jours: int, massifs: list | None = None) -> list:
    """Sorties des derniers jours, de tous les massifs ou de ceux choisis (un appel par massif, gardé 1 h)."""
    out, vus = [], set()
    for m in (massifs or [None]):
        c = _liste_memo.get((jours, m))
        if not (c and time.time() - c[0] < _garde(jours)):
            # Longues périodes : plus de pages (1000 sorties chacune) ; gardées sur le disque, voir _sorties_brutes.
            c = (time.time(), [_ligne(x) for x in _sorties_brutes(jours, m, pages=_pages(jours))])
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
    req = _requete_api("https://skitour.fr/api/massifs")
    with urllib.request.urlopen(req, timeout=30) as r:
        data = json.loads(r.read())
    if isinstance(data, dict):
        raise RuntimeError(f"skitour : {data.get('ERROR', 'erreur')}")
    out = [{"id": _entier(m.get("id")), "nom": m.get("nom") or "", "groupe": m.get("groupe") or ""}
           for m in data if isinstance(m, dict) and _entier(m.get("id"))]
    _liste_memo["massifs"] = (time.time(), out)
    return out


def fiche_sortie(id_: int) -> dict:
    req = _requete_api(f"https://skitour.fr/api/sortie/{id_}")
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
    connu = _PAR_ID.get(_entier(x.get("id"))) or {}
    if base.get("lat") is None and connu.get("lat") is not None:
        # Sommets de la fiche sans coordonnées : on garde le point que la carte connaissait (pour « 🗺 Carte »).
        base = {**base, "lat": connu["lat"], "lon": connu.get("lon"), "parking": base.get("parking") or connu.get("parking")}
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
    topos_trouves = False
    if not topos_liens:
        # Pas de topo associé : on cherche ceux de son sommet (même départ et même orientation d'abord).
        sids = [i for i in (_entier(sm.get("id")) for sm in som_api) if i] or [l["id"] for l in liens if l["type"] == "sommets"]
        for sid in sids[:2]:
            topos_liens += [{"nom": t["nom"], "url": t["url"]} for t in topos_du_sommet(sid, dep_id, str(x.get("orientation") or ""))
                            if t["url"] not in {u["url"] for u in topos_liens}]
        topos_liens = topos_liens[:3]
        topos_trouves = bool(topos_liens)
    return {
        **base,
        # Fiche façon skitour.fr : départ, topos et sommets avec leur lien (et leur point pour la carte).
        "liens": {
            "depart": {"nom": dep_nom, "altitude": dep_alt, "url": lien("departs", dep_id, dep_nom),
                       "lat": pk.get("lat"), "lon": pk.get("lon")} if (dep_nom or pk) else None,
            "topos": topos_liens, "sommets": sommets_liens,
            # Topos retrouvés par le sommet (la sortie n'en cite pas) : les applis l'écrivent « Topos du sommet ».
            "topos_trouves": topos_trouves,
        },
        "exposition": _texte(x.get("expo") or x.get("exposition")) or page.get("exposition", ""),
        "sommets": [sm.get("sommet") or sm.get("nom") or "" for sm in (x.get("sommets") or []) if isinstance(sm, dict)],
        "depart": (dep_nom or "") + (f" ({dep_alt} m)" if dep_alt else ""),
        "topos": [t.get("nom", "") for t in (x.get("topos") or []) if isinstance(t, dict)],
        "conditions": _texte(x.get("cond") or x.get("conditions")) or page.get("conditions", ""),
        "neige": neige,
        "recit": _texte(x.get("recit")),
        # Photos : seulement dans la fiche de leur sortie, auteur cité (conditions de l'API skitour).
        "photos": _photos(x, page),
        "gpx": _gpx(x) or base.get("gpx", ""),
    }


PHOTO_CHEMIN = re.compile(r"^https://skitour\.fr/[\w/.%-]+\.(jpe?g|png|webp)$", re.I)
PHOTO_CLES = ("url", "src", "fichier", "file", "photo", "image", "chemin", "lien", "big", "grand", "full", "mini")


def _photos(x: dict, page: dict) -> list:
    """Photos de la sortie : celles de l'API (objets ou simples adresses, noms de champ variables), sinon celles de sa page."""
    brut = x.get("photos") or x.get("images") or x.get("img") or []
    if isinstance(brut, dict):
        brut = list(brut.values())
    if brut and not isinstance(brut, list):
        brut = [brut]
    if brut:  # trace pour comprendre le format réel de l'API (journal du relais)
        print(f"photos skitour {x.get('id')} : {str(brut[0])[:200]!r}", file=sys.stderr, flush=True)
    out, vus = [], set()
    auteur = _pseudo(x.get("auteur"))
    for ph in brut:
        d = _d(ph)
        u = ph if isinstance(ph, str) else next((str(d[k]) for k in PHOTO_CLES if isinstance(d.get(k), str) and d[k].strip()), "")
        u = urllib.parse.urljoin("https://skitour.fr/", u.strip()) if u else ""
        if u and u not in vus:
            vus.add(u)
            out.append({"url": u, "legende": _texte(d.get("com") or d.get("legende") or d.get("titre")), "auteur": _pseudo(d.get("auteur")) or auteur})
    if not out:
        out = [{"url": u, "legende": "", "auteur": auteur} for u in (page.get("photos") or [])]
    return out


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
    # Entités parfois encodées deux fois par skitour (« &amp;nbsp; ») : on décode jusqu'à ce que ça ne change plus.
    for _ in range(3):
        u = html.unescape(t)
        if u == t:
            break
        t = u
    return t.replace("\xa0", " ").strip()


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


def detail_couts():
    """Cumul par usage (randos, voiture, voyage, hebergement, facture…) pour l'écran « Usage IA et mémoire » de l'appli."""
    par = {}
    try:
        with open(_fichier("couts.jsonl")) as f:
            for l in f:
                try:
                    c = json.loads(l)
                except ValueError:
                    continue
                t = c.get("type", "randos")
                d = par.setdefault(t, {"cout_usd": 0.0, "requetes": 0, "premiere": c.get("date", "")})
                d["cout_usd"] = round(d["cout_usd"] + c.get("cout_usd", 0), 4); d["requetes"] += 1
    except OSError:
        pass
    serveur = 0
    for racine, _, fichiers in os.walk(DOSSIER):
        for n in fichiers:
            try:
                serveur += os.path.getsize(os.path.join(racine, n))
            except OSError:
                pass
    return {"par_type": par, "donnees_serveur_octets": serveur}


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
        self._json(200, {"ok": True, "modele": MODELE, "routes": ["randos", "voiture", "voyage", "invitation", "hebergement", "facture", "skitour", "skitour-liste", "skitour-sortie", "skitour-massifs", "skitour-photo", "skitour-tout", "skitour-details", "skitour-topo", "skitour-topos"], "skitour": bool(SKITOUR_CLE), "skitour_champs": sorted(CHAMPS_VUS), "skitour_depart": sorted(CHAMPS_DEPART), "mail": MAIL_ACTIF, **cumuls(), **detail_couts(), **appels_skitour(), "skitour_topo_brut": TOPO_BRUT})

    def do_POST(self):
        chemin = self.path.rstrip("/")
        if not chemin.endswith(("/randos", "/voiture", "/voyage", "/invitation", "/hebergement", "/facture", "/skitour", "/skitour-liste", "/skitour-sortie", "/skitour-massifs", "/skitour-photo", "/skitour-tout", "/skitour-details", "/skitour-topo", "/skitour-topos")):
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
        if chemin.endswith("/skitour-topo"):
            return self._skitour_topo()
        if chemin.endswith("/skitour-topos"):
            return self._skitour_topos()
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
            jours = max(1, min(int(d.get("jours", 14)), 3650))
            massifs = sorted({int(m) for m in (d.get("massifs") or [])})[:30]
            id_ = None if liste else int(d["id"])
        except (ValueError, KeyError, TypeError):
            return self._json(400, {"erreur": "demande invalide"})
        try:
            if liste:
                return self._json(200, {"sorties": liste_sorties(jours, massifs)})
            cle = f"fiche9:{id_}"
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

    def _skitour_topos(self):
        if not SKITOUR_CLE:
            return self._json(503, {"erreur": "clé skitour pas encore installée sur le serveur"})
        try:
            d = json.loads(self.rfile.read(min(int(self.headers.get("Content-Length", 0)), 4_000)) or b"{}")
            massifs = [int(i) for i in (d.get("massifs") or [])][:20]
            lat, lon = (float(d["lat"]), float(d["lon"])) if d.get("lat") is not None else (None, None)
        except (ValueError, TypeError, KeyError):
            return self._json(400, {"erreur": "demande invalide"})
        try:
            if lat is not None:
                return self._json(200, {"topos": topos_autour(lat, lon)})
            out, vus = [], set()
            for m in massifs:
                for t in topos_du_massif(m):
                    if t["id"] not in vus:
                        vus.add(t["id"]); out.append(t)
            out.sort(key=lambda t: t["nom"].lower())
            return self._json(200, {"topos": out})
        except Exception as ex:  # noqa: BLE001
            return self._json(502, {"erreur": str(ex)})

    def _skitour_topo(self):
        if not SKITOUR_CLE:
            return self._json(503, {"erreur": "clé skitour pas encore installée sur le serveur"})
        try:
            id_ = int(json.loads(self.rfile.read(min(int(self.headers.get("Content-Length", 0)), 2_000)) or b"{}")["id"])
        except (ValueError, KeyError, TypeError):
            return self._json(400, {"erreur": "demande invalide"})
        try:
            self._json(200, fiche_topo(id_))
        except (RuntimeError, OSError) as ex:
            self._json(502, {"erreur": str(ex)})
        except Exception:  # noqa: BLE001
            traceback.print_exc()
            self._json(502, {"erreur": "topo skitour illisible pour l'instant, ouvre-le sur skitour.fr"})

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
