// Écrit par deploy/comptes/powersync.py (python powersync.py schema) : ne pas modifier à la main.
import { column, Schema, Table } from '@powersync/web';

/** Ce qui part au serveur : jamais gardé ici une fois envoyé. */
const ops = new Table({ type: column.text, corps: column.text }, { insertOnly: true });
const utilisateurs = new Table({ pseudo: column.text, photo: column.text, initiale_prenom: column.text, initiale_nom: column.text, voiture_modele: column.text, voiture_forme: column.text, voiture_couleur: column.text });
const groupes = new Table({ nom: column.text, nature: column.text, photo: column.text, organisation_id: column.text, activite: column.text, description: column.text, cree_par: column.text, cree_le: column.text, modifie_le: column.text, supprime_le: column.text });
const membres = new Table({ groupe_id: column.text, utilisateur_id: column.text, role: column.text, rejoint_le: column.text });
const invitations = new Table({ code: column.text, groupe_id: column.text, invite_par: column.text, email: column.text, sortie_id: column.text, canal: column.text, nom: column.text, contact: column.text, acceptee_par: column.text, mail: column.text, expire_le: column.text, cree_le: column.text, approbation: column.integer });
const demandes_entree = new Table({ groupe_id: column.text, utilisateur_id: column.text, cree_le: column.text });
const sorties = new Table({ groupe_id: column.text, nom: column.text, photo: column.text, debut: column.text, fin: column.text, lieu: column.text, cree_par: column.text, cree_le: column.text, modifie_le: column.text, supprime_le: column.text });
const participants = new Table({ sortie_id: column.text, utilisateur_id: column.text });
const traces = new Table({ sortie_id: column.text, groupe_id: column.text, nom: column.text, ligne: column.text, mot: column.text, par: column.text, cree_le: column.text });
const plannings = new Table({ groupe_id: column.text, nom: column.text, dates: column.text, limite: column.text, cree_par: column.text, cree_le: column.text, modifie_le: column.text });
const dispos = new Table({ planning_id: column.text, utilisateur_id: column.text, debut: column.text, etat: column.text, mot: column.text });
const photos = new Table({ sortie_id: column.text, par: column.text, prise_le: column.text, lon: column.real, lat: column.real, etoile: column.integer, envoyee: column.integer, video: column.integer, cree_le: column.text, modifie_le: column.text });
const recits = new Table({ sortie_id: column.text, utilisateur_id: column.text, texte: column.text, modifie_le: column.text });
const fiches_jour = new Table({ sortie_id: column.text, jour: column.text, nom: column.text, depart: column.text, duree: column.integer, distance: column.integer, denivele: column.integer, modifie_le: column.text });
const carnets = new Table({ sortie_id: column.text, difficulte: column.text, meteo: column.text, conditions: column.text, modifie_le: column.text });
const buddy_counts = new Table({ groupe_id: column.text, sortie_id: column.text, nom: column.text, ferme: column.integer, supprime_le: column.text, par: column.text, cree_le: column.text, modifie_le: column.text });
const depenses = new Table({ sortie_id: column.text, count_id: column.text, titre: column.text, montant: column.integer, paye_par: column.text, pour: column.text, jour: column.text, par: column.text, cree_le: column.text, modifie_le: column.text, remb: column.text, moyen: column.text, supprime_le: column.text });
const positions = new Table({ sortie_id: column.text, utilisateur_id: column.text, depuis: column.integer, jusqu: column.integer, lon: column.real, lat: column.real, alt: column.real, prise_le: column.integer, modifie_le: column.text });
const positions_groupes = new Table({ groupe_id: column.text, utilisateur_id: column.text, depuis: column.integer, jusqu: column.integer, lon: column.real, lat: column.real, alt: column.real, prise_le: column.integer, modifie_le: column.text });
const voitures = new Table({ utilisateur_id: column.text, lon: column.real, lat: column.real, garee_le: column.integer, jusqu: column.integer, modifie_le: column.text });
const hebergements = new Table({ sortie_id: column.text, nom: column.text, nature: column.text, prix_nuit: column.integer, adresse: column.text, url: column.text, resume: column.text, lon: column.real, lat: column.real, retenu: column.integer, par: column.text, cree_le: column.text, modifie_le: column.text });
const coeurs = new Table({ hebergement_id: column.text, utilisateur_id: column.text });
const messages_buddies = new Table({ groupe_id: column.text, sortie_id: column.text, par: column.text, nature: column.text, texte: column.text, lon: column.real, lat: column.real, photo_id: column.text, bud: column.integer, repond_a: column.text, edite_le: column.text, supprime: column.integer, fichier_id: column.text, sondage: column.text, transfere: column.integer, planning_id: column.text, cree_le: column.text, modifie_le: column.text });
const reactions_buddies = new Table({ message_id: column.text, utilisateur_id: column.text, emoji: column.text, cree_le: column.text });
const votes_buddies = new Table({ message_id: column.text, utilisateur_id: column.text, option: column.integer, cree_le: column.text });
const fichiers_buddies = new Table({ par: column.text, nom: column.text, mime: column.text, taille: column.integer, envoye: column.integer, cree_le: column.text });
const lectures_buddies = new Table({ utilisateur_id: column.text, cle: column.text, lu_le: column.text });
const appels = new Table({ groupe_id: column.text, sortie_id: column.text, par: column.text, en_ligne: column.text, debut: column.text, fin: column.text });
const blocages = new Table({ utilisateur_id: column.text, bloque_id: column.text, cree_le: column.text });

export const SCHEMA = new Schema({ ops, utilisateurs, groupes, membres, invitations, demandes_entree, sorties, participants, traces, plannings, dispos, photos, recits, fiches_jour, carnets, buddy_counts, depenses, positions, positions_groupes, voitures, hebergements, coeurs, messages_buddies, reactions_buddies, votes_buddies, fichiers_buddies, lectures_buddies, appels, blocages });
