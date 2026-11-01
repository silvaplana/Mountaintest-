import { useEffect, useState } from 'react';

/** Historique généré par la CI (shared/changelog.py) et embarqué dans l'appli : public/changelog.json. */
interface Changelog { build: number; entries: { date: string; title: string; details: string[]; commit: string }[] }

export function Versions() {
  const [log, setLog] = useState<Changelog | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('./changelog.json')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(setLog)
      .catch(() => setError("Historique absent de cette version (il est ajouté par la compilation GitHub)."));
  }, []);

  if (error) return <p className="hint">{error}</p>;
  if (!log) return <p className="hint">Chargement…</p>;
  return (
    <div className="versions">
      <p className="hint">Version installée : <b>{log.build}</b>. Les changements les plus récents sont en haut.</p>
      {log.entries.map((e) => (
        <article key={e.commit}>
          <h4>{e.title}</h4>
          <p className="hint">{formatDate(e.date)}</p>
          {e.details.length > 0 && <ul>{e.details.map((d, i) => <li key={i}>{d}</li>)}</ul>}
        </article>
      ))}
    </div>
  );
}

function formatDate(iso: string) {
  const [d, t] = iso.split(' ');
  const [y, m, day] = d.split('-');
  return `${day}/${m}/${y} à ${t?.replace(':', 'h') ?? ''}`;
}
