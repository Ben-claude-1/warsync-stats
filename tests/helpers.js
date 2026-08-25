import { expect } from '@playwright/test';

// Die App spricht mit der echten Allianz-Datenbank. Tests dürfen dort nichts
// hinterlassen — und Lesen wäre flatterhaft, weil die Antwort vom Tagesstand abhängt.
//
// Blockiert wird deshalb auf **Netzwerkebene**, nicht durch Stubben von Funktionen:
// seit der Modularisierung stehen die Schreibfunktionen nicht mehr auf window, ein
// `window.plannerPush = …` läuft also wirkungslos ins Leere und man merkt es nicht.
// Eine abgefangene Route greift unabhängig davon, wo eine Funktion lebt.
//
// Rückgabe ist die Liste der versuchten Schreibzugriffe — Tests prüfen damit am Ende,
// dass wirklich keiner durchgegangen wäre.
export async function isolateDb(page) {
  const writes = [];
  const antwort = { status: 403, contentType: 'application/json', body: '{"message":"Test"}' };
  await page.route('**/rest/v1/**', async (route) => {
    const method = route.request().method();
    if (method === 'GET') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    }
    writes.push(`${method} ${new URL(route.request().url()).pathname}`);
    // Abweisen statt abbrechen: ein abgebrochener Aufruf erzeugt zusätzlich
    // „net::ERR_FAILED" in der Konsole und verdeckt damit echte Fehler.
    return route.fulfill(antwort);
  });
  // Der Vision-Server ist ein eigener Endpunkt daneben und ebenfalls tabu.
  await page.route('**/analyze*', (route) => route.fulfill(antwort));
  return writes;
}

// Synthetische Spieler. Bewusst keine echten Namen: das Repo ist öffentlich, und
// Kampfkraft der ganzen Allianz gehört nicht in einen Git-Verlauf.
export function fixturePlayers(n = 30) {
  return Array.from({ length: n }, (_, i) => ({
    name: `Testspieler ${String(i + 1).padStart(2, '0')}`,
    role: i === 0 ? 'R5' : i < 5 ? 'R4' : 'R3',
    hero_power: (200 - i * 3) * 1_000_000,
    active: true,
    t1: 10 + i,
    level: 30,
  }));
}

// Synthetische Allianzen. Zwei davon, weil die Trennung nur mit zweien prüfbar ist.
export const ALLIANZ_A = { id: '11111111-1111-4111-8111-111111111111', tag: 'TSTA', name: 'Testallianz A', server: '#1', active: true };
export const ALLIANZ_B = { id: '22222222-2222-4222-8222-222222222222', tag: 'TSTB', name: 'Testallianz B', server: '#2', active: true };

// Meldet sich ohne echte Anmeldung an: Rolle und Spieler werden direkt gesetzt.
// Ein echter Login würde loadData() auslösen und damit u. a. den Kader-Schnitt.
//
// Seit der Trennung in Allianzen gehört eine Allianz zwingend dazu: ohne sie
// verweigert core/api.js jede Abfrage. Genau das ist gewollt — eine Anfrage ohne
// Mandant hätte sonst die Daten aller Allianzen getroffen.
export async function fakeLogin(page, {
  role = 'superadmin',
  players = fixturePlayers(),
  alliances = [ALLIANZ_A, ALLIANZ_B],
  allianceId = ALLIANZ_A.id,
  allianceAdmin = false,
} = {}) {
  await page.evaluate(({ role, players, alliances, allianceId, allianceAdmin }) => {
    window.APP.user = { playerName: 'Testlauf', role, allianceId, allianceAdmin, superAdmin: role === 'superadmin' };
    window.APP.alliances = alliances;
    window.APP.allianceId = allianceId;
    window.APP.data.players = players;
    window.APP.planner = {};
    window.APP.synced = true;
    window.nav('home');
  }, { role, players, alliances, allianceId, allianceAdmin });
  await expect(page.locator('.bnav')).toBeVisible();
}

// Konsolenfehler sammeln.
//
// „Failed to load resource" fliegt raus: das erzeugt der Browser für das fehlende
// Favicon und für jede Anfrage, die isolateDb() mit 403 abweist — beides stammt aus
// dem Testaufbau, nicht aus der App. Was zählt, sind geworfene Ausnahmen
// (pageerror) und alles, was die App selbst als Fehler protokolliert; die
// abgewiesenen Schreibversuche prüft der Test getrennt über die Rückgabe von
// isolateDb().
export function collectErrors(page) {
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  return {
    get relevant() {
      return errors.filter((e) => !e.includes('Failed to load resource'));
    },
  };
}
