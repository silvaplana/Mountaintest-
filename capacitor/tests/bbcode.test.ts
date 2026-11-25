import { describe, expect, it } from 'vitest';
import { bbParts } from '../src/ski/bbcode';
import { topoId } from '../src/ski/skitour';

describe('BBCode des textes skitour', () => {
  it('lien [url=…] : texte du lien et adresse, sans balise brute', () => {
    const p = bbParts('Du sommet (atteint par le [url=http://www.skitour.fr/topos/pointe-de-fleurendon,1997.html]couloir Sud[/url]), descendre');
    expect(p.map((x) => x.text).join('')).toBe('Du sommet (atteint par le couloir Sud), descendre');
    expect(p[1]).toEqual({ text: 'couloir Sud', url: 'http://www.skitour.fr/topos/pointe-de-fleurendon,1997.html' });
  });
  it('[url]adresse[/url], gras, italique ; [color] retiré, crochets ordinaires gardés', () => {
    const p = bbParts('[b]Attention[/b] [i]cotation[/i] [4.1] [color=red]rouge[/color] [url]https://a.fr/x[/url]');
    expect(p.map((x) => x.text).join('')).toBe('Attention cotation [4.1] rouge https://a.fr/x');
    expect(p[0]).toEqual({ text: 'Attention', b: true });
    expect(p[2]).toEqual({ text: 'cotation', i: true });
    expect(p[p.length - 1]).toEqual({ text: 'https://a.fr/x', url: 'https://a.fr/x' });
  });
  it('numéro de topo dans les deux formes de lien', () => {
    expect(topoId('https://skitour.fr/topos/1997')).toBe(1997);
    expect(topoId('http://www.skitour.fr/topos/pointe-de-fleurendon,1997.html')).toBe(1997);
    expect(topoId('https://skitour.fr/sorties/123')).toBeNull();
  });
});
