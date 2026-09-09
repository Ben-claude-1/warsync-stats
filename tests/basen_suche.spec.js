import { test, expect } from '@playwright/test';
import { isolateDb, fakeLogin, ALLIANZ_A } from './helpers.js';

// Die Basen der Weltkarte und ihre Namenssuche.
//
// Zwei Dinge stehen hier auf dem Spiel, und beide sind still, wenn sie brechen:
//
// * **Der Server-Filter.** `karte_basen` ist bewusst nicht mandantengetrennt —
//   die Karte gehört dem Server, nicht der Allianz. Damit fällt die Wache in
//   api.js weg, und ein vergessener Filter zeigte die Karte einer fremden Welt.
// * **Was getippt wird, meint sich selbst.** `%` und `_` sind SQL-Platzhalter,
//   und `_` steckt in echten Namen (Ben_the_men). Ungeschützt fände die Suche
//   nach dem eigenen Namen auch Namen, die nur so ähnlich aussehen.

const BASEN = [
  { name: 'Ben_the_men', name_roh: '[XP33]Ben_the_men', allianz: 'XP33', level: 30, x: 481, y: 554 },
  { name: 'Vixmaster', name_roh: '[XP33]Vixmaster', allianz: 'XP33', level: 28, x: 502, y: 540 },
  { name: 'Fremdling', name_roh: '[QQQ]Fremdling', allianz: 'QQQ', level: null, x: 12, y: 900 },
];

// Fängt die Abfragen auf karte_basen ab und merkt sich, wonach gefragt wurde.
// Muss NACH isolateDb() laufen — in Playwright gewinnt die zuletzt registrierte Route.
async function basenTabelle(page, zeilen = BASEN) {
  const fragen = [];
  await page.route('**/rest/v1/karte_basen*', async (route) => {
    const url = new URL(route.request().url());
    fragen.push(url.searchParams);
    const muster = url.searchParams.get('name');
    let rows = zeilen;
    if (muster) {
      // Das Muster so auswerten, wie Postgres es täte: * ist hier schon %,
      // \ maskiert das folgende Zeichen.
      const p = muster.replace(/^ilike\./, '');
      let re = '';
      for (let i = 0; i < p.length; i++) {
        const c = p[i];
        if (c === '\\') { re += p[++i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
        else if (c === '%') re += '.*';
        else if (c === '_') re += '.';
        else re += c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      }
      const rx = new RegExp('^' + re + '$', 'i');
      rows = zeilen.filter((b) => rx.test(b.name));
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(rows) });
  });
  return fragen;
}

async function oeffneBasen(page) {
  await page.evaluate(() => window.nav('basen'));
  await expect(page.locator('#bs-q')).toBeVisible();
}

test('zeigt Name, Allianz, Stufe und Koordinate', async ({ page }) => {
  await isolateDb(page);
  const fragen = await basenTabelle(page);
  await page.goto('/index.html');
  await fakeLogin(page);
  await oeffneBasen(page);

  const erste = page.locator('#bs-body tbody tr').first();
  await expect(erste).toContainText('Ben_the_men');
  await expect(erste).toContainText('XP33');
  await expect(erste).toContainText('30');
  await expect(erste).toContainText('X:481 Y:554');

  // Der Server der aktuellen Allianz muss in jeder Abfrage stehen. Ohne ihn
  // mischte die Liste die Karten verschiedener Welten.
  expect(fragen.length).toBeGreaterThan(0);
  for (const q of fragen) expect(q.get('server')).toBe('eq.' + ALLIANZ_A.server);
});

test('eine fehlende Stufe steht als Strich, nicht als Null', async ({ page }) => {
  await isolateDb(page);
  await basenTabelle(page, [BASEN[2]]);
  await page.goto('/index.html');
  await fakeLogin(page);
  await oeffneBasen(page);

  const zeile = page.locator('#bs-body tbody tr').first();
  await expect(zeile).toContainText('Fremdling');
  // Gezielt die Stufen-Spalte: die Koordinate daneben enthält selbst Nullen.
  await expect(zeile.locator('td').nth(2)).toHaveText('–');
});

// Ein Fund, dessen Name die Erkennung nicht lesen konnte, steht seit dem
// 09.09.2026 trotzdem in der Tabelle — mit Koordinate und Stufe, aber `name`
// NULL. Vorher flog er ganz heraus, und genau so fehlte Bens eigene Basis auf
// der Karte, obwohl der Scan sie gefunden hatte. Die Zeile darf deshalb weder
// leer aussehen noch einen Namen behaupten.
test('ohne lesbaren Namen bleibt die Basis mit Stufe stehen', async ({ page }) => {
  await isolateDb(page);
  await basenTabelle(page, [{ name: null, name_roh: 'zr >', allianz: null, level: 33, x: 481, y: 554 }]);
  await page.goto('/index.html');
  await fakeLogin(page);
  await oeffneBasen(page);

  const zeile = page.locator('#bs-body tbody tr').first();
  await expect(zeile).toContainText('X:481 Y:554');
  await expect(zeile.locator('td').nth(2)).toHaveText('33');
  // Der Rohtext steht an der Stelle des Namens — und nur einmal.
  await expect(zeile.locator('td').first()).toHaveText('zr >');
});

test('Ben*men findet Ben_the_men', async ({ page }) => {
  await isolateDb(page);
  const fragen = await basenTabelle(page);
  await page.goto('/index.html');
  await fakeLogin(page);
  await oeffneBasen(page);

  await page.fill('#bs-q', 'Ben*men');
  await expect(page.locator('#bs-body tbody tr')).toHaveCount(1);
  await expect(page.locator('#bs-body tbody tr').first()).toContainText('Ben_the_men');

  // Der Stern wird zum SQL-Platzhalter, und zwar genau er.
  const letzte = fragen[fragen.length - 1];
  expect(letzte.get('name')).toBe('ilike.Ben%men');
});

test('ohne Stern wird überall im Namen gesucht, Groß/Klein egal', async ({ page }) => {
  await isolateDb(page);
  const fragen = await basenTabelle(page);
  await page.goto('/index.html');
  await fakeLogin(page);
  await oeffneBasen(page);

  await page.fill('#bs-q', 'MASTER');
  await expect(page.locator('#bs-body tbody tr')).toHaveCount(1);
  await expect(page.locator('#bs-body tbody tr').first()).toContainText('Vixmaster');
  expect(fragen[fragen.length - 1].get('name')).toBe('ilike.%MASTER%');
});

test('getippte Unterstriche sind Zeichen, keine Platzhalter', async ({ page }) => {
  await isolateDb(page);
  const fragen = await basenTabelle(page, [
    ...BASEN,
    // Unterscheidet sich von Ben_the_men nur an den Stellen der Unterstriche.
    { name: 'BenXtheXmen', name_roh: '', allianz: 'QQQ', level: 20, x: 1, y: 1 },
  ]);
  await page.goto('/index.html');
  await fakeLogin(page);
  await oeffneBasen(page);

  await page.fill('#bs-q', 'Ben_the_men');
  await expect(page.locator('#bs-body tbody tr')).toHaveCount(1);
  await expect(page.locator('#bs-body tbody tr').first()).toContainText('Ben_the_men');
  expect(fragen[fragen.length - 1].get('name')).toBe('ilike.%Ben\\_the\\_men%');
});

test('die Suche behält den Fokus im Feld', async ({ page }) => {
  await isolateDb(page);
  await basenTabelle(page);
  await page.goto('/index.html');
  await fakeLogin(page);
  await oeffneBasen(page);

  // Ein renderPage() bei jedem Anschlag nähme dem Feld Fokus und Schreibmarke;
  // getippt würde dann ins Leere. Erneuert werden darf nur #bs-body.
  await page.click('#bs-q');
  await page.type('#bs-q', 'Vix');
  await expect(page.locator('#bs-body tbody tr')).toHaveCount(1);
  await expect(page.locator('#bs-q')).toBeFocused();
  await expect(page.locator('#bs-q')).toHaveValue('Vix');
});

test('keine Treffer wird anders erklärt als kein Scan', async ({ page }) => {
  await isolateDb(page);
  await basenTabelle(page, []);
  await page.goto('/index.html');
  await fakeLogin(page);
  await oeffneBasen(page);

  await expect(page.locator('#bs-body')).toContainText('noch keine Basen gespeichert');
  await page.fill('#bs-q', 'Niemand');
  await expect(page.locator('#bs-body')).toContainText('Keine Basis gefunden');
});
