"""Buddies bloc 1 : Buddy Groups, Me Time, invitations, synchro (même faux Logto que test_serveur)."""
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


def test_me_time_cree_a_la_premiere_synchro(client):
    r = sync(client)
    assert [g["nature"] for g in r["groupes"]] == ["me_time"]
    me = r["groupes"][0]
    assert me["nom"] == "Me Time" and me["membres"][0]["role"] == "admin"
    # Même Me Time à la synchro suivante (et sur un autre téléphone de la même personne).
    assert sync(client)["ids"] == [me["id"]]


def test_creer_un_groupe_hors_ligne_puis_renvoyer(client):
    op = nouveau_groupe()
    r = sync(client, ops=[op])
    g = par_nom(r, "Ski du dimanche")
    assert g["id"] == op["groupe"] and g["nature"] == "bande"
    # Réponse perdue : le téléphone renvoie la même opération, rien n'est créé deux fois.
    r = sync(client, ops=[op])
    assert len(r["ids"]) == 2 and r["refus"] == []


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
    assert [m["role"] for m in g["membres"]] == ["admin", "membre"]
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
    assert len(r2["ids"]) == 2
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
    # Seb la nomme admin puis quitte : Julie reste admin du groupe.
    sync(client, ops=[{"id": "a", "type": "nommer_admin", "groupe": gid, "buddy": julie},
                      {"id": "q", "type": "quitter", "groupe": gid}])
    assert gid not in sync(client)["ids"]
    g = par_nom(sync(client, sub="julie"), "Ski du dimanche")
    assert [(m["id"], m["role"]) for m in g["membres"]] == [(julie, "admin")]
    # Dernier membre parti : le groupe disparaît.
    sync(client, sub="julie", ops=[{"id": "q2", "type": "quitter", "groupe": gid}])
    assert gid not in sync(client, sub="julie")["ids"]


def test_dernier_admin_qui_part_passe_la_main(client):
    op = nouveau_groupe()
    gid = op["groupe"]
    sync(client, ops=[op, invitation(gid)])
    sync(client, sub="julie", ops=[{"id": "j", "type": "rejoindre", "code": "CodeSecret0123456789"}])
    sync(client, ops=[{"id": "q", "type": "quitter", "groupe": gid}])
    assert par_nom(sync(client, sub="julie"), "Ski du dimanche")["membres"][0]["role"] == "admin"


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


def test_pas_d_invitation_dans_me_time_et_on_ne_le_quitte_pas(client):
    me = sync(client)["ids"][0]
    r = sync(client, ops=[invitation(me), {"id": "q", "type": "quitter", "groupe": me}])
    assert len(r["refus"]) == 2 and r["ids"] == [me]


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


# ------------------------------------------------------------------ bloc 2 : Buddy Times et traces partagées

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
    r = sync(client, ops=[op, op])  # renvoyé deux fois : un seul Buddy Time
    assert r["refus"] == [] and r["ids_sorties"] == [op["sortie"]]
    so = r["sorties"][0]
    assert so["groupe"] == gid and so["debut"] == "2026-12-12" and so["lieu"] == "Ceillac"
    assert sorted(p["id"] for p in so["participants"]) == sorted([r["moi"], julie])
    # Julie le voit, Luc (hors du groupe) non.
    assert sync(client, sub="julie")["ids_sorties"] == [op["sortie"]]
    assert sync(client, sub="luc")["ids_sorties"] == []


def test_buddy_time_dans_me_time_avant_la_premiere_synchro(client):
    op = nouvelle_sortie("me-time", nom="Sainte-Victoire", debut="2026-11-29", fin="2026-11-29")
    r = sync(client, ops=[op])
    me = next(g for g in r["groupes"] if g["nature"] == "me_time")
    assert r["sorties"][0]["groupe"] == me["id"]


def test_inviter_un_copain_a_une_sortie_de_me_time(client):
    op = nouvelle_sortie("me-time")
    inv = {**invitation(None, code="SortieCode0123456789"), "groupe": None, "sortie": op["sortie"]}
    r = sync(client, ops=[op, inv])
    assert r["refus"] == [] and r["sorties"][0]["invitations"][0]["nom"] == "Julie"
    assert client.get("/invitations/SortieCode0123456789").json()["sortie"] is True
    # Paul rejoint la sortie, sans entrer dans le Me Time de Seb.
    rp = sync(client, sub="paul", ops=[{"id": "p", "type": "rejoindre", "code": "SortieCode0123456789"}])
    assert rp["ids_sorties"] == [op["sortie"]]
    assert len(rp["ids"]) == 1  # seulement son propre Me Time
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
    op = {**nouvelle_sortie("me-time"), **mauvais}
    assert sync(client, ops=[op])["refus"]


def test_trace_refusee(client):
    op = {"id": "t", "type": "partager_trace", "trace": str(uuid.uuid4()), "groupe": "me-time", "nom": "x", "ligne": [[1, 2]]}
    assert sync(client, ops=[op])["refus"]
    # Buddy Time d'un autre : invisible
    so = nouvelle_sortie("me-time")
    sync(client, ops=[so])
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
    {"groupe": "me-time"},
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
    assert client.get(url + "/grande", headers=entete(sub="luc")).status_code == 404  # hors du Buddy Time
    # Julie met une ⭐ ; elle ne peut pas retirer la photo de Seb.
    r = sync(client, sub="julie", ops=[{"id": "e", "type": "etoile", "photo": ph["photo"], "etoile": True},
                                       {"id": "x", "type": "retirer_photo", "photo": ph["photo"]}])
    assert len(r["refus"]) == 1 and r["photos"][0]["etoile"] is True and r["photos"][0]["envoyee"] is True
    # Seb la retire : fichiers effacés, plus dans l'album.
    r = sync(client, ops=[{"id": "y", "type": "retirer_photo", "photo": ph["photo"]}])
    assert r["ids_photos"] == [] and list(photos.iterdir()) == []


def test_photo_refusee(client, photos):
    so = nouvelle_sortie("me-time")
    sync(client, ops=[so])
    assert sync(client, ops=[nouvelle_photo(so["sortie"], prise_le="hier")])["refus"]
    assert sync(client, sub="luc", ops=[nouvelle_photo(so["sortie"])])["refus"]  # Buddy Time d'un autre
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
    # Julie ajoute son texte, signé ; elle le voit dans la synchro suivante (le Buddy Time a bougé).
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
    so = nouvelle_sortie("me-time")
    sync(client, ops=[so])
    assert sync(client, ops=[op(sortie=so["sortie"], **mauvais)])["refus"]


def test_carnet_d_un_autre_refuse(client):
    so = nouvelle_sortie("me-time")
    sync(client, ops=[so])
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
    # Seb retire l'essence ; Luc (hors du Buddy Time) ne voit rien et ne peut rien ajouter.
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


T0 = 1_797_000_000_000  # un matin pendant le Buddy Time (ms)


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
    # Luc, hors du Buddy Time, ne voit rien et ne peut pas s'épingler.
    assert sync(client, sub="luc")["positions"] == []
    assert sync(client, sub="luc", ops=[op("epingle", sortie=sid, enfoncee=True, quand=T0, jusqu=T0 + 1000)])["refus"]


def test_epingle_limitee_a_un_jour(client):
    gid, julie = bande_avec_julie(client)
    so = nouvelle_sortie(gid, participants=[julie])
    sync(client, ops=[so])
    r = sync(client, ops=[op("epingle", sortie=so["sortie"], enfoncee=True, quand=T0, jusqu=T0 + 5 * 24 * 3600_000)])
    assert r["positions"][0]["jusqu"] == T0 + 24 * 3600_000
    assert sync(client, ops=[op("epingle", sortie=so["sortie"], enfoncee=True, quand=T0, jusqu=T0 - 1)])["refus"]


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
    # Seb retire son ♥ et le refuge ; Luc (hors du Buddy Time) ne voit rien et ne peut rien faire.
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
