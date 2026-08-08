import { test, expect } from '@playwright/test';
import { isolateDb, fakeLogin, collectErrors } from './helpers.js';

// Grundlast: startet die App überhaupt aus dem Bundle, und tragen die Brücken,
// über die das gerenderte HTML seine Handler findet.

test('startet und zeigt die Anmeldung', async ({ page }) => {
  const errors = collectErrors(page);
  await isolateDb(page);
  await page.goto('/index.html');
  await expect(page.locator('.login-card')).toBeVisible();
  await expect(page.locator('.login-title')).toHaveText('WarSync Stats');
  // Stylesheet liegt seit der Modularisierung extern — ohne es wäre die Karte eckig.
  await expect(page.locator('.login-card')).toHaveCSS('border-radius', '22px');
  expect(errors.relevant).toEqual([]);
});

test('Inline-Handler erreichen die Module (globals-Brücke)', async ({ page }) => {
  await isolateDb(page);
  await page.goto('/index.html');
  // Genau der Weg, der nach dem Bundeln bricht, wenn ein Name in app/globals.js fehlt:
  // Attribut im HTML -> window -> Modulfunktion.
  await expect(page.locator('.lang-b', { hasText: 'English' })).toHaveAttribute('onclick', "setLang('en')");
  const fehlend = await page.evaluate(() => {
    const namen = new Set();
    document.querySelectorAll('*').forEach((el) => {
      [...el.attributes].forEach((a) => {
        if (!a.name.startsWith('on')) return;
        // Kein vorangestellter Punkt: document.getElementById(…) ist ein Methodenaufruf
        // und muss nicht auf window liegen.
        (a.value.match(/(?<![.\w$])([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/g) || [])
          .forEach((m) => namen.add(m.replace(/\s*\($/, '')));
      });
    });
    const eingebaut = new Set(['alert', 'confirm', 'prompt', 'setTimeout', 'if', 'return', 'for', 'while', 'switch']);
    return [...namen].filter((n) => !eingebaut.has(n) && typeof window[n] !== 'function');
  });
  expect(fehlend, 'Handler ohne Eintrag in src/app/globals.js').toEqual([]);
});

test('Sprachumschaltung lädt die englische Oberfläche', async ({ page }) => {
  await isolateDb(page);
  await page.goto('/index.html');
  await page.locator('.lang-b', { hasText: 'English' }).click();
  await page.waitForLoadState('load');
  await expect(page.locator('#login-btn')).toHaveText('Log in');
  // Attribute laufen über eine eigene Schleife der Anzeigeschicht — extra prüfen.
  await expect(page.locator('#lu')).toHaveAttribute('placeholder', 'Your player name');
  await page.evaluate(() => localStorage.removeItem('wsLang'));
});

test('alle Seiten rendern mit Inhalt', async ({ page }) => {
  const errors = collectErrors(page);
  const writes = await isolateDb(page);
  await page.goto('/index.html');
  await fakeLogin(page);

  for (const seite of ['home', 'ws', 'cs', 'vs', 'zugfahrt', 'allianz', 'profil', 'admin', 'rankings']) {
    await page.evaluate((p) => window.nav(p), seite);
    const laenge = await page.locator('#pc').evaluate((el) => el.innerHTML.length);
    expect(laenge, `Seite ${seite} rendert leer`).toBeGreaterThan(100);
  }
  expect(errors.relevant).toEqual([]);
  // Beim Öffnen der Wüstensturm-Seite legt ensureWeeklyEvents die Events der Woche an —
  // das ist gewollt. Die Liste wird trotzdem festgenagelt: taucht ein weiterer
  // Schreibweg auf, der beim bloßen Ansehen einer Seite feuert, fällt es hier auf.
  expect([...new Set(writes)].sort()).toEqual(['POST /rest/v1/ws_events']);
});
