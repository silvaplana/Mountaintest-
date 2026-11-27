"""📞 Appels (bloc 10) : jeton LiveKit, sonnerie Firebase (simulée), présence et fin."""
import jwt
import pytest

import appels
from test_buddies import bande_avec_julie, nouvelle_sortie, sync
from test_serveur import client, entete  # noqa: F401  (fixture partagée)


@pytest.fixture()
def livekit(monkeypatch):
    monkeypatch.setattr(appels, "LIVEKIT_URL", "wss://appels.exemple.test")
    monkeypatch.setattr(appels, "LIVEKIT_CLE", "cle")
    monkeypatch.setattr(appels, "LIVEKIT_SECRET", "secret-de-test-assez-long-pour-hs256")
    sonne = []
    monkeypatch.setattr(appels, "sonner", lambda _S, qui, data, **_: sonne.append((sorted(map(str, qui)), data)))
    return sonne


def test_appeler_sonner_rejoindre_raccrocher(client, livekit):
    gid, julie = bande_avec_julie(client)
    assert client.post("/appareils", headers=entete(sub="julie"), json={"jeton": "j" * 30}).status_code == 200
    r = client.post("/appels", headers=entete(sub="seb"), json={"groupe": gid})
    assert r.status_code == 200, r.text
    a = r.json()
    assert a["nouveau"] and a["url"] == "wss://appels.exemple.test"
    j = jwt.decode(a["jeton"], "secret-de-test-assez-long-pour-hs256", algorithms=["HS256"])
    assert j["video"]["room"] == a["id"] and j["video"]["roomJoin"] and j["iss"] == "cle"
    # Julie sonne (pas moi), avec le nom de la bande.
    assert livekit[0][0] == [julie] and livekit[0][1]["type"] == "appel" and livekit[0][1]["nom"] == "Ski du dimanche"
    # Rappeler pendant l'appel : on le rejoint, sans refaire sonner.
    assert client.post("/appels", headers=entete(sub="seb"), json={"groupe": gid}).json()["id"] == a["id"] and len(livekit) == 1
    # L'appel en cours arrive dans la synchro (« rejoindre »).
    assert sync(client, sub="julie")["appels"][0]["id"] == a["id"]
    assert client.post(f"/appels/{a['id']}/rejoindre", headers=entete(sub="julie")).status_code == 200
    assert client.post(f"/appels/{a['id']}/rejoindre", headers=entete(sub="luc")).status_code == 409
    for sub in ("seb", "julie"):
        client.post(f"/appels/{a['id']}/presence", headers=entete(sub=sub), json={"en_ligne": True})
    client.post(f"/appels/{a['id']}/presence", headers=entete(sub="seb"), json={"en_ligne": False})
    assert sync(client)["appels"][0]["en_ligne"] == [julie]
    fin = client.post(f"/appels/{a['id']}/presence", headers=entete(sub="julie"), json={"en_ligne": False}).json()
    assert fin["fini"] and sync(client)["appels"] == [] and livekit[-1][1]["type"] == "fin"
    assert client.post(f"/appels/{a['id']}/rejoindre", headers=entete(sub="julie")).status_code == 409


def test_appel_dans_un_buddy_time_et_refus(client, livekit):
    gid, julie = bande_avec_julie(client)
    so = nouvelle_sortie(gid, participants=[julie])
    sync(client, ops=[so])
    assert client.post("/appels", headers=entete(sub="seb"), json={"sortie": so["sortie"]}).status_code == 200
    assert client.post("/appels", headers=entete(sub="luc"), json={"groupe": gid}).status_code == 409


def test_sans_livekit_pas_d_appel(client):
    gid, _ = bande_avec_julie(client)
    r = client.post("/appels", headers=entete(sub="seb"), json={"groupe": gid})
    assert r.status_code == 409 and "pas encore installés" in r.json()["detail"]


def test_firebase_absent_ne_casse_rien(monkeypatch, tmp_path):
    monkeypatch.setattr(appels, "FIREBASE_CLE", str(tmp_path / "absente.json"))
    assert appels.envoyer_push(["x" * 30], {"type": "appel"}) == []


def test_carte_dans_la_messagerie(client, livekit):
    """🗺 Un message « carte » : salle muette (données seulement), sans sonnerie, pour ceux de la conversation."""
    from test_buddies import nouveau_message
    gid, julie = bande_avec_julie(client)
    op = nouveau_message(groupe=gid, nature="carte", texte="")
    sync(client, ops=[op])
    m = next(x for x in sync(client, sub="julie")["messages"] if x["id"] == op["message"])
    assert m["nature"] == "carte"
    r = client.post(f"/cartes/{op['message']}", headers=entete(sub="julie"))
    assert r.status_code == 200, r.text
    j = jwt.decode(r.json()["jeton"], "secret-de-test-assez-long-pour-hs256", algorithms=["HS256"])
    assert j["video"]["room"] == f"carte-{op['message']}" and j["video"]["canPublish"] is False and j["video"]["canPublishData"]
    # Personne ne sonne : seule la notification du message part (« veut te montrer sa carte »).
    assert [d["type"] for _, d in livekit] == ["message"] and "carte" in livekit[0][1]["texte"]
    assert client.post(f"/cartes/{op['message']}", headers=entete(sub="luc")).status_code in (404, 409)
    texte = nouveau_message(groupe=gid)
    sync(client, ops=[texte])
    assert client.post(f"/cartes/{texte['message']}", headers=entete(sub="seb")).status_code == 409


def test_carte_debut_et_fin_notifies(client, livekit):
    """🗺 Seb, 27/11 : « Seb a partagé sa carte dans <groupe> », puis « Seb a arrêté de partager sa carte… » ; après la fin, plus de Suivre."""
    from test_buddies import nouveau_message
    gid, julie = bande_avec_julie(client)
    op = nouveau_message(groupe=gid, nature="carte", texte="")
    sync(client, ops=[op])
    d = livekit[-1][1]
    assert d["ligne"].endswith("a partagé sa carte dans " + d["titre"]) and d["ligne"].startswith(d["de"])
    fin = nouveau_message(groupe=gid, nature="carte_fin", texte=op["message"])
    sync(client, ops=[fin])
    d = livekit[-1][1]
    assert d["ligne"].endswith("a arrêté de partager sa carte dans " + d["titre"])
    assert client.post(f"/cartes/{op['message']}", headers=entete(sub="julie")).status_code == 409


def test_carte_imposee_pendant_l_appel_notifiee(client, livekit):
    """🗺 Seb, 27/11 : en appel, ceux qui sont en ligne reçoivent « Seb a partagé sa carte dans … » puis « … a arrêté ». """
    gid, julie = bande_avec_julie(client)
    a = client.post("/appels", headers=entete(sub="seb"), json={"groupe": gid}).json()
    for sub in ("seb", "julie"):
        client.post(f"/appels/{a['id']}/presence", headers=entete(sub=sub), json={"en_ligne": True})
    assert client.post(f"/appels/{a['id']}/carte", headers=entete(sub="seb"), json={"on": True}).status_code == 200
    qui, d = livekit[-1]
    assert qui == [julie] and d["ligne"].endswith("a partagé sa carte dans Ski du dimanche") and d["ligne"].startswith(d["de"])
    client.post(f"/appels/{a['id']}/carte", headers=entete(sub="seb"), json={"on": False})
    assert livekit[-1][1]["ligne"].endswith("a arrêté de partager sa carte dans Ski du dimanche")
    assert client.post(f"/appels/{a['id']}/carte", headers=entete(sub="luc"), json={"on": True}).status_code == 409
