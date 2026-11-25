import type { ReactNode } from 'react';

/** Morceau de texte d'un topo ou d'une sortie skitour.fr, une fois les balises BBCode lues. */
export interface BbPart { text: string; b?: boolean; i?: boolean; u?: boolean; url?: string }

const TAG = /\[(\/?)(b|i|u|s|url|color|size|quote|img|center|list|\*)(?:=([^\]]*))?\]/gi;

/** Lit les balises BBCode de skitour.fr ([url=…]…[/url], [b], [i], [u]…) ; les autres ([color], [size]…) sont retirées. */
export function bbParts(text: string): BbPart[] {
  const out: BbPart[] = [];
  const st = { b: 0, i: 0, u: 0 };
  let url: string | null = null, last = 0;
  const push = (s: string) => {
    if (!s) return;
    const p: BbPart = { text: s };
    if (st.b) p.b = true; if (st.i) p.i = true; if (st.u) p.u = true;
    if (url != null) p.url = url || s;
    out.push(p);
  };
  for (const m of text.matchAll(TAG)) {
    push(text.slice(last, m.index));
    last = m.index! + m[0].length;
    const close = m[1] === '/', tag = m[2].toLowerCase();
    if (tag === 'b' || tag === 'i' || tag === 'u') st[tag] = Math.max(0, st[tag] + (close ? -1 : 1));
    else if (tag === 'url') {
      url = close ? null : (m[3] ?? '').trim().replace(/^["']|["']$/g, '');
    } else if (tag === '*' && !close) push('• ');
  }
  push(text.slice(last));
  return out;
}

/** Texte BBCode affiché : liens cliquables (un topo skitour s'ouvre par onLink si elle le prend), gras, italique. */
export function BbText({ text, onLink }: { text: string; onLink: (url: string, label: string) => void }): ReactNode {
  return bbParts(text).map((p, k) => {
    let n: ReactNode = p.text;
    if (p.b) n = <b>{n}</b>;
    if (p.i) n = <i>{n}</i>;
    if (p.u) n = <u>{n}</u>;
    if (p.url) n = <a href={p.url} onClick={(e) => { e.preventDefault(); onLink(p.url!, p.text); }}>{n}</a>;
    return <span key={k}>{n}</span>;
  });
}
