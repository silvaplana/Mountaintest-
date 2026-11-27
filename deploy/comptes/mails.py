"""Mails envoyés par le serveur (Brevo, en SMTP comme AppBase : contretemps backend/src/auth/mails.py).

Configuration dans ~/mountaintest/comptes.env (copiée par installer-comptes.sh depuis celle de contretemps) :
SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, SMTP_FROM_EMAIL (mountainbuddies@silvaplana.cloud), SMTP_REPLY_TO.
Sans SMTP_HOST / USER / PASSWORD : rien ne part, l'invitation est marquée « mail non parti ».
"""
from __future__ import annotations

import logging
import os
import smtplib
import threading
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.utils import formataddr
from html import escape

log = logging.getLogger(__name__)
LIEN_APPLI = os.environ.get("LIEN_APPLI", "https://mountainbuddies.silvaplana.cloud/app/apk/")
LIEN_INVITATION = os.environ.get("LIEN_INVITATION", "https://mountainbuddies.silvaplana.cloud/app/rejoindre.html?c=")


def actif() -> bool:
    return all(os.environ.get(k) for k in ("SMTP_HOST", "SMTP_USER", "SMTP_PASSWORD"))


def envoyer(a: str, sujet: str, texte: str, html: str, nom: str = "Mountain Buddies", repondre_a: str | None = None) -> None:
    """Lève une exception si le mail ne part pas."""
    if not actif():
        raise RuntimeError("Pas de SMTP configuré sur ce serveur")
    expediteur = os.environ.get("SMTP_FROM_EMAIL") or os.environ["SMTP_USER"]
    m = MIMEMultipart("alternative")
    m["From"] = formataddr((nom, expediteur))
    m["To"] = a
    m["Subject"] = sujet
    if repondre_a or os.environ.get("SMTP_REPLY_TO"):
        m["Reply-To"] = repondre_a or os.environ["SMTP_REPLY_TO"]
    m.attach(MIMEText(texte, "plain", "utf-8"))
    m.attach(MIMEText(html, "html", "utf-8"))
    with smtplib.SMTP(os.environ["SMTP_HOST"], int(os.environ.get("SMTP_PORT") or 587), timeout=30) as smtp:
        smtp.starttls()
        smtp.login(os.environ["SMTP_USER"], os.environ["SMTP_PASSWORD"])
        smtp.sendmail(expediteur, [a], m.as_string())


def invitation(a: str, prenom: str, par: str, groupe: str, code: str, sortie: bool = False,
               repondre_a: str | None = None) -> None:
    """Le mail d'invitation (maquette maquettes/mail-invitation/). Lien écrit en clair, sans balise : Brevo
    réécrit tout lien cliquable vers son domaine de suivi (constaté dans AppBase le 2026-10-02)."""
    ou = f"la sortie « {groupe} »" if sortie else f"le groupe « {groupe} »"
    lien = LIEN_INVITATION + code
    paragraphes = [
        f"Salut {prenom}," if prenom else "Salut,",
        f"{par} t'invite dans {ou} sur Mountain Buddies, l'appli pour préparer et vivre nos sorties montagne "
        "ensemble : traces, photos, dépenses communes, positions, messages et bien plus encore.",
        f"Ouvre ce lien sur ton téléphone : il te propose d'installer l'appli et te fait entrer dans {'la sortie' if sortie else 'le groupe'}.",
    ]
    bouton = "Rejoindre la sortie" if sortie else "Rejoindre le groupe"
    fin = [
        "Ce lien est valable 30 jours.",
        f"Tu reçois ce mail parce que {par} a donné ton adresse dans Mountain Buddies. Si tu ne le connais pas, "
        "ignore-le simplement." + (" Pour lui répondre, réponds à ce mail." if repondre_a else ""),
    ]
    texte = "\n\n".join([*paragraphes, f"{bouton} :\n{lien}", *fin]) + "\n"
    envoyer(a, f"{par} t'invite dans « {groupe} » sur Mountain Buddies", texte, _html(paragraphes, bouton, lien, fin),
            repondre_a=repondre_a)


def _html(paragraphes: list[str], bouton: str, lien: str, fin: list[str]) -> str:
    p = '<p style="margin:0 0 16px">{}</p>'
    return (
        '<div style="font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.5;color:#16222f;max-width:520px">'
        '<p style="margin:0 0 18px;font-weight:bold;font-size:18px">Mountain Buddies</p>'
        + "".join(p.format(escape(x)) for x in paragraphes)
        + f'<p style="margin:24px 0 4px;font-weight:bold">{escape(bouton)} :</p>'
        + f'<p style="margin:0 0 24px;word-break:break-all">{escape(lien)}</p>'
        + "".join(f'<p style="margin:0 0 8px;font-size:13px;color:#5b6b7b">{escape(x)}</p>' for x in fin)
        + "</div>"
    )


def appli(a: str, prenom: str, par: str, repondre_a: str | None = None) -> None:
    """Inviter un ami à installer Mountain Buddies, depuis le profil (Seb, 26/11), sans groupe."""
    paragraphes = [
        f"Salut {prenom}," if prenom else "Salut,",
        f"{par} t'invite à installer Mountain Buddies, l'appli pour préparer et vivre nos sorties montagne "
        "ensemble : traces, photos, dépenses communes, positions, messages et bien plus encore.",
        "Ouvre ce lien sur ton téléphone pour la télécharger.",
    ]
    bouton = "Télécharger Mountain Buddies"
    fin = [f"Tu reçois ce mail parce que {par} a donné ton adresse dans Mountain Buddies. Si tu ne le connais pas, "
           "ignore-le simplement." + (" Pour lui répondre, réponds à ce mail." if repondre_a else "")]
    texte = "\n\n".join([*paragraphes, f"{bouton} :\n{LIEN_APPLI}", *fin]) + "\n"
    envoyer(a, f"{par} t'invite sur Mountain Buddies", texte, _html(paragraphes, bouton, LIEN_APPLI, fin), repondre_a=repondre_a)


def en_arriere_plan(tache) -> None:
    """La synchro du téléphone n'attend pas Brevo (remplacé par un appel direct dans les tests)."""
    threading.Thread(target=tache, daemon=True).start()
