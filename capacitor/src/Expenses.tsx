import { useEffect, useRef, useState } from 'react';
import {
  balances, loadGroups, memberName, money, newId, paidBy, saveGroups, settlements, total,
  type Expense, type Group, type Member,
} from './expenses/expenses';
import { RELAIS_URL } from './trails/webHikes';
import { relayPost } from './travel/travel';
import { shrinkPhoto } from './expenses/expenses';

export const ShareIcon = () => (
  <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true">
    <g stroke="#fff" strokeWidth="0.8" strokeLinejoin="round">
      <path d="M10 10 L10 2 A8 8 0 0 1 16.93 14 Z" fill="#f2a33a" />
      <path d="M10 10 L16.93 14 A8 8 0 0 1 3.07 14 Z" fill="#e4572e" />
      <path d="M10 10 L3.07 14 A8 8 0 0 1 10 2 Z" fill="#2f9e44" />
    </g>
    <circle cx="16.5" cy="16.5" r="6" fill="#f5c518" stroke="#9a6b00" strokeWidth="1" />
    <path d="M18.6 14.4c-.4-.6-1.1-.9-2-.9-1.1 0-1.9.6-1.9 1.4 0 1.9 4 1 4 3 0 .8-.9 1.5-2.1 1.5-1 0-1.8-.4-2.2-1M16.5 12.2v8.6"
      fill="none" stroke="#5a3d00" strokeWidth="1.3" strokeLinecap="round" />
  </svg>
);

type Screen = { k: 'list' } | { k: 'edit'; id: string | null } | { k: 'group'; id: string; tab: 'dep' | 'eq' } | { k: 'expense'; gid: string; id: string | null };

/** Invitation par e-mail via le relais (Brevo, comme contretemps) ; sinon l'appli mail du téléphone, pré-remplie. */
async function invite(m: Member, g: Group, password: string): Promise<string> {
  const de = memberName(g, g.me);
  try {
    const tries = password.split('\n').filter(Boolean);
    let res: Response | null = null;
    for (const p of tries) {
      res = await fetch(RELAIS_URL.replace(/\/randos$/, '/invitation'), {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Mot-De-Passe': p },
        body: JSON.stringify({ email: m.email, nom: m.name, groupe: g.name, de }),
      });
      if (res.status !== 401) break;
    }
    if (res?.ok) return `Invitation envoyée à ${m.email}`;
  } catch { /* pas de réseau : on passe à l'appli mail */ }
  const body = `Bonjour ${m.name},\n\n${de} t'invite à partager les frais du groupe « ${g.name} » dans l'appli Assomoutain.\n\nPour l'installer (Android) : https://silvaplana.cloud/mountaintest/apk/`;
  window.open(`mailto:${encodeURIComponent(m.email ?? '')}?subject=${encodeURIComponent(`Partage des frais « ${g.name} »`)}&body=${encodeURIComponent(body)}`, '_system');
  return 'Envoi direct impossible : ton appli mail s’ouvre avec le message prêt';
}

export function Expenses({ password, onClose, onToast }: { password: string; onClose: () => void; onToast: (m: string) => void }) {
  const [groups, setGroups] = useState<Group[]>(loadGroups);
  const [screen, setScreen] = useState<Screen>({ k: 'list' });
  useEffect(() => { saveGroups(groups); }, [groups]);
  const put = (g: Group) => setGroups((gs) => (gs.some((x) => x.id === g.id) ? gs.map((x) => (x.id === g.id ? g : x)) : [...gs, g]));

  if (screen.k === 'edit') {
    const g = groups.find((x) => x.id === screen.id);
    return <GroupForm initial={g} onCancel={() => setScreen(g ? { k: 'group', id: g.id, tab: 'dep' } : { k: 'list' })}
      onDelete={g ? () => { if (confirm(`Supprimer le groupe « ${g.name} » et ses dépenses ?`)) { setGroups((gs) => gs.filter((x) => x.id !== g.id)); setScreen({ k: 'list' }); } } : undefined}
      onSave={(n) => { put(n); setScreen({ k: 'group', id: n.id, tab: 'dep' }); }}
      onInvite={async (m, n) => { put(n); onToast(await invite(m, n, password)); }} />;
  }
  if (screen.k === 'expense') {
    const g = groups.find((x) => x.id === screen.gid)!;
    const e = g.expenses.find((x) => x.id === screen.id);
    const back = () => setScreen({ k: 'group', id: g.id, tab: 'dep' });
    return <ExpenseForm g={g} initial={e} onCancel={back} password={password}
      onDelete={e ? () => { put({ ...g, expenses: g.expenses.filter((x) => x.id !== e.id) }); back(); } : undefined}
      onSave={(n) => { put({ ...g, expenses: e ? g.expenses.map((x) => (x.id === n.id ? n : x)) : [n, ...g.expenses] }); back(); }} />;
  }
  const shown = screen.k === 'group' ? groups.find((x) => x.id === screen.id) : undefined;
  if (screen.k === 'group' && shown) {
    const g = shown;
    const b = balances(g);
    return (
      <div className="expenses">
        <div className="xp-head"><button onClick={() => setScreen({ k: 'list' })} aria-label="Retour">←</button><span /><button onClick={() => setScreen({ k: 'edit', id: g.id })}>Modifier</button></div>
        <div className="xp-title"><h2>{g.name}</h2>
          <small>{g.members.map((m) => m.name).join(', ')}</small></div>
        <div className="xp-tabs">
          <button className={screen.tab === 'dep' ? 'on' : ''} onClick={() => setScreen({ ...screen, tab: 'dep' })}>Dépenses</button>
          <button className={screen.tab === 'eq' ? 'on' : ''} onClick={() => setScreen({ ...screen, tab: 'eq' })}>Équilibres</button>
        </div>
        {screen.tab === 'dep' ? <>
          <div className="xp-totals"><div><small>Mes dépenses</small><b>{money(paidBy(g, g.me))}</b></div><div><small>Total des dépenses</small><b>{money(total(g))}</b></div></div>
          {g.expenses.length === 0 && <p className="hint">Aucune dépense : touche + pour en ajouter une.</p>}
          {g.expenses.map((e) => (
            <button key={e.id} className="xp-row" onClick={() => setScreen({ k: 'expense', gid: g.id, id: e.id })}>
              <span><b>{e.title}</b><small>Payé par {memberName(g, e.paidBy)}{e.paidBy === g.me ? ' (moi)' : ''} · {new Date(e.date).toLocaleDateString('fr-FR')}</small></span>
              <b>{money(e.amount)}</b>
            </button>
          ))}
          <button className="xp-add" onClick={() => setScreen({ k: 'expense', gid: g.id, id: null })} aria-label="Ajouter une dépense">+</button>
        </> : <>
          {g.members.map((m) => (
            <div key={m.id} className="xp-bal"><span>{m.name}{m.id === g.me ? ' (moi)' : ''}</span>
              <b className={b[m.id] > 0.004 ? 'plus' : b[m.id] < -0.004 ? 'minus' : ''}>{b[m.id] > 0 ? '+' : ''}{money(b[m.id])}</b></div>
          ))}
          <h3>Comment équilibrer</h3>
          {settlements(g).length === 0 ? <p className="hint">Tout est équilibré.</p> : settlements(g).map((s, i) => (
            <div key={i} className="xp-row static"><span><b>{memberName(g, s.from)}</b> doit à <b>{memberName(g, s.to)}</b></span><b>{money(s.amount)}</b></div>
          ))}
        </>}
      </div>
    );
  }
  return (
    <div className="expenses">
      <div className="xp-head"><button onClick={onClose} aria-label="Fermer">✕</button><b>💰 Partage des frais</b><span /></div>
      {groups.length === 0 && <p className="hint">Aucun groupe de dépenses : touche + pour en créer un (un voyage, une sortie…).</p>}
      {groups.map((g) => (
        <button key={g.id} className="xp-group" onClick={() => setScreen({ k: 'group', id: g.id, tab: 'dep' })}>
          <b>{g.name}</b><span>›</span>
        </button>
      ))}
      <button className="xp-add" onClick={() => setScreen({ k: 'edit', id: null })} aria-label="Nouveau groupe de dépenses">+</button>
    </div>
  );
}

function GroupForm({ initial, onSave, onCancel, onDelete, onInvite }: {
  initial?: Group; onSave: (g: Group) => void; onCancel: () => void; onDelete?: () => void; onInvite: (m: Member, g: Group) => Promise<void>;
}) {
  const [g, setG] = useState<Group>(() => initial ?? { id: newId(), name: '', emoji: '💰', members: [{ id: newId(), name: '' }, { id: newId(), name: '' }], me: '', expenses: [] });
  const [sending, setSending] = useState('');
  const me = g.me || g.members[0]?.id;
  const setM = (id: string, v: Partial<Member>) => setG({ ...g, members: g.members.map((m) => (m.id === id ? { ...m, ...v } : m)) });
  const [err, setErr] = useState('');
  // Toujours enregistrable : sans titre, le groupe prend la date du jour ; il faut juste au moins un nom.
  const clean = (): Group | null => {
    const members = g.members.map((m) => ({ ...m, name: m.name.trim(), email: m.email?.trim() || undefined })).filter((m) => m.name);
    if (!members.length) { setErr('Écris au moins un nom de participant'); return null; }
    const name = g.name.trim() || `Dépenses du ${new Date().toLocaleDateString('fr-FR')}`;
    return { ...g, name, members, me: members.some((m) => m.id === me) ? me : members[0].id };
  };
  const used = new Set(g.expenses.flatMap((e) => [e.paidBy, ...e.forIds]));
  return (
    <div className="expenses">
      <div className="xp-head"><button onClick={onCancel}>Annuler</button><b>{initial ? 'Modifier le groupe' : 'Nouveau groupe'}</b><span /></div>
      <label className="field">Titre<input value={g.name} onChange={(e) => setG({ ...g, name: e.target.value })} placeholder="ex. Ski 2026" /></label>
      <h3>Participants</h3>
      <p className="hint">Pour l'instant juste un nom. L'e-mail sert à inviter la personne (lien pour installer l'appli). « Moi » : coche-toi.</p>
      {g.members.map((m, i) => (
        <div key={m.id} className="xp-member">
          <input type="radio" name="me" checked={me === m.id} onChange={() => setG({ ...g, me: m.id })} aria-label="C'est moi" />
          <div>
            <input value={m.name} onChange={(e) => setM(m.id, { name: e.target.value })} placeholder={`Participant ${i + 1}`} />
            <input type="email" value={m.email ?? ''} onChange={(e) => setM(m.id, { email: e.target.value })} placeholder="e-mail (facultatif)" autoCapitalize="off" />
          </div>
          <div className="xp-member-btns">
            {m.email && /\S+@\S+\.\S+/.test(m.email) && m.id !== me && <button disabled={!!sending} onClick={async () => {
              const n = clean(); if (!n) return;
              setSending(m.id); await onInvite({ ...m, name: m.name.trim(), email: m.email!.trim() }, n); setSending('');
            }}>{sending === m.id ? '…' : 'Inviter'}</button>}
            {!used.has(m.id) && <button onClick={() => setG({ ...g, members: g.members.filter((x) => x.id !== m.id) })} aria-label="Retirer">✕</button>}
          </div>
        </div>
      ))}
      <button onClick={() => setG({ ...g, members: [...g.members, { id: newId(), name: '' }] })}>+ Ajouter un participant</button>
      {err && <p className="error">{err}</p>}
      <button className="primary" onClick={() => { const n = clean(); if (n) onSave(n); }}>Enregistrer</button>
      {onDelete && <button className="danger" onClick={onDelete}>Supprimer le groupe</button>}
    </div>
  );
}

function ExpenseForm({ g, initial, onSave, onCancel, onDelete, password }: {
  g: Group; initial?: Expense; password: string; onSave: (e: Expense) => void; onCancel: () => void; onDelete?: () => void;
}) {
  const [title, setTitle] = useState(initial?.title ?? '');
  const [amount, setAmount] = useState(initial ? String(initial.amount).replace('.', ',') : '');
  const [by, setBy] = useState(initial?.paidBy ?? g.me);
  const [forIds, setFor] = useState<string[]>(initial?.forIds ?? g.members.map((m) => m.id));
  const [date, setDate] = useState(initial?.date ?? new Date().toISOString().slice(0, 10));
  const value = Number(amount.replace(',', '.').replace(/\s/g, ''));
  const [err, setErr] = useState('');
  // 📷 Photo d'une facture : Claude lit le titre, le montant et la date.
  const file = useRef<HTMLInputElement>(null);
  const [reading, setReading] = useState(false);
  async function readBill(f: File) {
    setReading(true); setErr('');
    try {
      const r = await relayPost<{ titre?: string; montant?: number | null; date?: string | null }>('facture', { image: await shrinkPhoto(f), type: 'image/jpeg' }, password);
      if (r.titre) setTitle(r.titre);
      if (r.montant != null) setAmount(String(r.montant).replace('.', ','));
      if (r.date && /^\d{4}-\d{2}-\d{2}$/.test(r.date)) setDate(r.date);
      if (r.montant == null) setErr('Montant illisible sur la photo : tape-le');
    } catch (e) { setErr(`Lecture impossible : ${e instanceof TypeError ? 'pas de réseau' : (e as Error).message}`); }
    setReading(false);
  }
  return (
    <div className="expenses">
      <div className="xp-head"><button onClick={onCancel}>Annuler</button><b>{initial ? 'Modifier la dépense' : 'Nouvelle dépense'}</b><span /></div>
      <input ref={file} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void readBill(f); }} />
      <button disabled={reading || !password} onClick={() => file.current?.click()}>{reading ? 'Claude lit la facture…' : '📷 Photo de la facture (remplit titre et montant)'}</button>
      <label className="field">Titre<input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="ex. Courses, essence, gîte…" /></label>
      <label className="field">Montant (€)<input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0,00" /></label>
      <label className="field">Payé par<select value={by} onChange={(e) => setBy(e.target.value)}>
        {g.members.map((m) => <option key={m.id} value={m.id}>{m.name}{m.id === g.me ? ' (moi)' : ''}</option>)}</select></label>
      <label className="field">Date<input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
      <h3>Pour qui</h3>
      {g.members.map((m) => (
        <label key={m.id} className="check xp-for">
          <input type="checkbox" checked={forIds.includes(m.id)} onChange={(e) => setFor(e.target.checked ? [...forIds, m.id] : forIds.filter((x) => x !== m.id))} />
          <span>{m.name}</span><small>{forIds.includes(m.id) && value > 0 ? money(value / forIds.length) : ''}</small>
        </label>
      ))}
      {err && <p className="error">{err}</p>}
      <button className="primary" onClick={() => {
        if (!(value > 0)) { setErr('Indique le montant'); return; }
        if (!forIds.length) { setErr('Coche au moins une personne'); return; }
        onSave({ id: initial?.id ?? newId(), title: title.trim() || 'Dépense', amount: Math.round(value * 100) / 100, paidBy: by, forIds, date });
      }}>Enregistrer</button>
      {onDelete && <button className="danger" onClick={() => { if (confirm('Supprimer cette dépense ?')) onDelete(); }}>Supprimer la dépense</button>}
    </div>
  );
}
