"""Flux d'événements (SSE, repris d'AppBase) : « un événement pour tout » (Seb, 27/11)."""
import asyncio
import uuid

from test_serveur import client, entete  # noqa: F401  (fixture partagée ; pose la configuration avant serveur)
from test_buddies import bande_avec_julie, nouveau_groupe, op, sync, T0

import serveur
from evenements import Evenements


def test_flux_premier_octet_evenement_puis_desabonnement(monkeypatch):
    """Comme AppBase : un commentaire tout de suite, les événements en `data:`, un ping quand rien ne passe, et la
    file retirée à la fermeture."""
    f = Evenements()
    monkeypatch.setattr(serveur, "flux", f)
    monkeypatch.setattr(serveur, "DELAI_PING_SECONDES", 0.01)
    qui = uuid.uuid4()

    async def scenario():
        g = serveur.generateur_evenements(qui)
        assert await g.__anext__() == ": connecte\n\n"
        f.publier(qui, {"type": "synchro", "sauf": None})
        f.publier(uuid.uuid4(), {"type": "synchro"})  # un autre compte : rien ici
        assert await g.__anext__() == 'data: {"type": "synchro", "sauf": null}\n\n'
        assert await g.__anext__() == ": ping\n\n"
        await g.aclose()
    asyncio.run(scenario())
    assert f._abonnes == {}


def test_flux_refuse_sans_jeton(client):
    assert client.get("/buddies/evenements").status_code == 401
    assert client.get("/buddies/evenements?jeton=nimporte").status_code == 401


def test_un_evenement_pour_tout(client, monkeypatch):
    """Chaque changement prévient les buddies concernés et mes autres appareils ; l'appareil qui envoie est nommé
    dans `sauf` ; une synchro sans opération (ou toute refusée) ne prévient personne."""
    envois = []
    monkeypatch.setattr(serveur.flux, "publier", lambda qui, e: envois.append((str(qui), e)))
    gid, julie = bande_avec_julie(client)
    seb = sync(client)["moi"]
    luc = sync(client, sub="luc")["moi"]
    envois.clear()

    def pour(ops, **k):
        envois.clear()
        r = client.post("/buddies/sync", headers=entete(sub="seb"), json={"ops": ops, "depuis": None, **k})
        assert r.status_code == 200, r.text
        return sorted(q for q, _ in envois)

    assert pour([]) == []
    assert pour([op("voiture", garee=True, lat=44.6, lon=6.7, garee_le=T0, jusqu=T0 + 3600_000)], appareil="tel-1") == sorted([seb, julie])
    assert {e["sauf"] for _, e in envois} == {"tel-1"} and luc not in [q for q, _ in envois]
    assert pour([op("message", message=str(uuid.uuid4()), groupe=gid, texte="Salut")]) == sorted([seb, julie])
    assert pour([op("position", groupe=gid, lat=44.6, lon=6.7, prise_le=T0)]) == sorted([seb, julie])
    assert pour([op("message", message=str(uuid.uuid4()), groupe=str(uuid.uuid4()), texte="Nulle part")]) == []  # refusée
    # Julie retirée du groupe : elle est prévenue quand même (son groupe disparaît chez elle).
    assert julie in pour([op("retirer", groupe=gid, buddy=julie)])
    assert pour([nouveau_groupe("Seul")]) == [seb]
    # Hors synchro : « écrit… » et le profil.
    envois.clear()
    client.put("/moi", headers=entete(sub="seb"), json={"pseudo": "Seb"})
    assert [q for q, _ in envois] == [seb]
