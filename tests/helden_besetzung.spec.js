import { test, expect } from '@playwright/test';
import { isolateDb, fakeLogin, collectErrors } from './helpers.js';

// Helden-Besetzung: welcher Held in welchem Platz einer der vier Truppen steht.
// Der Name lässt sich aus dem Truppen-Screenshot nicht lesen (nur Portraits,
// kein Text) — deshalb Handeingabe je Platz, Typ (Tank/Air/Missile) kommt aus
// dem Katalog lw_helden. Siehe db/2026-09-20_ws_player_heroes.sql.

const SPIELER = { name: 'Testlauf', role: 'R5', active: true };
const KATALOG = [{ name: 'Kimberly', typ: 'T' }, { name: 'DVA', typ: 'A' }, { name: 'Adam', typ: 'M' }];

async function gotoProfilMitKatalog(page, { katalog = KATALOG, besetzung = [] } = {}) {
  await isolateDb(page);
  await page.goto('/index.html');
  await fakeLogin(page, { players: [SPIELER] });
  await page.evaluate(({ katalog, besetzung }) => {
    window.APP.data.heldenKatalog = katalog;
    window.APP.data.heldenBesetzung = besetzung;
    window.nav('profil');
  }, { katalog, besetzung });
}

test('zeigt 20 Auswahlfelder, gruppiert in vier Truppen zu je fünf Plätzen', async ({ page }) => {
  const errors = collectErrors(page);
  await gotoProfilMitKatalog(page);
  await expect(page.locator('select[id^="held_"]')).toHaveCount(20);
  for (let t = 1; t <= 4; t++) for (let s = 0; s < 5; s++) {
    await expect(page.locator(`#held_${t}_${s}`)).toBeAttached();
  }
  expect(errors.relevant).toEqual([]);
});

test('der Katalog liefert die Optionen, mit Typ-Symbol vor dem Namen', async ({ page }) => {
  await gotoProfilMitKatalog(page);
  const optionen = await page.locator('#held_1_0 option').allTextContents();
  expect(optionen).toContain('– unbekannt –');
  expect(optionen.find((o) => o.includes('Kimberly'))).toContain('🛡');
  expect(optionen.find((o) => o.includes('DVA'))).toContain('✈');
});

test('eine gespeicherte Zuordnung steht vorbelegt da', async ({ page }) => {
  await gotoProfilMitKatalog(page, {
    besetzung: [{ player_name: 'Testlauf', truppe: 2, slot: 3, held: 'DVA', typ: 'A' }],
  });
  await expect(page.locator('#held_2_3')).toHaveValue('DVA');
  // Ein Platz ohne Eintrag bleibt auf „unbekannt" — kein Vorgabewert.
  await expect(page.locator('#held_1_0')).toHaveValue('');
});

test('ein Name, der nicht im Katalog steht, bleibt trotzdem als Option sichtbar', async ({ page }) => {
  // So verschwindet ein bereits zugeordneter, aber (noch) nicht katalogisierter
  // Held nicht beim nächsten Rendern der Seite.
  await gotoProfilMitKatalog(page, {
    besetzung: [{ player_name: 'Testlauf', truppe: 3, slot: 1, held: 'GanzNeuerHeld', typ: null }],
  });
  await expect(page.locator('#held_3_1')).toHaveValue('GanzNeuerHeld');
});

test('Speichern schickt genau die gesetzten Plätze als Upsert, mit Typ aus dem Katalog', async ({ page }) => {
  await gotoProfilMitKatalog(page);
  await page.selectOption('#held_1_0', 'Kimberly');
  await page.selectOption('#held_2_4', 'Adam');

  const gesendet = await page.evaluate(async () => {
    const echt = window.fetch;
    const calls = [];
    window.fetch = (url, opt) => {
      if (String(url).includes('ws_player_heroes')) calls.push({ url: String(url), body: opt?.body ? JSON.parse(opt.body) : null });
      return echt(url, opt);
    };
    await window.saveHelden();
    window.fetch = echt;
    return calls;
  });

  // Ein Upsert-Aufruf mit genau den zwei gesetzten Plätzen — die 18 leeren
  // Plätze erzeugen keinen Schreibversuch, nur ggf. einen gezielten Löschversuch.
  const upsert = gesendet.find((c) => c.url.includes('on_conflict'));
  expect(upsert).toBeTruthy();
  expect(upsert.body).toEqual(expect.arrayContaining([
    expect.objectContaining({ player_name: 'Testlauf', truppe: 1, slot: 0, held: 'Kimberly', typ: 'T' }),
    expect.objectContaining({ player_name: 'Testlauf', truppe: 2, slot: 4, held: 'Adam', typ: 'M' }),
  ]));
  expect(upsert.body.length).toBe(2);
});

test('einen Platz auf „unbekannt" zurückstellen löscht die Zeile gezielt, statt sie stehenzulassen', async ({ page }) => {
  await gotoProfilMitKatalog(page, {
    besetzung: [{ player_name: 'Testlauf', truppe: 4, slot: 2, held: 'DVA', typ: 'A' }],
  });
  await page.selectOption('#held_4_2', '');

  const geloescht = await page.evaluate(async () => {
    const echt = window.fetch;
    const calls = [];
    window.fetch = (url, opt) => {
      if (String(url).includes('ws_player_heroes')) calls.push({ url: String(url), method: opt?.method });
      return echt(url, opt);
    };
    await window.saveHelden();
    window.fetch = echt;
    return calls;
  });
  expect(geloescht.some((c) => c.method === 'DELETE' && c.url.includes('truppe=eq.4') && c.url.includes('slot=eq.2'))).toBe(true);
});
