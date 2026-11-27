"""Onglet Utilisateurs du Super User (Seb, 27/11) : téléchargements comptés, comptes et leur usage."""
from test_buddies import bande_avec_julie
from test_roles import rendre_super_user
from test_serveur import client, entete  # noqa: F401  (fixture partagée)


def test_telechargements_comptes_puis_renvoi_vers_l_apk(client):
    for _ in range(3):
        r = client.get("/telecharger", follow_redirects=False)
        assert r.status_code == 302 and r.headers["location"].endswith("mountain-buddies-capacitor.apk")
    client.get("/moi", headers=entete())
    rendre_super_user("u1")
    t = client.get("/super/utilisateurs", headers=entete()).json()["telechargements"]
    assert t == {"total": 3, "semaine": 3}


def test_jours_ouvertures_plateforme_et_groupes(client):
    bande_avec_julie(client)
    for _ in range(2):
        assert client.post("/ouverture", json={"plateforme": "apk", "version": "0.1.312"}, headers=entete(sub="seb")).status_code == 200
    client.post("/ouverture", json={"plateforme": "web"}, headers=entete(sub="julie"))
    assert client.post("/ouverture", json={"plateforme": "ios"}, headers=entete(sub="seb")).status_code == 422
    rendre_super_user("seb")
    r = client.get("/super/utilisateurs", headers=entete(sub="seb")).json()
    seb = next(x for x in r["comptes"] if x["plateforme"] == "apk")
    julie = next(x for x in r["comptes"] if x["plateforme"] == "web")
    assert (seb["jours"], seb["ouvertures"], seb["version"]) == (1, 2, "0.1.312")
    assert list(seb["par_jour"].values()) == [2] and len(seb["groupes"]) == 1 and seb["groupes"] == julie["groupes"]
    assert (julie["jours"], julie["ouvertures"]) == (1, 1)
    assert r["semaine"] == len(r["comptes"]) == 2


def test_reserve_au_super_user(client):
    assert client.get("/super/utilisateurs", headers=entete()).status_code == 403


def test_journal_sans_le_super_user(client):
    gid, julie = bande_avec_julie(client)  # Seb crée le groupe, Julie s'inscrit et le rejoint
    client.post("/ouverture", json={"plateforme": "apk", "evenement": "connexion"}, headers=entete(sub="julie"))
    client.post("/ouverture", json={"plateforme": "apk"}, headers=entete(sub="julie"))
    client.post("/ouverture", json={"plateforme": "apk", "evenement": "deconnexion"}, headers=entete(sub="julie"))
    rendre_super_user("seb")
    client.post("/ouverture", json={"plateforme": "apk", "evenement": "connexion"}, headers=entete(sub="seb"))
    r = client.get("/super/utilisateurs", headers=entete(sub="seb")).json()
    j = [x for x in r["journal"] if x["qui"] == julie]
    assert [x["quoi"] for x in j] == ["deconnexion", "ouverture", "connexion", "rejoint", "inscription"]
    assert j[3]["detail"] == "Ski du dimanche" and j[0]["detail"] == "Android"
    seb = next(c["id"] for c in r["comptes"] if c["id"] != julie)
    assert [x["quoi"] for x in r["journal"] if x["qui"] == seb] == ["inscription"]  # pas encore Super User à son inscription
    assert next(c for c in r["comptes"] if c["id"] == julie)["ouvertures"] == 2  # la déconnexion ne compte pas
