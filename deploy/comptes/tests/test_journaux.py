"""📓 Journaux de diagnostic : déposés par les téléphones, lus avec le jeton (Seb, 27/11)."""
from test_serveur import client, entete  # noqa: F401  (fixture partagée ; règle l'environnement avant serveur)
import serveur  # noqa: E402


def test_deposer_puis_lire_avec_le_jeton(client, tmp_path, monkeypatch):
    monkeypatch.setenv("COMPTES_DOSSIER", str(tmp_path))
    monkeypatch.setattr(serveur, "DOSSIER_JOURNAUX", str(tmp_path / "journaux"))
    r0 = client.post("/journaux", headers=entete(), json={"texte": "12:00:00.000 → trait sûr 5403o", "raison": "bouton"})
    assert r0.json().get("ok"), r0.text
    assert client.get("/journaux").status_code == 404  # sans jeton
    assert client.get("/journaux", headers={"X-Journal-Jeton": "faux"}).status_code == 404
    # Le jeton : seulement pour le Super User.
    assert client.get("/super/jeton-journaux", headers=entete()).status_code == 403
    j = serveur.jeton_journaux()
    assert len(j) > 30 and serveur.jeton_journaux() == j  # tiré une fois, gardé
    r = client.get("/journaux", headers={"X-Journal-Jeton": j})
    assert r.status_code == 200 and "trait sûr 5403o" in r.text and "bouton" in r.text


def test_mode_diagnostic_une_heure_par_le_super_user(client, tmp_path, monkeypatch):
    monkeypatch.setattr(serveur, "FICHIER_DIAGNOSTIC", str(tmp_path / "diag"))
    assert client.get("/journaux/mode", headers=entete()).json()["diagnostic_jusqua"] == 0
    assert client.post("/journaux/mode", headers=entete(), json={"on": True}).status_code == 403
    serveur.changer_mode_journal(serveur.ModeJournal(on=True), type("U", (), {"super_user": True})())
    j = client.get("/journaux/mode", headers=entete()).json()["diagnostic_jusqua"]
    assert j > serveur.time.time() + 3500
