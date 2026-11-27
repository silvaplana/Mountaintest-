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
