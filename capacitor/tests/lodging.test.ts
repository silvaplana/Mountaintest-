import { describe, expect, it } from 'vitest';
import { liensSites } from '../src/Lodging';

describe('liensSites', () => {
  it('fills place, dates and people on the three sites', () => {
    const [b, a, ab] = liensSites('Val d\'Isère', '2026-12-31', 2, 5);
    expect(b.url).toBe("https://www.booking.com/searchresults.fr.html?ss=Val%20d'Is%C3%A8re&checkin=2026-12-31&checkout=2027-01-02&group_adults=5&no_rooms=1&group_children=0");
    expect(a.url).toBe("https://www.airbnb.fr/s/Val%20d'Is%C3%A8re/homes?checkin=2026-12-31&checkout=2027-01-02&adults=5");
    expect(ab.url).toContain('startDate=2026-12-31&endDate=2027-01-02&adults=5');
  });
  it('day trip counts one night, at least one person', () => {
    const [b] = liensSites('Ceillac', '2026-03-28', 0, 0);
    expect(b.url).toContain('checkin=2026-03-28&checkout=2026-03-29&group_adults=1');
  });
});
