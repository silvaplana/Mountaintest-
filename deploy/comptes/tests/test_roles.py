"""Rôles façon AppBase (spec/buddies.md §7.17) : Super User, club facultatif, Groupe perso né à la première sortie seul."""
import subprocess
import sys
import uuid
from pathlib import Path

from test_buddies import bande_avec_julie, nouveau_message, nouvelle_sortie, sync  # noqa: F401
from test_serveur import client, entete  # noqa: F401  (fixture partagée)


def rendre_super_user(sub):
    import buddies
    import serveur
    from modeles import Utilisateur
    with serveur.Sessions() as s:
        u = s.scalar(buddies.select(Utilisateur).where(Utilisateur.logto_id == sub))
        u.super_user = True
        s.commit()


def test_personne_n_est_super_user_au_depart(client):
    assert sync(client)["roles"] == {"super_user": False}


def test_premiere_sortie_seul_cree_le_groupe_perso_sans_nom(client):
    """Seb, 26 novembre : pas de Groupe perso tant qu'on n'est pas sorti seul ; il naît sans nom, puis ressert."""
    assert sync(client)["groupes"] == []
    r = sync(client, ops=[nouvelle_sortie("seul", nom="Sainte-Victoire")])
    assert r["refus"] == []
    (g,) = r["groupes"]
    assert g["nom"] == "" and g["nature"] == "me_time" and g["organisation"] is None
    assert [m["role"] for m in g["membres"]] == ["admin_principal"]
    r = sync(client, ops=[nouvelle_sortie("seul", nom="Calanques")])
    assert r["ids"] == [g["id"]] and len(r["ids_sorties"]) == 2
    # et il reste à la synchro suivante (ce n'est pas un ancien Me Time)
    assert sync(client)["ids"] == [g["id"]]


def test_le_super_user_modere_un_groupe_dont_il_n_est_pas(client):
    gid, *_ = bande_avec_julie(client)
    msg = nouveau_message(groupe=gid)
    sync(client, sub="julie", ops=[msg])
    sync(client, sub="admin-appli")
    supprimer = {"id": str(uuid.uuid4()), "type": "retirer_message", "message": msg["message"]}
    assert sync(client, sub="admin-appli", ops=[supprimer])["refus"]  # pas encore Super User
    rendre_super_user("admin-appli")
    r = sync(client, sub="admin-appli", ops=[supprimer])
    assert r["refus"] == [] and r["roles"] == {"super_user": True}
    assert gid not in r["ids"]  # il agit, mais ne voit pas pour autant les Groupes des autres


def test_commande_super_user(tmp_path):
    """La commande du VPS nomme puis retire le Super User par son e-mail."""
    dossier = Path(__file__).resolve().parents[1]
    base = f"sqlite+pysqlite:///{tmp_path / 'b.db'}"
    pre = ("import sys; sys.argv=['x']; import serveur, modeles; modeles.Base.metadata.create_all(serveur.moteur);"
           "s=serveur.Sessions(); s.add(modeles.Utilisateur(logto_id='a', email='Seb@Exemple.fr', pseudo='Seb')); s.commit()")
    env = {"DB_URL": base, "PATH": "/usr/bin:/bin"}
    lance = lambda *a: subprocess.run([sys.executable, *a], cwd=dossier, env=env, capture_output=True, text=True)  # noqa: E731
    assert lance("-c", pre).returncode == 0
    r = lance("super_user.py", "seb@exemple.fr")
    assert r.returncode == 0 and "est maintenant Super User" in r.stdout
    assert lance("super_user.py", "inconnu@exemple.fr").returncode == 1
    assert "n’est plus" in lance("super_user.py", "seb@exemple.fr", "--retirer").stdout


def op(type_, **k):
    return {"id": str(uuid.uuid4()), "type": type_, **k}


def bande_a_trois(client):
    """Seb crée le groupe (admin principal), Julie et Luc le rejoignent (membres)."""
    gid, julie = bande_avec_julie(client)
    from test_buddies import invitation
    sync(client, ops=[invitation(gid, code="CodeDeLuc0123456789")])
    luc = sync(client, sub="luc", ops=[op("rejoindre", code="CodeDeLuc0123456789")])["moi"]
    return gid, julie, luc


def roles(client, gid, sub="seb"):
    g = next(x for x in sync(client, sub=sub)["groupes"] if x["id"] == gid)
    return {m["id"]: m["role"] for m in g["membres"]}


def test_admin_principal_nomme_retire_et_transmet(client):
    gid, julie, luc = bande_a_trois(client)
    # un admin (pas principal) ne nomme personne
    sync(client, ops=[op("nommer_admin", groupe=gid, buddy=julie)])
    assert sync(client, sub="julie", ops=[op("nommer_admin", groupe=gid, buddy=luc)])["refus"]
    # un admin retire un membre, mais pas un autre admin ni l'admin principal
    sync(client, ops=[op("nommer_admin", groupe=gid, buddy=luc)])
    seb = sync(client)["moi"]
    assert sync(client, sub="julie", ops=[op("retirer", groupe=gid, buddy=luc)])["refus"]
    assert sync(client, sub="julie", ops=[op("retirer", groupe=gid, buddy=seb)])["refus"]
    # l'admin principal retire le rôle d'admin, puis transmet le sien : toujours un seul admin principal
    sync(client, ops=[op("retirer_admin", groupe=gid, buddy=luc), op("transmettre", groupe=gid, buddy=julie)])
    assert roles(client, gid) == {seb: "admin", julie: "admin_principal", luc: "membre"}
    assert sync(client, sub="julie", ops=[op("retirer", groupe=gid, buddy=luc)])["refus"] == []


def test_un_membre_ne_supprime_que_ce_qu_il_a_apporte(client):
    """Seb, 26 novembre : le membre crée tout, mais ne supprime que ce qu'il a apporté ; l'admin supprime tout."""
    gid, julie, luc = bande_a_trois(client)
    so = nouvelle_sortie(gid, participants=[julie, luc])
    seb = sync(client, ops=[so])["moi"]
    dep = op("depense", depense=str(uuid.uuid4()), sortie=so["sortie"], titre="Gîte", montant=9000, paye_par=julie,
             pour=[seb, julie, luc], jour="2026-12-12")
    heb = op("proposer_hebergement", hebergement=str(uuid.uuid4()), sortie=so["sortie"], nom="Gîte des Mélèzes")
    msg = nouveau_message(groupe=gid)
    assert sync(client, sub="julie", ops=[dep, heb, msg])["refus"] == []
    retraits = [op("retirer_depense", depense=dep["depense"]), op("retirer_hebergement", hebergement=heb["hebergement"]),
                op("retirer_message", message=msg["message"]), op("supprimer_sortie", sortie=so["sortie"])]
    # Luc, simple membre : rien de tout ça n'est à lui
    assert len(sync(client, sub="luc", ops=retraits)["refus"]) == 4
    # mais il retient l'hébergement (Seb : un membre peut le faire)
    assert sync(client, sub="luc", ops=[op("retenir_hebergement", hebergement=heb["hebergement"], retenu=True)])["refus"] == []
    # Seb, admin principal : tout passe
    assert sync(client, ops=retraits)["refus"] == []


def test_reprise_des_groupes_d_avant(client):
    """Au démarrage du serveur, un Groupe d'avant le 26 novembre (créateur « admin ») reçoit son admin principal."""
    import serveur
    gid, julie = bande_avec_julie(client)
    from modeles import Membre
    with serveur.Sessions() as s:
        for m in s.scalars(serveur.select(Membre).where(Membre.groupe_id == uuid.UUID(gid))):
            m.role = "admin" if m.role == "admin_principal" else m.role
        s.commit()
    seb = sync(client)["moi"]
    assert roles(client, gid) == {seb: "admin", julie: "membre"}
    serveur.roles_de_groupe()
    assert roles(client, gid) == {seb: "admin_principal", julie: "membre"}


def test_place_sur_le_serveur_et_le_telephone(client, tmp_path, monkeypatch):  # noqa: F811
    """Calque Hors ligne (Seb 26/11) : chacun voit sa place ; le Super User voit celle de tout le monde."""
    import buddies
    import serveur
    from modeles import FichierBuddy, Utilisateur
    monkeypatch.setattr(buddies, "DOSSIER_FICHIERS", str(tmp_path))
    assert client.put("/stockage/telephone", json={"octets": 2_110_000_000}, headers=entete()).status_code == 200
    assert client.put("/stockage/telephone", json={"octets": 5_000}, headers=entete(sub="u2")).status_code == 200
    with serveur.Sessions() as s:
        seb = s.scalar(buddies.select(Utilisateur).where(Utilisateur.logto_id == "u1"))
        f = FichierBuddy(id=uuid.uuid4(), par=seb.id, nom="topo.pdf", mime="application/pdf", taille=7, envoye=True)
        s.add(f)
        s.commit()
        fid = f.id
    (tmp_path / str(fid)).write_bytes(b"1234567")
    moi = client.get("/stockage", headers=entete()).json()
    assert moi["moi"]["fichiers"] == 7 and "tous" not in moi
    rendre_super_user("u2")
    tous = client.get("/stockage", headers=entete(sub="u2")).json()["tous"]
    assert [t["telephone"] for t in tous] == [2_110_000_000, 5_000]
    assert tous[0]["fichiers"] == 7


def test_ecrire_au_support(client, monkeypatch):
    """Seb, 26 novembre : « Écrire au support » = une discussion à deux avec le Super User, toujours la même,
    notifiée comme un message de buddy ; infos (version, téléphone) en nom."""
    import appels
    import buddies
    sonne = []
    monkeypatch.setattr(appels, "sonner", lambda S, qui, data, ttl="45s": sonne.append(([str(q) for q in qui], data["titre"], data["duo"])))
    sync(client, sub="seb")
    sync(client, sub="julie")
    op = {"id": str(uuid.uuid4()), "type": "support", "infos": "1.4.238 · Pixel 7"}
    assert sync(client, sub="julie", ops=[op])["refus"][0]["raison"] == "Le support n'est pas encore ouvert"
    rendre_super_user("seb")
    r = sync(client, sub="julie", ops=[op | {"id": str(uuid.uuid4())}])
    assert r["refus"] == []
    gid = str(uuid.uuid5(buddies.ESPACE_DUO, f"support:{r['moi']}"))
    g = next(x for x in r["groupes"] if x["id"] == gid)
    assert g["nature"] == "support" and g["nom"] == "1.4.238 · Pixel 7" and len(g["membres"]) == 2
    sync(client, sub="julie", ops=[nouveau_message(groupe=gid, texte="Le planning ne s'ouvre plus")])
    seb = sync(client, sub="seb")
    assert any(x["id"] == gid for x in seb["groupes"])
    assert sonne and sonne[-1][0] == [seb["moi"]] and sonne[-1][2] == "1"


def test_retirer_un_membre_super_user_et_le_retire_ne_voit_plus_le_groupe(client):
    """Seb, 27 novembre : un admin ou le Super User retire un buddy (appui long) ; le retiré ne voit plus le groupe."""
    gid, julie, luc = bande_a_trois(client)
    seb = sync(client)["moi"]
    # Luc, simple membre, ne retire personne
    assert sync(client, sub="luc", ops=[op("retirer", groupe=gid, buddy=julie)])["refus"]
    # Luc devient Super User : il retire Julie
    rendre_super_user("luc")
    assert sync(client, sub="luc", ops=[op("retirer", groupe=gid, buddy=julie)])["refus"] == []
    assert gid not in [g["id"] for g in sync(client, sub="julie")["groupes"]]
    assert set(roles(client, gid)) == {seb, luc}
