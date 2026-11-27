"""📓 Journaux de diagnostic : déposés par les téléphones, lus avec le jeton (Seb, 27/11)."""
import serveur
from test_serveur import client, entete  # noqa: F401  (fixture partagée)


def test_deposer_puis_lire_avec_le_jeton(client, tmp_path, monkeypatch):
    monkeypatch.setenv("COMPTES_DOSSIER", str(tmp_path))
    monkeypatch.setattr(serveur, "DOSSIER_JOURNAUX", str(tmp_path / "journaux"))
    assert client.post("/journaux", headers=entete(), json={"texte": "12:00:00.000 → trait sûr 5403o", "raison": "bouton"}).json()["ok"]
    assert client.get("/journaux").status_code == 404  # sans jeton
    assert client.get("/journaux", headers={"X-Journal-Jeton": "faux"}).status_code == 404
    # Le jeton : seulement pour le Super User.
    assert client.get("/super/jeton-journaux", headers=entete()).status_code == 403
    j = serveur.jeton_journaux()
    assert len(j) > 30 and serveur.jeton_journaux() == j  # tiré une fois, gardé
    r = client.get("/journaux", headers={"X-Journal-Jeton": j})
    assert r.status_code == 200 and "trait sûr 5403o" in r.text and "bouton" in r.text
