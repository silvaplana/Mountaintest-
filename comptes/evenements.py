"""Flux temps réel (SSE), repris tel quel de la messagerie d'AppBase (contretemps :
backend/src/messagerie/evenements.py, Seb, 27/11 : « exactement comme AppBase »).

Un compte connecté ouvre UN flux (`GET /buddies/evenements`, serveur.py) par appareil ; il y reçoit un
événement à chaque changement qui le concerne. Ici l'événement ne porte pas la donnée : il dit « synchronise-toi »
et le téléphone fait sa synchro habituelle (une seule voie pour les données, celle du curseur).

Pas de Redis ni de courtier de messages : un seul processus uvicorn (serveur.py, `uvicorn.run(app)` sans
`workers`), un dictionnaire en mémoire suffit. À revoir si plusieurs processus servent l'API un jour.
"""
from __future__ import annotations

import asyncio
import uuid


class Evenements:
    """⚠️ Les routes FastAPI `def` (toutes celles de serveur.py) tournent dans un fil à part, jamais celui de la
    boucle asyncio qui fait vivre les flux. `publier()` passe donc par `loop.call_soon_threadsafe` :
    `asyncio.Queue` n'est pas sûre entre fils."""

    def __init__(self) -> None:
        self._abonnes: dict[uuid.UUID, list[asyncio.Queue]] = {}
        self._loop: asyncio.AbstractEventLoop | None = None

    def demarrer(self, loop: asyncio.AbstractEventLoop) -> None:
        """Appelé une fois au démarrage (serveur.py, `cycle`) : garde la VRAIE boucle, celle d'uvicorn."""
        self._loop = loop

    def abonner(self, qui: uuid.UUID) -> asyncio.Queue:
        queue: asyncio.Queue = asyncio.Queue()
        self._abonnes.setdefault(qui, []).append(queue)
        return queue

    def desabonner(self, qui: uuid.UUID, queue: asyncio.Queue) -> None:
        abonnes = self._abonnes.get(qui)
        if not abonnes or queue not in abonnes:
            return
        abonnes.remove(queue)
        if not abonnes:
            self._abonnes.pop(qui, None)

    def publier(self, qui: uuid.UUID, evenement: dict) -> None:
        """Pousse `evenement` sur tous les flux ouverts de ce compte (aucun, un, ou plusieurs appareils). Sans flux
        ouvert : rien, c'est le cas normal ; le téléphone se rattrape à sa prochaine synchro."""
        abonnes = self._abonnes.get(qui)
        if not abonnes:
            return
        for queue in list(abonnes):
            if self._loop is not None:
                self._loop.call_soon_threadsafe(queue.put_nowait, evenement)
            else:  # pas démarré (tests) : on est déjà sur le bon fil
                queue.put_nowait(evenement)
