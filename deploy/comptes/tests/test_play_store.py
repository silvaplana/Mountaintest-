"""Play Store : supprimer mon compte, signaler, bloquer (spec/buddies.md §7.24)."""
import uuid

from test_buddies import T0, bande_avec_julie, nouveau_message, nouvelle_photo, nouvelle_sortie, op, photos, sync  # noqa: F401
from test_roles import rendre_super_user
from test_serveur import client, entete  # noqa: F401  (fixture partagée)


def signalement(message=None, buddy=None, motif="insulte", mot=""):
    o = {"id": str(uuid.uuid4()), "type": "signaler", "signalement": str(uuid.uuid4()), "motif": motif, "mot": mot}
    o.update({"message": message} if message else {"buddy": buddy})
    return o


def test_bloquer_cache_ma_position_et_se_retrouve_dans_ma_liste(client):
    gid, julie = bande_avec_julie(client)
    so = nouvelle_sortie(gid, participants=[julie])
    seb = sync(client, ops=[so])["moi"]
    sid = so["sortie"]
    # Julie partage sa position ; Seb la voit.
    sync(client, sub="julie", ops=[op("epingle", sortie=sid, enfoncee=True, quand=T0, jusqu=T0 + 3600_000),
                                   op("position", sortie=sid, lat=44.6, lon=6.7, prise_le=T0 + 1000)])
    assert [p["qui"] for p in sync(client)["positions"]] == [julie]
    # Julie bloque Seb : il ne la voit plus ; elle le voit dans « Personnes bloquées ». Renvoyé : rien de plus.
    b = {"id": "b", "type": "bloquer", "buddy": seb}
    r = sync(client, sub="julie", ops=[b, b])
    assert r["refus"] == [] and [x["id"] for x in r["bloques"]] == [seb]
    assert sync(client)["positions"] == [] and sync(client)["bloques"] == []
    # Elle le débloque : il la revoit.
    r = sync(client, sub="julie", ops=[{"id": "d", "type": "debloquer", "buddy": seb}])
    assert r["bloques"] == [] and [p["qui"] for p in sync(client)["positions"]] == [julie]
    assert sync(client, sub="julie", ops=[{"id": "x", "type": "bloquer", "buddy": julie}])["refus"]  # pas soi-même


def test_pas_de_notification_de_quelqu_un_que_j_ai_bloque(client, monkeypatch):
    import appels
    envois = []
    monkeypatch.setattr(appels, "sonner", lambda _S, qui, data, ttl="45s": envois.append(sorted(map(str, qui))))
    gid, julie = bande_avec_julie(client)
    seb = sync(client)["moi"]
    sync(client, sub="julie", ops=[{"id": "b", "type": "bloquer", "buddy": seb}])
    envois.clear()
    sync(client, ops=[nouveau_message(groupe=gid)])
    assert envois == [[]] or envois == []


def test_signaler_un_message_puis_le_super_user_l_efface(client):
    gid, julie = bande_avec_julie(client)
    m = nouveau_message(groupe=gid, texte="Message pénible")
    seb = sync(client, ops=[m])["moi"]
    sync(client, sub="luc")
    rendre_super_user("luc")
    # Julie signale le message de Seb ; renvoyé, il n'est compté qu'une fois. Seb ne voit rien.
    x = signalement(message=m["message"], mot="il insiste")
    assert sync(client, sub="julie", ops=[x, x])["refus"] == []
    assert sync(client)["signalements"] == [] and sync(client, sub="julie")["signalements"] == []
    s, = sync(client, sub="luc")["signalements"]
    assert (s["cible_id"], s["message"], s["extrait"], s["mot"], s["lieu"], s["suite"]) == (seb, m["message"], "Message pénible", "il insiste", "Ski du dimanche", None)
    # Seul le Super User traite ; il efface le message chez tous.
    t = {"id": "t", "type": "traiter_signalement", "signalement": x["signalement"], "suite": "efface"}
    assert sync(client, sub="julie", ops=[t])["refus"]
    assert sync(client, sub="luc", ops=[t])["refus"] == []
    assert sync(client, sub="luc")["signalements"][0]["suite"] == "efface"
    msg = next(y for y in sync(client, sub="julie")["messages"] if y["id"] == m["message"])
    assert msg["supprime"] and msg["texte"] == ""


def test_retirer_la_personne_signalee_du_groupe(client):
    gid, julie = bande_avec_julie(client)
    m = nouveau_message(groupe=gid, texte="Spam")
    sync(client, sub="julie", ops=[m])
    sync(client, sub="luc")
    rendre_super_user("luc")
    x = signalement(message=m["message"], motif="pub")
    sync(client, ops=[x])
    sync(client, sub="luc", ops=[{"id": "t", "type": "traiter_signalement", "signalement": x["signalement"], "suite": "retire"}])
    assert gid not in sync(client, sub="julie")["ids"] and gid in sync(client)["ids"]


def test_signaler_refuse(client):
    gid, julie = bande_avec_julie(client)
    m = nouveau_message(groupe=gid)
    seb = sync(client, ops=[m])["moi"]
    for mauvais in (signalement(message=m["message"]), signalement(buddy=seb), signalement(buddy=julie, motif="bof"),
                    signalement(message=str(uuid.uuid4()))):
        assert sync(client, ops=[mauvais])["refus"], mauvais
    assert sync(client, sub="luc", ops=[signalement(message=m["message"])])["refus"]  # pas dans le groupe


def test_supprimer_mon_compte(client, photos):
    gid, julie = bande_avec_julie(client)
    so = nouvelle_sortie(gid, participants=[julie])
    ph = nouvelle_photo(so["sortie"])
    m = nouveau_message(groupe=gid, texte="Salut")
    sync(client, sub="julie", ops=[])
    seb = sync(client, ops=[so, m])["moi"]
    sync(client, sub="julie", ops=[ph])
    assert client.delete("/moi", headers=entete(sub="julie")).status_code == 200
    # Pour Seb : Julie n'est plus dans le groupe ni la sortie, sa photo est partie, son message reste.
    r = sync(client)
    g = next(x for x in r["groupes"] if x["id"] == gid)
    assert [x["id"] for x in g["membres"]] == [seb]
    assert julie not in next(x for x in r["sorties"] if x["id"] == so["sortie"])["participants"]
    assert r["ids_photos"] == [] and m["message"] in r["ids_messages"]
    # Elle se reconnecte avec le même compte : un compte tout neuf, sans groupe.
    r = sync(client, sub="julie")
    assert r["moi"] != julie and r["ids"] == []
    p = client.get("/moi", headers=entete(sub="julie")).json()
    assert p["pseudo"] != "Ancien buddy"
