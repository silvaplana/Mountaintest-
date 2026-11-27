"""Buddies bloc 1 : Groupes, Me Time, invitations, synchro (même faux Logto que test_serveur)."""
import uuid

import pytest

from test_serveur import client, entete  # noqa: F401  (fixture partagée)


def sync(client, sub="seb", ops=(), depuis=None):
    r = client.post("/buddies/sync", headers=entete(sub=sub), json={"ops": list(ops), "depuis": depuis})
    assert r.status_code == 200, r.text
    return r.json()


def nouveau_groupe(nom="Ski du dimanche"):
    return {"id": str(uuid.uuid4()), "type": "creer_groupe", "groupe": str(uuid.uuid4()), "nom": nom}


def invitation(gid, code="CodeSecret0123456789", canal="sms", nom="Julie"):
    return {"id": str(uuid.uuid4()), "type": "inviter", "groupe": gid, "invitation": str(uuid.uuid4()),
            "code": code, "canal": canal, "nom": nom, "contact": "06 12 34 56 78"}


def par_nom(r, nom):
    return next(g for g in r["groupes"] if g["nom"] == nom)


def ancien_me_time(sub, avec_sortie):
    """Un Me Time d'avant le 25 novembre, posé directement en base (le serveur n'en crée plus)."""
    import buddies
    import serveur
    from modeles import Groupe, Membre, Sortie, Utilisateur
    with serveur.Sessions() as s:
        u = s.scalar(buddies.select(Utilisateur).where(Utilisateur.logto_id == sub))
        gid = uuid.uuid5(buddies.ESPACE_ME_TIME, str(u.id))
        s.add(Groupe(id=gid, nom="Me Time", nature="me_time", cree_par=u.id, cree_le=buddies.FIN_ME_TIME - buddies.timedelta(days=1)))
        s.flush()
        s.add(Membre(groupe_id=gid, utilisateur_id=u.id, role="admin"))
        if avec_sortie:
            s.add(Sortie(id=uuid.uuid4(), groupe_id=gid, nom="Sainte-Victoire", debut="2026-11-29", fin="2026-11-29", cree_par=u.id))
        s.commit()
        return str(gid)


def test_plus_de_me_time(client):
    """Seb, 25 novembre : le Me Time disparaît, effacé avec ses sorties (choix « Tout effacer »)."""
    assert sync(client)["groupes"] == []
    vide = ancien_me_time("seb", avec_sortie=False)
    assert vide not in sync(client)["ids"]
    sync(client, sub="julie")
    ancien_me_time("julie", avec_sortie=True)
    r = sync(client, sub="julie")
    assert r["ids"] == [] and r["ids_sorties"] == []


def test_creer_un_groupe_hors_ligne_puis_renvoyer(client):
    op = nouveau_groupe()
    r = sync(client, ops=[op])
    g = par_nom(r, "Ski du dimanche")
    assert g["id"] == op["groupe"] and g["nature"] == "bande"
    # Réponse perdue : le téléphone renvoie la même opération, rien n'est créé deux fois.
    r = sync(client, ops=[op])
    assert len(r["ids"]) == 1 and r["refus"] == []


def test_inviter_puis_rejoindre_par_le_lien(client):
    op = nouveau_groupe()
    gid = op["groupe"]
    r = sync(client, ops=[op, invitation(gid)])
    assert par_nom(r, "Ski du dimanche")["invitations"][0]["nom"] == "Julie"
    # Aperçu pour la page du lien, sans connexion.
    a = client.get("/invitations/CodeSecret0123456789").json()
    assert a["groupe"] == "Ski du dimanche" and a["par"] == "seb"
    assert client.get("/invitations/inconnu").status_code == 404
    # Julie installe l'appli, se connecte et rejoint.
    r = sync(client, sub="julie", ops=[{"id": "x", "type": "rejoindre", "code": "CodeSecret0123456789"}])
    g = par_nom(r, "Ski du dimanche")
    assert [m["role"] for m in g["membres"]] == ["admin_principal", "membre"]
    assert g["invitations"] == []  # l'invitation de Julie est utilisée
    # Seb la voit arriver dans « nouveautés depuis ».
    assert len(par_nom(sync(client), "Ski du dimanche")["membres"]) == 2


def test_qr_code_sert_a_plusieurs(client):
    op = nouveau_groupe()
    sync(client, ops=[op, invitation(op["groupe"], canal="qr", nom="")])
    for qui in ("julie", "luc"):
        sync(client, sub=qui, ops=[{"id": qui, "type": "rejoindre", "code": "CodeSecret0123456789"}])
    g = par_nom(sync(client), "Ski du dimanche")
    assert len(g["membres"]) == 3 and len(g["invitations"]) == 1


def test_nouveautes_depuis(client):
    r = sync(client, ops=[nouveau_groupe()])
    curseur = r["curseur"]
    # Rien de neuf : liste vide, mais les ids disent toujours quels groupes garder.
    r2 = sync(client, depuis=curseur)
    assert len(r2["ids"]) == 1
    # Après la marge de 5 s le même curseur ne renverrait plus rien ; ici on vérifie seulement le format.
    assert all("membres" in g for g in r2["groupes"])


def test_droits_et_depart(client):
    op = nouveau_groupe()
    gid = op["groupe"]
    sync(client, ops=[op, invitation(gid)])
    julie = sync(client, sub="julie", ops=[{"id": "j", "type": "rejoindre", "code": "CodeSecret0123456789"}])["moi"]
    # Un simple membre ne retire personne : refusé, la file du téléphone n'est pas bloquée.
    seb = par_nom(sync(client), "Ski du dimanche")["membres"][0]["id"]
    r = sync(client, sub="julie", ops=[{"id": "r1", "type": "retirer", "groupe": gid, "buddy": seb}])
    assert r["refus"][0]["id"] == "r1"
    # Seb (admin principal, le créateur) la nomme admin puis quitte : Julie devient admin principale.
    sync(client, ops=[{"id": "a", "type": "nommer_admin", "groupe": gid, "buddy": julie},
                      {"id": "q", "type": "quitter", "groupe": gid}])
    assert gid not in sync(client)["ids"]
    g = par_nom(sync(client, sub="julie"), "Ski du dimanche")
    assert [(m["id"], m["role"]) for m in g["membres"]] == [(julie, "admin_principal")]
    # Dernier membre parti : le groupe disparaît.
    sync(client, sub="julie", ops=[{"id": "q2", "type": "quitter", "groupe": gid}])
    assert gid not in sync(client, sub="julie")["ids"]


def test_dernier_admin_qui_part_passe_la_main(client):
    op = nouveau_groupe()
    gid = op["groupe"]
    sync(client, ops=[op, invitation(gid)])
    sync(client, sub="julie", ops=[{"id": "j", "type": "rejoindre", "code": "CodeSecret0123456789"}])
    sync(client, ops=[{"id": "q", "type": "quitter", "groupe": gid}])
    assert par_nom(sync(client, sub="julie"), "Ski du dimanche")["membres"][0]["role"] == "admin_principal"


@pytest.mark.parametrize("op", [
    {"type": "inconnue"},
    {"type": "creer_groupe", "groupe": str(uuid.uuid4()), "nom": "   "},
    {"type": "creer_groupe", "groupe": "pas-un-uuid", "nom": "x"},
    {"type": "creer_groupe", "groupe": str(uuid.uuid4()), "nom": "x", "photo": "javascript:x"},
    {"type": "rejoindre", "code": "inconnu"},
    {"type": "quitter", "groupe": "pas-un-uuid"},
])
def test_operations_refusees(client, op):
    r = sync(client, ops=[{"id": "o", **op}])
    assert r["refus"][0]["id"] == "o"




def test_groupe_d_un_autre_invisible(client):
    op = nouveau_groupe()
    sync(client, ops=[op])
    r = sync(client, sub="luc", ops=[invitation(op["groupe"], code="AutreCode0123456789")])
    assert r["refus"] and op["groupe"] not in r["ids"]


def test_le_pseudo_change_arrive_chez_les_buddies(client):
    op = nouveau_groupe()
    sync(client, ops=[op, invitation(op["groupe"])])
    sync(client, sub="julie", ops=[{"id": "j", "type": "rejoindre", "code": "CodeSecret0123456789"}])
    client.put("/moi", headers=entete(sub="julie"), json={"pseudo": "Julie M."})
    g = par_nom(sync(client), "Ski du dimanche")
    assert g["membres"][1]["pseudo"] == "Julie M."


def test_colonnes_ajoutees_a_une_base_existante(monkeypatch):
    """Base créée par la version précédente (sans nature, photo, canal…) : les colonnes s'ajoutent au démarrage."""
    import serveur
    from sqlalchemy import create_engine, inspect, text
    moteur = create_engine("sqlite+pysqlite:///:memory:")
    with moteur.begin() as c:
        c.execute(text("CREATE TABLE utilisateurs (id CHAR(32) PRIMARY KEY)"))
        c.execute(text("CREATE TABLE groupes (id CHAR(32) PRIMARY KEY, nom VARCHAR(80))"))
        c.execute(text("CREATE TABLE invitations (id CHAR(32) PRIMARY KEY, code VARCHAR(32))"))
    monkeypatch.setattr(serveur, "moteur", moteur)
    serveur.ajouter_colonnes()
    serveur.ajouter_colonnes()  # relançable
    with moteur.connect() as c:
        assert {"nature", "photo"} <= {x["name"] for x in inspect(c).get_columns("groupes")}
        assert {"canal", "nom", "contact", "acceptee_par"} <= {x["name"] for x in inspect(c).get_columns("invitations")}


# ------------------------------------------------------------------ bloc 2 : Sorties et traces partagées

def nouvelle_sortie(gid, participants=(), nom="Week-end Queyras", debut="2026-12-12", fin="2026-12-13"):
    return {"id": str(uuid.uuid4()), "type": "creer_sortie", "sortie": str(uuid.uuid4()), "groupe": gid, "nom": nom,
            "debut": debut, "fin": fin, "lieu": "Ceillac", "participants": list(participants)}


def bande_avec_julie(client):
    op = nouveau_groupe()
    gid = op["groupe"]
    sync(client, ops=[op, invitation(gid)])
    julie = sync(client, sub="julie", ops=[{"id": "j", "type": "rejoindre", "code": "CodeSecret0123456789"}])["moi"]
    return gid, julie


def test_buddy_time_dans_un_groupe(client):
    gid, julie = bande_avec_julie(client)
    op = nouvelle_sortie(gid, participants=[julie, str(uuid.uuid4())])  # un inconnu est ignoré
    r = sync(client, ops=[op, op])  # renvoyé deux fois : une seule sortie
    assert r["refus"] == [] and r["ids_sorties"] == [op["sortie"]]
    so = r["sorties"][0]
    assert so["groupe"] == gid and so["debut"] == "2026-12-12" and so["lieu"] == "Ceillac"
    assert sorted(p["id"] for p in so["participants"]) == sorted([r["moi"], julie])
    # Julie le voit, Luc (hors du groupe) non.
    assert sync(client, sub="julie")["ids_sorties"] == [op["sortie"]]
    assert sync(client, sub="luc")["ids_sorties"] == []


def test_ancien_telephone_range_dans_me_time(client):
    """Un téléphone pas encore à jour range une sortie dans « me-time » : refusé, il dit de choisir un groupe."""
    r = sync(client, ops=[nouvelle_sortie("me-time")])
    assert "groupe" in r["refus"][0]["raison"] and r["ids_sorties"] == []


def test_inviter_un_copain_a_une_seule_sortie(client):
    g = nouveau_groupe()
    op = nouvelle_sortie(g["groupe"])
    inv = {**invitation(None, code="SortieCode0123456789"), "groupe": None, "sortie": op["sortie"]}
    r = sync(client, ops=[g, op, inv])
    assert r["refus"] == [] and r["sorties"][0]["invitations"][0]["nom"] == "Julie"
    assert client.get("/invitations/SortieCode0123456789").json()["sortie"] is True
    # Paul rejoint la sortie, sans entrer dans le groupe de Seb.
    rp = sync(client, sub="paul", ops=[{"id": "p", "type": "rejoindre", "code": "SortieCode0123456789"}])
    assert rp["ids_sorties"] == [op["sortie"]]
    assert rp["ids"] == []
    assert len(sync(client)["sorties"][0]["participants"]) == 2


def test_partager_une_trace_dans_un_buddy_time_et_un_groupe(client):
    gid, julie = bande_avec_julie(client)
    so = nouvelle_sortie(gid, participants=[julie])
    ligne = [[6.7, 44.65], [6.71, 44.66], [6.72, 44.67]]
    t1 = {"id": "t1", "type": "partager_trace", "trace": str(uuid.uuid4()), "sortie": so["sortie"], "nom": "Col Girardin",
          "ligne": ligne, "mot": "On fait ça samedi ?"}
    t2 = {"id": "t2", "type": "partager_trace", "trace": str(uuid.uuid4()), "groupe": gid, "nom": "Tour du lac", "ligne": ligne}
    r = sync(client, ops=[so, t1, t2, t1])
    assert r["refus"] == [] and len(r["ids_traces"]) == 2
    r = sync(client, sub="julie")
    t = next(x for x in r["traces"] if x["nom"] == "Col Girardin")
    assert t["sortie"] == so["sortie"] and t["ligne"][0] == [6.7, 44.65] and t["mot"] == "On fait ça samedi ?"
    assert t["par"]["pseudo"] == "seb"
    assert sync(client, sub="luc")["ids_traces"] == []


@pytest.mark.parametrize("mauvais", [
    {"debut": "12/12/2026"},
    {"debut": "2026-12-13", "fin": "2026-12-12"},
    {"nom": "  "},
])
def test_buddy_time_refuse(client, mauvais):
    g = nouveau_groupe()
    op = {**nouvelle_sortie(g["groupe"]), **mauvais}
    assert sync(client, ops=[g, op])["refus"]


def test_trace_refusee(client):
    g = nouveau_groupe()
    op = {"id": "t", "type": "partager_trace", "trace": str(uuid.uuid4()), "groupe": g["groupe"], "nom": "x", "ligne": [[1, 2]]}
    assert sync(client, ops=[g, op])["refus"]
    # Sortie d'un autre : invisible
    g = nouveau_groupe()
    so = nouvelle_sortie(g["groupe"])
    sync(client, ops=[g, so])
    op = {**op, "ligne": [[1, 2], [3, 4]], "groupe": None, "sortie": so["sortie"]}
    assert sync(client, sub="luc", ops=[op])["refus"]


# ------------------------------------------------------------------ bloc 3 : planning de saison

def nouveau_planning(gid, dates=(("2026-12-05", "2026-12-06"), ("2026-12-12", "2026-12-13"))):
    return {"id": str(uuid.uuid4()), "type": "creer_planning", "planning": str(uuid.uuid4()), "groupe": gid,
            "nom": "Saison ski 2026-27", "dates": [list(d) for d in dates], "limite": "2026-11-30"}


def dispo(pid, debut, etat, mot=""):
    return {"id": str(uuid.uuid4()), "type": "dispo", "planning": pid, "debut": debut, "etat": etat, "mot": mot}


def test_planning_de_saison(client):
    gid, julie = bande_avec_julie(client)
    op = nouveau_planning(gid)
    pid = op["planning"]
    r = sync(client, ops=[op, op, dispo(pid, "2026-12-05", "oui")])
    assert r["refus"] == [] and r["ids_plannings"] == [pid]
    p = r["plannings"][0]
    assert p["dates"] == [["2026-12-05", "2026-12-06"], ["2026-12-12", "2026-12-13"]] and p["limite"] == "2026-11-30"
    assert p["par"]["pseudo"] == "seb"
    # Julie le reçoit et répond ; elle change d'avis, puis efface.
    r = sync(client, sub="julie", ops=[dispo(pid, "2026-12-05", "peut", "Samedi seulement"), dispo(pid, "2026-12-12", "non"),
                                       dispo(pid, "2026-12-12", "oui"), dispo(pid, "2026-12-12", "")])
    assert r["refus"] == []
    d = {(x["qui"], x["debut"]): (x["etat"], x["mot"]) for x in r["plannings"][0]["dispos"]}
    assert d == {(r["moi"], "2026-12-05"): ("peut", "Samedi seulement"), (sync(client)["moi"], "2026-12-05"): ("oui", "")}
    # Seb reçoit le planning changé ; Luc, hors de la bande, ne le voit pas et ne peut pas répondre.
    assert sync(client, depuis=r["curseur"])["plannings"][0]["id"] == pid
    assert sync(client, sub="luc", ops=[dispo(pid, "2026-12-05", "oui")])["ids_plannings"] == []
    assert sync(client, sub="luc", ops=[dispo(pid, "2026-12-05", "oui")])["refus"]


@pytest.mark.parametrize("mauvais", [
    {"dates": []},
    {"dates": [["2026-12-06", "2026-12-05"]]},
    {"limite": "30/11"},
    {"nom": " "},
])
def test_planning_refuse(client, mauvais):
    gid, _ = bande_avec_julie(client)
    assert sync(client, ops=[{**nouveau_planning(gid), **mauvais}])["refus"]


def test_dispo_refusee(client):
    gid, _ = bande_avec_julie(client)
    op = nouveau_planning(gid)
    sync(client, ops=[op])
    assert sync(client, ops=[dispo(op["planning"], "2026-12-19", "oui")])["refus"]  # date hors planning
    assert sync(client, ops=[dispo(op["planning"], "2026-12-05", "bof")])["refus"]


# ------------------------------------------------------------------ bloc 4 : album

JPEG = b"\xff\xd8\xff\xe0" + b"x" * 100


def nouvelle_photo(sid, prise_le="2026-12-12T09:30:00", lon=6.7, lat=44.6):
    return {"id": str(uuid.uuid4()), "type": "ajouter_photo", "photo": str(uuid.uuid4()), "sortie": sid,
            "prise_le": prise_le, "lon": lon, "lat": lat}


@pytest.fixture()
def photos(tmp_path, monkeypatch):
    import buddies
    monkeypatch.setattr(buddies, "DOSSIER_PHOTOS", str(tmp_path / "photos"))
    monkeypatch.setattr(buddies, "DOSSIER_FICHIERS", str(tmp_path / "fichiers"))
    return tmp_path / "photos"


def test_album_deposer_voir_etoile_retirer(client, photos):
    gid, julie = bande_avec_julie(client)
    so = nouvelle_sortie(gid, participants=[julie])
    ph = nouvelle_photo(so["sortie"])
    r = sync(client, ops=[so, ph, ph])
    assert r["refus"] == [] and r["ids_photos"] == [ph["photo"]]
    p = r["photos"][0]
    assert p["par"]["pseudo"] == "seb" and p["lon"] == 6.7 and p["envoyee"] is False and p["etoile"] is False
    url = f"/buddies/photos/{ph['photo']}"
    # Le fichier : Julie ne peut pas l'envoyer à la place de Seb ; Seb l'envoie, Julie le lit.
    assert client.put(url + "/grande", content=JPEG, headers=entete(sub="julie")).status_code == 403
    assert client.get(url + "/petite", headers=entete(sub="julie")).status_code == 404  # pas encore arrivée
    assert client.put(url + "/petite", content=b"pas un jpeg", headers=entete(sub="seb")).status_code == 422
    assert client.put(url + "/petite", content=JPEG, headers=entete(sub="seb")).status_code == 200
    assert client.put(url + "/grande", content=JPEG, headers=entete(sub="seb")).status_code == 200
    lu = client.get(url + "/grande", headers=entete(sub="julie"))
    assert lu.status_code == 200 and lu.content == JPEG
    assert client.get(url + "/grande", headers=entete(sub="luc")).status_code == 404  # hors de la sortie
    # Julie met une ⭐ ; elle ne peut pas retirer la photo de Seb.
    r = sync(client, sub="julie", ops=[{"id": "e", "type": "etoile", "photo": ph["photo"], "etoile": True},
                                       {"id": "x", "type": "retirer_photo", "photo": ph["photo"]}])
    assert len(r["refus"]) == 1 and r["photos"][0]["etoile"] is True and r["photos"][0]["envoyee"] is True
    # 📍 Julie replace la photo sur la carte ; une position impossible est refusée.
    r = sync(client, sub="julie", ops=[{"id": "p1", "type": "placer_photo", "photo": ph["photo"], "lon": 6.36, "lat": 45.04},
                                       {"id": "p2", "type": "placer_photo", "photo": ph["photo"], "lon": 600, "lat": 45}])
    assert len(r["refus"]) == 1 and r["photos"][0]["lon"] == 6.36 and r["photos"][0]["lat"] == 45.04
    # Seb la retire : fichiers effacés, plus dans l'album.
    r = sync(client, ops=[{"id": "y", "type": "retirer_photo", "photo": ph["photo"]}])
    assert r["ids_photos"] == [] and list(photos.iterdir()) == []


MP4 = b"\x00\x00\x00\x18ftypmp42" + b"v" * 100


def test_album_film_du_survol(client, photos):
    """🎥 Film d'un survol 3D rangé dans l'album : couverture JPEG (petite, grande) + le film ; arrivé quand le film l'est."""
    gid, julie = bande_avec_julie(client)
    so = nouvelle_sortie(gid, participants=[julie])
    film = {**nouvelle_photo(so["sortie"]), "video": True}
    r = sync(client, ops=[so, film])
    assert r["refus"] == [] and r["photos"][0]["video"] is True
    url = f"/buddies/photos/{film['photo']}"
    assert client.put(url + "/video", content=JPEG, headers=entete(sub="seb")).status_code == 422  # pas un film
    for t in ("petite", "grande"):
        assert client.put(url + f"/{t}", content=JPEG, headers=entete(sub="seb")).status_code == 200
    assert sync(client, sub="julie")["photos"][0]["envoyee"] is False  # la couverture seule ne suffit pas
    assert client.put(url + "/video", content=MP4, headers=entete(sub="seb")).status_code == 200
    lu = client.get(url + "/video", headers=entete(sub="julie"))
    assert lu.status_code == 200 and lu.content == MP4 and lu.headers["content-type"] == "video/mp4"
    assert sync(client, sub="julie")["photos"][0]["envoyee"] is True
    # Une photo ordinaire n'accepte pas de film.
    ph = nouvelle_photo(so["sortie"])
    sync(client, ops=[ph])
    assert client.put(f"/buddies/photos/{ph['photo']}/video", content=MP4, headers=entete(sub="seb")).status_code == 422
    # Retirer le film efface aussi la vidéo.
    sync(client, ops=[{"id": "z", "type": "retirer_photo", "photo": film["photo"]}])
    assert not any(f.name.startswith(film["photo"]) for f in photos.iterdir())


def test_photo_refusee(client, photos):
    g = nouveau_groupe()
    so = nouvelle_sortie(g["groupe"])
    sync(client, ops=[g, so])
    assert sync(client, ops=[nouvelle_photo(so["sortie"], prise_le="hier")])["refus"]
    assert sync(client, sub="luc", ops=[nouvelle_photo(so["sortie"])])["refus"]  # Sortie d'un autre
    # Sans position (photo sans GPS) : acceptée.
    assert sync(client, ops=[nouvelle_photo(so["sortie"], lon=None, lat=None)])["photos"][0]["lon"] is None


# ------------------------------------------------------------------ bloc 5 : carnet

def op(type_=None, **k):
    return {"id": str(uuid.uuid4()), **({"type": type_} if type_ else {}), **k}


def test_carnet_recits_fiches_conditions(client):
    gid, julie = bande_avec_julie(client)
    so = nouvelle_sortie(gid, participants=[julie])
    sid = so["sortie"]
    r = sync(client, ops=[so, op("recit", sortie=sid, texte="  Départ à la frontale de Castello.  "),
                          op("fiche", sortie=sid, jour="2026-12-12", nom="Castello → refuge", depart="07:10", duree=320, distance=11000,
                             denivele=1240),
                          op("carnet", sortie=sid, difficulte="T3", meteo="☀️ 4°", conditions="Lac gelé sur les bords")])
    assert r["refus"] == []
    seb = r["moi"]
    c = r["sorties"][0]["carnet"]
    assert c["recits"][0]["texte"] == "Départ à la frontale de Castello." and c["recits"][0]["par"]["id"] == seb
    assert c["fiches"] == [{"jour": "2026-12-12", "nom": "Castello → refuge", "depart": "07:10", "duree": 320, "distance": 11000,
                            "denivele": 1240}]
    assert (c["difficulte"], c["meteo"], c["conditions"]) == ("T3", "☀️ 4°", "Lac gelé sur les bords")
    # Julie ajoute son texte, signé ; elle le voit dans la synchro suivante (la sortie a bougé).
    curseur = sync(client, sub="julie")["curseur"]
    r = sync(client, sub="julie", ops=[op("recit", sortie=sid, texte="Polenta et génépi.")], depuis=curseur)
    assert [x["par"]["id"] for x in r["sorties"][0]["carnet"]["recits"]] == [seb, julie]
    # Seb corrige le sien (le dernier envoyé gagne), puis efface la fiche (tout vide).
    r = sync(client, ops=[op("recit", sortie=sid, texte="Départ à 6 h."), op("fiche", sortie=sid, jour="2026-12-12")])
    c = r["sorties"][0]["carnet"]
    assert {x["par"]["id"]: x["texte"] for x in c["recits"]} == {seb: "Départ à 6 h.", julie: "Polenta et génépi."}
    assert c["fiches"] == []
    # Un texte vide efface le mien seulement.
    c = sync(client, ops=[op("recit", sortie=sid, texte="")])["sorties"][0]["carnet"]
    assert [x["par"]["id"] for x in c["recits"]] == [julie]


@pytest.mark.parametrize("mauvais", [
    {"type": "fiche", "jour": "2026-12-14", "nom": "après"},  # hors des dates
    {"type": "fiche", "jour": "2026-12-12", "depart": "7h10"},
    {"type": "fiche", "jour": "2026-12-12", "duree": -5},
    {"type": "fiche", "jour": "2026-12-12", "distance": "loin"},
])
def test_fiche_refusee(client, mauvais):
    g = nouveau_groupe()
    so = nouvelle_sortie(g["groupe"])
    sync(client, ops=[g, so])
    assert sync(client, ops=[op(sortie=so["sortie"], **mauvais)])["refus"]


def test_carnet_d_un_autre_refuse(client):
    g = nouveau_groupe()
    so = nouvelle_sortie(g["groupe"])
    sync(client, ops=[g, so])
    for o in (op("recit", sortie=so["sortie"], texte="intrus"), op("carnet", sortie=so["sortie"], meteo="pluie")):
        assert sync(client, sub="luc", ops=[o])["refus"]
    c = sync(client)["sorties"][0]["carnet"]
    assert c["recits"] == [] and c["meteo"] == ""


# ------------------------------------------------------------------ bloc 6 : Buddy count partagé

def nouvelle_depense(sid, paye_par, pour, montant=24000, titre="Gîte Les Baladins", jour="2026-12-12", did=None):
    return op("depense", depense=did or str(uuid.uuid4()), sortie=sid, titre=titre, montant=montant, paye_par=paye_par, pour=list(pour), jour=jour)


def test_buddy_count_partage_entre_telephones(client):
    gid, julie = bande_avec_julie(client)
    so = nouvelle_sortie(gid, participants=[julie])
    seb = sync(client, ops=[so])["moi"]
    gite = nouvelle_depense(so["sortie"], seb, [seb, julie])
    r = sync(client, ops=[gite, gite])  # renvoyée : une seule dépense
    assert r["refus"] == [] and r["ids_depenses"] == [gite["depense"]]
    assert r["depenses"][0]["montant"] == 24000 and sorted(r["depenses"][0]["pour"]) == sorted([seb, julie])
    # Julie la voit, la corrige (dernière version gagne) et ajoute l'essence qu'elle a payée.
    essence = nouvelle_depense(so["sortie"], julie, [seb, julie], montant=12500, titre="Essence + péage")
    r = sync(client, sub="julie", ops=[{**gite, "id": "c", "montant": 25000}, essence])
    assert r["refus"] == []
    assert {d["titre"]: d["montant"] for d in r["depenses"]} == {"Gîte Les Baladins": 25000, "Essence + péage": 12500}
    # Seb retire l'essence ; Luc (hors de la sortie) ne voit rien et ne peut rien ajouter.
    r = sync(client, ops=[op("retirer_depense", depense=essence["depense"])])
    assert r["ids_depenses"] == [gite["depense"]]
    assert sync(client, sub="luc")["ids_depenses"] == []
    assert sync(client, sub="luc", ops=[nouvelle_depense(so["sortie"], seb, [seb])])["refus"]


def test_depense_refusee(client):
    gid, julie = bande_avec_julie(client)
    so = nouvelle_sortie(gid)  # Julie ne part pas
    seb = sync(client, ops=[so])["moi"]
    for mauvaise in (nouvelle_depense(so["sortie"], seb, [seb, julie]), nouvelle_depense(so["sortie"], julie, [seb]),
                     nouvelle_depense(so["sortie"], seb, []), nouvelle_depense(so["sortie"], seb, [seb], montant=0),
                     nouvelle_depense(so["sortie"], seb, [seb], jour="demain")):
        assert sync(client, ops=[mauvaise])["refus"], mauvaise


T0 = 1_797_000_000_000  # un matin pendant la sortie (ms)


def test_position_des_buddies_avec_l_epingle(client):
    gid, julie = bande_avec_julie(client)
    so = nouvelle_sortie(gid, participants=[julie])
    seb = sync(client, ops=[so])["moi"]
    sid = so["sortie"]
    # Sans épingle : la position est ignorée, personne n'apparaît.
    r = sync(client, ops=[op("position", sortie=sid, lat=44.6, lon=6.7, alt=2310.4, prise_le=T0)])
    assert r["refus"] == [] and r["positions"] == []
    # Seb enfonce l'épingle jusqu'à ce soir : sa position (gardée hors ligne, renvoyée deux fois) arrive chez Julie.
    pos = op("position", sortie=sid, lat=44.61, lon=6.71, alt=2310.4, prise_le=T0 + 60_000)
    r = sync(client, ops=[op("epingle", sortie=sid, enfoncee=True, quand=T0, jusqu=T0 + 10 * 3600_000), pos, pos,
                          op("position", sortie=sid, lat=1, lon=1, prise_le=T0 + 30_000)])  # plus ancienne : ignorée
    assert r["refus"] == []
    p, = sync(client, sub="julie")["positions"]
    assert (p["qui"], p["lat"], p["lon"], p["alt"], p["prise_le"]) == (seb, 44.61, 6.71, 2310, T0 + 60_000)
    # Seb relève l'épingle : la dernière position reste (grisée chez les autres), les suivantes sont ignorées.
    sync(client, ops=[op("epingle", sortie=sid, enfoncee=False, quand=T0 + 120_000),
                      op("position", sortie=sid, lat=44.7, lon=6.8, prise_le=T0 + 3600_000)])
    p, = sync(client, sub="julie")["positions"]
    assert p["jusqu"] == T0 + 120_000 and p["lat"] == 44.61
    # Luc, hors de la sortie, ne voit rien et ne peut pas s'épingler.
    assert sync(client, sub="luc")["positions"] == []
    assert sync(client, sub="luc", ops=[op("epingle", sortie=sid, enfoncee=True, quand=T0, jusqu=T0 + 1000)])["refus"]


def test_epingle_limitee_a_un_jour(client):
    gid, julie = bande_avec_julie(client)
    so = nouvelle_sortie(gid, participants=[julie])
    sync(client, ops=[so])
    r = sync(client, ops=[op("epingle", sortie=so["sortie"], enfoncee=True, quand=T0, jusqu=T0 + 5 * 24 * 3600_000)])
    assert r["positions"][0]["jusqu"] == T0 + 24 * 3600_000
    assert sync(client, ops=[op("epingle", sortie=so["sortie"], enfoncee=True, quand=T0, jusqu=T0 - 1)])["refus"]


def test_position_partagee_avec_un_buddy_group_hors_buddy_time(client):
    gid, julie = bande_avec_julie(client)
    seb = sync(client)["moi"]
    # 📍 de la colonne : Seb s'épingle dans le groupe, sans sortie ; Julie le voit.
    r = sync(client, ops=[op("epingle", groupe=gid, enfoncee=True, quand=T0, jusqu=T0 + 3600_000),
                          op("position", groupe=gid, lat=44.61, lon=6.71, alt=1500, prise_le=T0 + 60_000)])
    assert r["refus"] == []
    p, = sync(client, sub="julie")["positions"]
    assert (p["groupe"], p["qui"], p["lat"], p["prise_le"]) == (gid, seb, 44.61, T0 + 60_000) and "sortie" not in p
    # Relevée : la dernière reste, les suivantes sont ignorées.
    sync(client, ops=[op("epingle", groupe=gid, enfoncee=False, quand=T0 + 120_000),
                      op("position", groupe=gid, lat=45, lon=7, prise_le=T0 + 600_000)])
    p, = sync(client, sub="julie")["positions"]
    assert p["jusqu"] == T0 + 120_000 and p["lat"] == 44.61
    # Luc, hors du groupe, ne voit rien et ne peut pas s'y épingler.
    assert sync(client, sub="luc")["positions"] == []
    assert sync(client, sub="luc", ops=[op("epingle", groupe=gid, enfoncee=True, quand=T0, jusqu=T0 + 1000)])["refus"]


def nouvel_hebergement(sid, nom="Gîte Les Baladins", **k):
    champs = {"nature": "gîte", "prix_nuit": 59.6, "adresse": "Ceillac", "url": "https://exemple.fr/gite", "resume": "demi-pension",
              "lon": 6.78, "lat": 44.66, **k}
    return op("proposer_hebergement", hebergement=str(uuid.uuid4()), sortie=sid, nom=nom, **champs)


def test_hebergement_propose_coeurs_et_retenu(client):
    gid, julie = bande_avec_julie(client)
    so = nouvelle_sortie(gid, participants=[julie])
    seb = sync(client, ops=[so])["moi"]
    gite, refuge = nouvel_hebergement(so["sortie"]), nouvel_hebergement(so["sortie"], nom="Refuge de la Cime", lon=None, lat=None)
    r = sync(client, ops=[gite, gite, refuge, op("coeur", hebergement=gite["hebergement"], coeur=True)])
    assert r["refus"] == [] and r["ids_hebergements"] == [gite["hebergement"], refuge["hebergement"]]
    h = r["hebergements"][0]
    assert (h["nom"], h["prix_nuit"], h["coeurs"], h["retenu"], h["lon"]) == ("Gîte Les Baladins", 60, [seb], False, 6.78)
    # Julie met un ♥ au refuge et le retient ; puis elle retient le gîte : un seul retenu.
    r = sync(client, sub="julie", ops=[op("coeur", hebergement=refuge["hebergement"], coeur=True),
                                       op("retenir_hebergement", hebergement=refuge["hebergement"], retenu=True),
                                       op("retenir_hebergement", hebergement=gite["hebergement"], retenu=True)])
    assert r["refus"] == []
    assert {x["nom"]: (x["retenu"], len(x["coeurs"])) for x in r["hebergements"]} == {"Gîte Les Baladins": (True, 1), "Refuge de la Cime": (False, 1)}
    # Seb retire son ♥ et le refuge ; Luc (hors de la sortie) ne voit rien et ne peut rien faire.
    r = sync(client, ops=[op("coeur", hebergement=gite["hebergement"], coeur=False), op("retirer_hebergement", hebergement=refuge["hebergement"])])
    assert r["ids_hebergements"] == [gite["hebergement"]]
    assert sync(client, sub="luc")["ids_hebergements"] == []
    assert sync(client, sub="luc", ops=[op("coeur", hebergement=gite["hebergement"], coeur=True)])["refus"]
    assert sync(client, sub="luc", ops=[nouvel_hebergement(so["sortie"])])["refus"]


def test_hebergement_refuse(client):
    gid, julie = bande_avec_julie(client)
    so = nouvelle_sortie(gid, participants=[julie])
    sync(client, ops=[so])
    for mauvais in (nouvel_hebergement(so["sortie"], url="javascript:alert(1)"), nouvel_hebergement(so["sortie"], lat=None),
                    nouvel_hebergement(so["sortie"], prix_nuit=-5)):
        assert sync(client, ops=[mauvais])["refus"], mauvais


# ------------------------------------------------------------------ bloc 9 : messagerie

def nouveau_message(groupe=None, sortie=None, texte="On part à 7 h ?", **autres):
    op = {"id": str(uuid.uuid4()), "type": "message", "message": str(uuid.uuid4()), "nature": "texte", "texte": texte}
    op.update({"groupe": groupe} if groupe else {"sortie": sortie})
    op.update(autres)
    return op


def test_messages_dans_un_groupe_et_un_buddy_time(client, photos):
    gid, julie = bande_avec_julie(client)
    so = nouvelle_sortie(gid, participants=[julie])
    ph = nouvelle_photo(so["sortie"])
    m1 = nouveau_message(groupe=gid)
    m2 = nouveau_message(sortie=so["sortie"], nature="point", texte="", lon=6.71234567, lat=44.6)
    m3 = nouveau_message(sortie=so["sortie"], nature="photo", texte="", photo=ph["photo"])
    r = sync(client, ops=[so, ph, m1, m1, m2, m3])  # m1 renvoyé : un seul
    assert r["refus"] == [] and r["ids_messages"] == [m1["message"], m2["message"], m3["message"]]
    point = next(m for m in r["messages"] if m["nature"] == "point")
    assert point["sortie"] == so["sortie"] and point["lon"] == 6.712346 and point["par"] == r["moi"]
    # Julie les voit et répond ; Luc (hors du groupe) ne voit rien.
    rj = sync(client, sub="julie", ops=[nouveau_message(groupe=gid, texte="Ok pour moi")])
    assert len(rj["ids_messages"]) == 4 and rj["messages"][-1]["par"] == julie
    assert sync(client, sub="luc")["ids_messages"] == []
    # Julie ne supprime pas le message de l'admin ; lui, oui : la bulle reste, « Ce message a été supprimé ».
    assert sync(client, sub="julie", ops=[{"id": "x", "type": "retirer_message", "message": m1["message"]}])["refus"]
    r = sync(client, ops=[{"id": "y", "type": "retirer_message", "message": m1["message"]}])
    m = next(m for m in r["messages"] if m["id"] == m1["message"])
    assert m["supprime"] and m["texte"] == ""


def test_message_refuse(client, photos):
    gid, julie = bande_avec_julie(client)
    so = nouvelle_sortie(gid, participants=[julie])
    sync(client, ops=[so])
    for mauvais in (nouveau_message(groupe=gid, texte="  "), nouveau_message(groupe=gid, nature="son"),
                    nouveau_message(groupe=gid, nature="point", lat=95, lon=6),
                    nouveau_message(groupe=gid, nature="photo", photo=str(uuid.uuid4())),
                    nouveau_message(groupe=str(uuid.uuid4()))):
        assert sync(client, ops=[mauvais])["refus"], mauvais
    assert sync(client, sub="luc", ops=[nouveau_message(sortie=so["sortie"])])["refus"]


def test_reponse_de_bud(client, photos):
    gid, julie = bande_avec_julie(client)
    question = nouveau_message(groupe=gid, texte="Bud, quel week-end ?")
    reponse = nouveau_message(groupe=gid, texte="Le 14, vous êtes 4.", bud=True)
    r = sync(client, ops=[question, reponse])
    assert r["refus"] == []
    assert [m["bud"] for m in r["messages"]] == [False, True]


def test_repondre_modifier_supprimer_reagir(client, photos):
    """Comme la messagerie d'AppBase (§5.6) : répondre, modifier 15 min, supprimer chez tous, réagir, coches."""
    gid, julie = bande_avec_julie(client)
    m1 = nouveau_message(groupe=gid, texte="On part à 7 h ?")
    r = sync(client, ops=[m1])
    moi = r["moi"]
    rep = {**nouveau_message(groupe=gid, texte="Plutôt 6 h"), "repond_a": m1["message"]}
    ailleurs = {**nouveau_message(groupe=gid, texte="?"), "repond_a": str(uuid.uuid4())}
    rj = sync(client, sub="julie", ops=[rep, ailleurs,
                                         {"id": "r", "type": "reagir", "message": m1["message"], "emoji": "👍"},
                                         {"id": "r2", "type": "reagir", "message": m1["message"], "emoji": "❤️"},  # remplace
                                         {"id": "m", "type": "modifier_message", "message": m1["message"], "texte": "pirate"}])
    assert len(rj["refus"]) == 1  # Julie ne modifie pas mon message
    par_id = {m["id"]: m for m in rj["messages"]}
    assert par_id[rep["message"]]["repond_a"] == m1["message"] and par_id[ailleurs["message"]]["repond_a"] is None
    assert par_id[m1["message"]]["reactions"] == [{"qui": julie, "emoji": "❤️"}]
    # Je corrige mon message ; Julie retire sa réaction ; elle a lu jusqu'à sa réponse.
    sync(client, sub="julie", ops=[{"id": "r3", "type": "reagir", "message": m1["message"], "emoji": ""},
                                   {"id": "l", "type": "lu", "cle": gid, "jusqu": par_id[rep["message"]]["cree_le"]}])
    r = sync(client, ops=[{"id": "e", "type": "modifier_message", "message": m1["message"], "texte": "On part à 6 h 30 ?"}])
    m = next(m for m in r["messages"] if m["id"] == m1["message"])
    assert m["texte"] == "On part à 6 h 30 ?" and m["edite"] and m["reactions"] == []
    lj = next(x for x in r["lectures"] if x["qui"] == julie)
    assert lj["lus"][gid] == par_id[rep["message"]]["cree_le"] and lj["vu_le"]
    assert all(x["qui"] != moi for x in r["lectures"])
    # Plus de 15 minutes après : plus modifiable.
    import modeles
    from datetime import timedelta
    import serveur
    with serveur.Sessions() as s:
        x = s.get(modeles.MessageBuddy, uuid.UUID(m1["message"]))
        x.cree_le = x.cree_le - timedelta(minutes=16)
        s.commit()
    assert sync(client, ops=[{"id": "t", "type": "modifier_message", "message": m1["message"], "texte": "trop tard"}])["refus"]
    # L'admin du groupe supprime le message de Julie (modération).
    r = sync(client, ops=[{"id": "s", "type": "retirer_message", "message": rep["message"]}])
    assert r["refus"] == [] and next(m for m in r["messages"] if m["id"] == rep["message"])["supprime"]


def test_discussion_a_deux(client, photos):
    """Comme AppBase : toujours la même discussion pour deux buddies ; seulement entre buddies d'une même bande."""
    gid, julie = bande_avec_julie(client)
    moi = sync(client)["moi"]
    r = sync(client, ops=[{"id": "d", "type": "duo", "buddy": julie}] * 2)
    duos = [g for g in r["groupes"] if g["nature"] == "duo"]
    assert r["refus"] == [] and len(duos) == 1 and {m["id"] for m in duos[0]["membres"]} == {moi, julie}
    rj = sync(client, sub="julie", ops=[{"id": "d", "type": "duo", "buddy": moi}])
    assert [g["id"] for g in rj["groupes"] if g["nature"] == "duo"] == [duos[0]["id"]]
    sync(client, sub="luc")
    luc = sync(client, sub="luc")["moi"]
    assert sync(client, ops=[{"id": "l", "type": "duo", "buddy": luc}])["refus"]
    # « écrit… » : Julie tape, je le vois ; Luc ne peut pas écrire dans notre discussion.
    assert client.post("/buddies/ecrit", headers=entete(sub="julie"), json={"cle": duos[0]["id"]}).status_code == 200
    assert sync(client)["ecrivent"] == [{"cle": duos[0]["id"], "qui": julie}]
    assert sync(client, sub="julie")["ecrivent"] == []
    assert client.post("/buddies/ecrit", headers=entete(sub="luc"), json={"cle": duos[0]["id"]}).status_code == 404


def test_sondage_fichier_transferer(client, photos):
    """Étape 3 (§7.13) : sondage (voter, changer d'avis), fichier envoyé puis lu, transféré dans une autre conversation."""
    gid, julie = bande_avec_julie(client)
    autre = nouveau_groupe("Escalade")
    sondage = {**nouveau_message(groupe=gid, nature="sondage", texte=""),
               "sondage": {"question": "Samedi ?", "options": ["Belledonne", " belledonne ", "Chartreuse", ""], "multiple": False}}
    doc = str(uuid.uuid4())
    fichier = {**nouveau_message(groupe=gid, nature="fichier", texte="Le topo"),
               "fichier": {"id": doc, "nom": "topo.pdf", "mime": "application/pdf", "taille": 5}}
    trop = {**nouveau_message(groupe=gid, nature="fichier", texte=""),
            "fichier": {"id": str(uuid.uuid4()), "nom": "film.mov", "mime": "video/quicktime", "taille": 200 * 1024 * 1024}}
    r = sync(client, ops=[autre, sondage, fichier, trop, {**nouveau_message(groupe=gid, nature="sondage", texte=""), "sondage": {"question": "?", "options": ["a"]}}])
    assert len(r["refus"]) == 2
    sd = next(m for m in r["messages"] if m["id"] == sondage["message"])["sondage"]
    assert sd == {"question": "Samedi ?", "multiple": False, "options": ["Belledonne", "Chartreuse"], "votes": []}
    # Julie vote, change d'avis ; deux réponses : refusé (une seule permise).
    rj = sync(client, sub="julie", ops=[{"id": "v", "type": "voter", "message": sondage["message"], "options": [0]},
                                         {"id": "v2", "type": "voter", "message": sondage["message"], "options": [1]},
                                         {"id": "v3", "type": "voter", "message": sondage["message"], "options": [0, 1]}])
    assert len(rj["refus"]) == 1
    assert next(m for m in rj["messages"] if m["id"] == sondage["message"])["sondage"]["votes"] == [{"qui": julie, "option": 1}]
    # Le fichier : Julie ne peut pas l'envoyer à ma place ; moi, oui (pas plus gros qu'annoncé) ; elle le lit.
    assert client.put(f"/buddies/fichiers/{doc}", headers=entete(sub="julie"), content=b"%PDF-").status_code == 403
    assert client.put(f"/buddies/fichiers/{doc}", headers=entete(sub="seb"), content=b"%PDF-trop").status_code == 413
    assert client.put(f"/buddies/fichiers/{doc}", headers=entete(sub="seb"), content=b"%PDF-").status_code == 200
    lu = client.get(f"/buddies/fichiers/{doc}", headers=entete(sub="julie"))
    assert lu.status_code == 200 and lu.content == b"%PDF-" and lu.headers["content-type"] == "application/pdf"
    assert next(m for m in sync(client)["messages"] if m["id"] == fichier["message"])["fichier"]["envoye"] is True
    # Luc ne le lit pas ; je le transfère dans « Escalade » (Julie n'y est pas : elle le lit toujours par l'autre).
    assert client.get(f"/buddies/fichiers/{doc}", headers=entete(sub="luc")).status_code == 404
    tr = {**nouveau_message(groupe=autre["groupe"], nature="fichier", texte="Le topo"), "fichier": {"id": doc}, "transfere": True}
    r = sync(client, ops=[tr])
    m = next(m for m in r["messages"] if m["id"] == tr["message"])
    assert r["refus"] == [] and m["transfere"] and m["fichier"]["nom"] == "topo.pdf"
    # Julie ne peut pas transférer un fichier qu'elle ne voit pas.
    assert sync(client, sub="luc", ops=[{**nouveau_message(groupe="me-time", nature="fichier"), "fichier": {"id": doc}}])["refus"]


def test_annuler_un_buddy_time(client, photos):
    gid, julie = bande_avec_julie(client)
    so = nouvelle_sortie(gid, participants=[julie])
    r = sync(client, ops=[so])
    assert so["sortie"] in r["ids_sorties"]
    # Julie ne peut pas l'annuler ; celui qui l'a créé, oui (et rejouer ne change rien).
    assert sync(client, sub="julie", ops=[{"id": "a", "type": "retirer_sortie", "sortie": so["sortie"]}])["refus"]
    r = sync(client, ops=[{"id": "b", "type": "retirer_sortie", "sortie": so["sortie"]}] * 2)
    assert r["refus"] == [] and so["sortie"] not in r["ids_sorties"]
    # Une sortie qui a déjà servi reste.
    so2 = nouvelle_sortie(gid)
    sync(client, ops=[so2, nouveau_message(sortie=so2["sortie"])])
    assert sync(client, ops=[{"id": "c", "type": "retirer_sortie", "sortie": so2["sortie"]}])["refus"]


def test_bud_supprime_un_buddy_time(client, photos):
    """§7.12 : supprimer une sortie qui a déjà servi (caché de tous), puis « Annuler » le remet avec son contenu."""
    gid, julie = bande_avec_julie(client)
    so = nouvelle_sortie(gid, participants=[julie])
    msg = nouveau_message(sortie=so["sortie"])
    sync(client, ops=[so, msg])
    sup = {"id": "s", "type": "supprimer_sortie", "sortie": so["sortie"]}
    # Julie n'est ni la créatrice ni admin : refusé.
    assert sync(client, sub="julie", ops=[sup])["refus"]
    r = sync(client, ops=[sup, sup])
    assert r["refus"] == [] and so["sortie"] not in r["ids_sorties"]
    assert so["sortie"] not in sync(client, sub="julie")["ids_sorties"]
    # Plus rien ne s'y ajoute tant qu'il est supprimé.
    assert sync(client, ops=[nouveau_message(sortie=so["sortie"])])["refus"]
    r = sync(client, ops=[{"id": "r", "type": "remettre_sortie", "sortie": so["sortie"]}])
    assert r["refus"] == [] and so["sortie"] in r["ids_sorties"]
    assert any(m["id"] == msg["message"] for m in r["messages"])
    assert so["sortie"] in sync(client, sub="julie")["ids_sorties"]


def test_renommer_un_buddy_group(client):
    gid, julie = bande_avec_julie(client)
    assert sync(client, sub="julie", ops=[{"id": "v", "type": "renommer_groupe", "groupe": gid, "nom": " "}])["refus"]
    sync(client, sub="julie", ops=[{"id": "n", "type": "renommer_groupe", "groupe": gid, "nom": "La Ciotat  ski club"}])
    assert next(g for g in sync(client)["groupes"] if g["id"] == gid)["nom"] == "La Ciotat ski club"
    assert sync(client, sub="luc", ops=[{"id": "l", "type": "renommer_groupe", "groupe": gid, "nom": "Pirate"}])["refus"]


def test_renommer_un_buddy_time(client):
    gid, julie = bande_avec_julie(client)
    so = nouvelle_sortie(gid, participants=[julie])
    sync(client, ops=[so])
    # Un participant peut changer le nom ; vide : refusé.
    assert sync(client, sub="julie", ops=[{"id": "v", "type": "renommer_sortie", "sortie": so["sortie"], "nom": "  "}])["refus"]
    r = sync(client, sub="julie", ops=[{"id": "n", "type": "renommer_sortie", "sortie": so["sortie"], "nom": " Raquettes  au Queyras "}])
    assert r["refus"] == []
    assert next(x for x in sync(client)["sorties"] if x["id"] == so["sortie"])["nom"] == "Raquettes au Queyras"
    # Quelqu'un qui ne le voit pas : refusé.
    assert sync(client, sub="luc", ops=[{"id": "l", "type": "renommer_sortie", "sortie": so["sortie"], "nom": "Pirate"}])["refus"]


def test_notification_des_nouveaux_messages(client, monkeypatch):
    """Étape 4 (§7.13) : un nouveau message prévient les autres (pas l'auteur), une seule fois, même renvoyé."""
    import appels
    envois = []
    monkeypatch.setattr(appels, "sonner", lambda _S, qui, data, ttl="45s": envois.append((sorted(map(str, qui)), data, ttl)))
    gid, julie = bande_avec_julie(client)
    moi = sync(client)["moi"]
    envois.clear()
    m = nouveau_message(groupe=gid, texte="On part à 7 h ?")
    sync(client, ops=[m])
    sync(client, ops=[m])  # renvoyé (réseau coupé avant la réponse) : pas de deuxième notification
    assert len(envois) == 1
    qui, data, ttl = envois[0]
    assert qui == [julie] and ttl == "86400s"
    assert {k: data[k] for k in ("type", "cle", "groupe", "sortie", "titre", "de", "texte", "duo")} == {
        "type": "message", "cle": gid, "groupe": gid, "sortie": "", "titre": "Ski du dimanche", "de": "seb", "texte": "On part à 7 h ?", "duo": ""}
    # À deux : le titre est le nom de l'auteur.
    duo = next(g for g in sync(client, sub="julie", ops=[{"id": "d", "type": "duo", "buddy": moi}])["groupes"] if g["nature"] == "duo")
    envois.clear()
    sync(client, sub="julie", ops=[nouveau_message(groupe=duo["id"], nature="point", texte="", lon=6.8, lat=44.6)])
    assert envois[0][0] == [moi] and envois[0][1]["titre"] == envois[0][1]["de"] and envois[0][1]["duo"] == "1"
    assert envois[0][1]["texte"] == "📍 est ici"


def test_iban_et_wero_seulement_pour_qui_doit(client):
    """Seb, 26/11 : l'IBAN et le Wero de Julie ne vont qu'aux buddies de la sortie qui lui doivent de l'argent."""
    gid, julie = bande_avec_julie(client)
    so = nouvelle_sortie(gid, participants=[julie])
    seb = sync(client, ops=[so])["moi"]
    client.put("/moi", headers=entete(sub="julie"), json={"iban": "FR76 3000 6000 0112 3456 7890 189", "wero": True,
                                                           "telephone": "06 11 22 33 44"})
    assert sync(client)["paiements"] == {}  # pas encore de dépense
    sync(client, sub="julie", ops=[nouvelle_depense(so["sortie"], julie, [seb, julie])])
    p = sync(client)["paiements"]
    assert p == {so["sortie"]: {julie: {"iban": "FR7630006000011234567890189", "wero": "06 11 22 33 44"}}}
    assert sync(client, sub="julie")["paiements"] == {}  # Julie ne doit rien
    assert sync(client, sub="luc")["paiements"] == {}  # pas de la sortie
    # Numéro Wero différent du portable ; sans la case, plus de Wero.
    client.put("/moi", headers=entete(sub="julie"), json={"wero_numero": "julie@exemple.fr"})
    assert sync(client)["paiements"][so["sortie"]][julie]["wero"] == "julie@exemple.fr"
    client.put("/moi", headers=entete(sub="julie"), json={"wero": False})
    assert "wero" not in sync(client)["paiements"][so["sortie"]][julie]
    # Une fois remboursée (dépense inverse), Seb ne voit plus rien.
    sync(client, ops=[nouvelle_depense(so["sortie"], seb, [julie], montant=12000, titre="Remboursement")])
    assert sync(client)["paiements"] == {}


def test_voiture_garee_vue_par_les_buddies(client):
    gid, julie = bande_avec_julie(client)
    seb = sync(client)["moi"]
    v = op("voiture", garee=True, lat=44.61, lon=6.71, garee_le=T0, jusqu=T0 + 5 * 24 * 3600_000)
    assert sync(client, ops=[v, v])["refus"] == []
    w, = sync(client, sub="julie")["voitures"]
    assert (w["qui"], w["lat"], w["lon"], w["garee_le"], w["jusqu"]) == (seb, 44.61, 6.71, T0, T0 + 24 * 3600_000)
    assert sync(client, sub="luc")["voitures"] == []  # pas dans mes groupes
    # Enlevée : elle reste dans la liste, finie (le téléphone ne la montre plus).
    sync(client, ops=[op("voiture", garee=False, quand=T0 + 60_000)])
    w, = sync(client, sub="julie")["voitures"]
    assert w["jusqu"] == T0 + 60_000


def test_buddy_count_de_groupe_ferme_et_supprime(client):
    gid, julie = bande_avec_julie(client)
    seb = sync(client)["moi"]
    cid = str(uuid.uuid4())
    assert sync(client, ops=[op("buddy_count", count=cid, groupe=gid, nom="Cagnotte saison")])["refus"] == []
    d = op("depense", depense=str(uuid.uuid4()), count=cid, titre="Minibus", montant=34000, paye_par=seb, pour=[seb, julie], jour="2026-11-26")
    assert sync(client, ops=[d])["refus"] == []
    r = sync(client, sub="julie")
    c, = r["counts"]
    assert (c["groupe"], c["nom"], c["ferme"], c["supprime"]) == (gid, "Cagnotte saison", False, False)
    x, = r["depenses"]
    assert (x["count"], x["sortie"], x["montant"]) == (cid, None, 34000)
    # Julie doit 170 € à Seb : elle voit comment le rembourser si Seb a renseigné son IBAN (rien ici).
    assert r["paiements"] == {}
    # Supprimé : seulement un admin (Julie est membre, Seb admin).
    assert sync(client, sub="julie", ops=[op("buddy_count", count=cid, supprime=True)])["refus"]
    assert sync(client, ops=[op("buddy_count", count=cid, supprime=True)])["refus"] == []
    assert sync(client, sub="julie")["counts"][0]["supprime"] is True
    assert sync(client, sub="luc")["counts"] == []


def test_buddy_count_ferme_par_un_ancien_telephone_reste_ouvert(client):
    """Seb, 26 novembre : plus d'ouvert/fermé ; un Buddy count fermé avant (ou par un vieux téléphone) prend toujours des dépenses."""
    gid, julie = bande_avec_julie(client)
    so = nouvelle_sortie(gid, participants=[julie])
    seb = sync(client, ops=[so])["moi"]
    sid = so["sortie"]
    sync(client, ops=[op("buddy_count", count=str(uuid.uuid4()), sortie=sid, ferme=True)])
    d = op("depense", depense=str(uuid.uuid4()), sortie=sid, titre="Gîte", montant=1000, paye_par=seb, pour=[seb], jour="2026-11-26")
    assert sync(client, ops=[d])["refus"] == []
    assert sync(client, ops=[op("retirer_depense", depense=d["depense"])])["refus"] == []


def test_supprimer_un_groupe_reserve_aux_admins(client):
    """Seb, 26 novembre : un admin supprime un groupe (appui long) ; caché de tous avec ses sorties, rien n'est effacé."""
    gid, julie = bande_avec_julie(client)
    so = nouvelle_sortie(gid, participants=[julie])
    sync(client, ops=[so])
    sup = {"id": "s", "type": "supprimer_groupe", "groupe": gid}
    assert sync(client, sub="julie", ops=[sup])["refus"][0]["raison"] == "Réservé aux admins du groupe"
    r = sync(client, ops=[sup, sup])
    assert r["refus"] == [] and gid not in r["ids"] and r["ids_sorties"] == []
    j = sync(client, sub="julie")
    assert gid not in j["ids"] and j["ids_sorties"] == []
    # Plus rien n'y entre : ni sortie, ni invitation.
    assert sync(client, ops=[nouvelle_sortie(gid)])["refus"]
    assert sync(client, sub="luc", ops=[{"id": "l", "type": "rejoindre", "code": "CodeSecret0123456789"}])["refus"]


def test_j_ai_paye_puis_ok_recu(client, monkeypatch):
    """Seb, 26 novembre : Julie dit avoir payé Seb ; Seb est prévenu ; « OK, reçu » solde la dette, « Pas reçu » l'efface."""
    import appels
    sonne = []
    monkeypatch.setattr(appels, "sonner", lambda S, qui, data, ttl="45s": sonne.append((qui, data)))
    gid, julie = bande_avec_julie(client)
    so = nouvelle_sortie(gid, participants=[julie])
    seb = sync(client, ops=[so])["moi"]
    sid = so["sortie"]
    gite = op("depense", depense=str(uuid.uuid4()), sortie=sid, titre="Gîte", montant=34000, paye_par=seb, pour=[seb, julie], jour="2026-11-26")
    sync(client, ops=[gite])
    p = op("paye", depense=str(uuid.uuid4()), sortie=sid, a=seb, montant=17000, moyen="virement", jour="2026-11-26")
    assert sync(client, sub="julie", ops=[p])["refus"] == []
    assert [str(q) for q in sonne[-1][0]] == [seb] and sonne[-1][1]["texte"] == "dit t'avoir payé 170 € par virement"
    r = sync(client)
    x = next(d for d in r["depenses"] if d["id"] == p["depense"])
    assert (x["remb"], x["moyen"], x["paye_par"], x["pour"]) == ("annonce", "virement", julie, [seb])
    # Julie ne confirme pas à la place de Seb ; on ne change pas un remboursement comme une dépense.
    assert sync(client, sub="julie", ops=[op("recu", depense=p["depense"], ok=True)])["refus"]
    assert sync(client, sub="julie", ops=[op("depense", depense=p["depense"], sortie=sid, titre="x", montant=1, paye_par=julie, pour=[seb])])["refus"]
    assert sync(client, ops=[op("recu", depense=p["depense"], ok=True)])["refus"] == []
    assert next(d for d in sync(client)["depenses"] if d["id"] == p["depense"])["remb"] == "recu"
    assert [str(q) for q in sonne[-1][0]] == [julie] and sonne[-1][1]["texte"] == "a bien reçu tes 170 €"
    # Un autre « J'ai payé », refusé par Seb : il disparaît et Julie est prévenue.
    p2 = op("paye", depense=str(uuid.uuid4()), sortie=sid, a=seb, montant=500, moyen="wero")
    assert sync(client, sub="julie", ops=[p2])["refus"] == []
    assert sync(client, ops=[op("recu", depense=p2["depense"], ok=False)])["refus"] == []
    assert p2["depense"] not in sync(client)["ids_depenses"]
    assert [str(q) for q in sonne[-1][0]] == [julie] and sonne[-1][1]["texte"] == "n'a pas reçu tes 5 €"
    # On ne se rembourse pas soi-même.
    assert sync(client, ops=[op("paye", depense=str(uuid.uuid4()), sortie=sid, a=seb, montant=100)])["refus"]


def test_notifications_partages_et_pas_bud(client, monkeypatch):
    """Seb, 26 novembre : notifications pour une trace partagée, des photos ajoutées (une par synchro) ; pas pour Bud."""
    import appels
    import buddies
    sonne = []
    monkeypatch.setattr(appels, "sonner", lambda S, qui, data, ttl="45s": sonne.append(([str(q) for q in qui], data["texte"])))
    gid, julie = bande_avec_julie(client)
    so = nouvelle_sortie(gid, participants=[julie])
    sync(client, ops=[so])
    sonne.clear()
    t = op("partager_trace", trace=str(uuid.uuid4()), sortie=so["sortie"], nom="Col du Lautaret", ligne=[[6.4, 45.0], [6.41, 45.01]])
    sync(client, ops=[t])
    assert sonne == [([julie], "a partagé la trace « Col du Lautaret »")]
    sonne.clear()
    sync(client, ops=[nouvelle_photo(so["sortie"]) | {"id": str(uuid.uuid4()), "photo": str(uuid.uuid4())} for _ in range(3)])
    assert sonne == [([julie], "a ajouté 3 photos à l'album")]


def test_invitation_par_mail(client, monkeypatch):
    """Seb, 26/11 : le serveur envoie l'invitation par mail (Brevo) ; « Renvoyer » si elle n'est pas partie."""
    import mails
    envoyes = []
    monkeypatch.setattr(mails, "en_arriere_plan", lambda tache: tache())
    monkeypatch.setattr(mails, "envoyer", lambda a, sujet, texte, html, **k: envoyes.append((a, sujet, texte, k)))
    op = nouveau_groupe("Crapahuteurs")
    inv = invitation(op["groupe"], code="MailSecret0123456789", canal="mail")
    inv["contact"] = "julie@exemple.fr"
    r = sync(client, ops=[op, inv])
    (a, sujet, texte, k), = envoyes
    assert a == "julie@exemple.fr" and "« Crapahuteurs »" in sujet
    assert "Salut Julie" in texte and "rejoindre.html?c=MailSecret0123456789" in texte and "le groupe" in texte
    assert "bande" not in texte
    r = sync(client)
    assert par_nom(r, "Crapahuteurs")["invitations"][0]["mail"] == "envoye"

    def refuse(*a, **k):
        raise RuntimeError("Brevo refuse")
    monkeypatch.setattr(mails, "envoyer", refuse)
    sync(client, ops=[{"id": str(uuid.uuid4()), "type": "renvoyer_mail", "invitation": inv["invitation"]}])
    assert par_nom(sync(client), "Crapahuteurs")["invitations"][0]["mail"] == "erreur"


def test_invitation_par_sms_sans_mail(client, monkeypatch):
    import mails
    monkeypatch.setattr(mails, "en_arriere_plan", lambda tache: (_ for _ in ()).throw(AssertionError("pas de mail")))
    op = nouveau_groupe()
    r = sync(client, ops=[op, invitation(op["groupe"])])
    assert par_nom(r, "Ski du dimanche")["invitations"][0]["mail"] is None


def test_inviter_un_ami_a_installer_l_appli(client, monkeypatch):
    """Profil › Inviter un ami (Seb, 26/11) : un mail avec le lien de téléchargement, sans groupe."""
    import mails
    envoyes = []
    monkeypatch.setattr(mails, "envoyer", lambda a, sujet, texte, html, **k: envoyes.append((a, sujet, texte)))
    r = client.post("/inviter-appli", headers=entete(), json={"nom": "Paul", "email": "paul@exemple.fr"})
    assert r.status_code == 200, r.text
    (a, sujet, texte), = envoyes
    assert a == "paul@exemple.fr" and "Salut Paul" in texte and "mountainbuddies.silvaplana.cloud/app/apk/" in texte and "bien plus encore" in texte
    assert client.post("/inviter-appli", headers=entete(), json={"email": "pas-une-adresse"}).status_code == 409
