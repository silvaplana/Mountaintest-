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
