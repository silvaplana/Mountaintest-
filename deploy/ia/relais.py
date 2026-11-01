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
        self._json(200, {"ok": True, "modele": MODELE, **cumuls()})

    def do_POST(self):
        if not self.path.rstrip("/").endswith("/randos"):
            return self._json(404, {"erreur": "inconnu"})
        if not MOT_DE_PASSE or not hmac.compare_digest(self.headers.get("X-Mot-De-Passe", ""), MOT_DE_PASSE):
            return self._json(401, {"erreur": "Mot de passe IA incorrect"})
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


if __name__ == "__main__":
    print(f"Relais IA prêt (modèle {MODELE}, {MAX_PAR_JOUR} recherches par jour)", flush=True)
    ThreadingHTTPServer(("0.0.0.0", 8080), Relais).serve_forever()
