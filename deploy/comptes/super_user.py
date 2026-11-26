"""Nommer (ou retirer) le Super User, sur le VPS seulement, jamais depuis l'appli (spec/buddies.md §7.17) :

    docker exec mb-api python super_user.py seb@exemple.fr          # nomme
    docker exec mb-api python super_user.py seb@exemple.fr --retirer

La personne doit s'être connectée une fois à l'appli (son compte existe alors ici).
"""
from __future__ import annotations

import sys

from sqlalchemy import func, select

from serveur import Sessions, ajouter_colonnes, moteur
from modeles import Base, Utilisateur


def main(args: list[str]) -> int:
    if not args or args[0].startswith("-"):
        print(__doc__)
        return 2
    email, retirer = args[0].strip().lower(), "--retirer" in args[1:]
    Base.metadata.create_all(moteur)
    ajouter_colonnes()  # au cas où le serveur n'a pas encore redémarré avec la nouvelle colonne
    with Sessions() as s:
        u = s.scalar(select(Utilisateur).where(func.lower(Utilisateur.email) == email))
        if u is None:
            print(f"Personne avec l'adresse {email} : qu'elle se connecte d'abord une fois à l'appli.")
            return 1
        u.super_user = not retirer
        s.commit()
        print(f"{u.pseudo or email} {'n’est plus' if retirer else 'est maintenant'} Super User.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
