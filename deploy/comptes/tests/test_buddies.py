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
