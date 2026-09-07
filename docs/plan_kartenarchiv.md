# Plan: Kartenarchiv — die Weltkarte einmal abfotografieren

**Stand:** 07.09.2026 · Vorarbeit Session `5723e3d1` (Pixel→Welt-Modell),
Messungen dieser Session in `/tmp/karte_mess`

## Die Idee

Bisher hängt jede Auswertung am laufenden Spiel: Screenshot machen, sofort auswerten,
und wenn die Erkennung nicht taugt, von vorn — mit BlueStacks, ADB und Wartezeit. Das
Archiv dreht das um: **einmal die Karte abfotografieren, danach beliebig oft offline
auswerten.**

Der Gewinn ist nicht die Ersparnis an Screenshots, sondern dass die eigentliche offene
Frage dadurch bearbeitbar wird. Der Engpass ist nicht die Koordinatenrechnung (die
stimmt), sondern das **Lesen fremder Spielernamen**. Mit einem Archiv lässt sich eine
neue OCR-Idee in Minuten über Tausende Bilder laufen lassen, statt sie an einem
Bildschirmfoto zu erraten.

**Zweiter Gewinn:** das Antippen entfällt vollständig — und damit der „Wähle ein
Ziel"-Dialog bei dicht stehenden Basen und der Stern-Versatz, der am Bildschirmrand
nicht mehr gilt. Angetippt wird nur noch für Stichproben-Wahrheiten.

---

## Was diese Session gemessen hat

### Der Zoom ist stufenlos — die „drei Stufen" waren ein Messartefakt

Die Vorarbeit sah drei Rasten und schloss daraus: *Namen gibt es nur im maximalen
Zoom*. Das stimmt nicht. Die damals benutzte Pinch-Geste springt sehr weit; mit
kleineren Schritten (`pinch(700, 665)`) zeigt sich ein Kontinuum. Gemessen wurde die
Reihe über den Skalenvergleich zweier Aufnahmen derselben Kameraposition — Zoomen
verschiebt die Kartenmitte nicht, zwei Stufen unterscheiden sich also durch eine reine
Skalierung. Geeicht ist die Kette an der Stufe mit bekannter Wahrheit (`g02`, dort
bestätigt der Rasterabstand von 419 px = 3 × 139,7 die an Stern-Dialogen gemessenen
139,5 px/Einheit):

| Stufe | px/Einheit X | px/Einheit Y | Bildschirm | Namen lesbar |
|---|---|---|---|---|
| g02 (Eichstufe der Vorarbeit) | 200,7 | 139,5 | 12,8 × 18,4 E | ja |
| g04 | 139,3 | 96,8 | 18,4 × 26,4 E | ja |
| **g06 (Arbeitspunkt)** | **98,7** | **68,6** | **25,9 × 37,3 E** | **ja** |
| g07 | 85,7 | 59,6 | 29,9 × 43,0 E | bricht ein |
| g08 | 75,1 | 52,2 | — | nein (Übersichtsmodus) |

Die X-Achse ist an `g06` zusätzlich absolut geprüft: zwei Sprungmessungen ergaben
102,5 und 99,3 px/Einheit gegen 98,7 aus der Kette. Y folgt aus dem festen
Achsenverhältnis der Projektion (200,7 / 139,5 = 1,439), das nicht vom Zoom abhängt.

### Zwei Betriebsarten, und das Spiel koppelt sie

| | Namensbanner | HUD | Lupe (Koordinatensprung) |
|---|---|---|---|
| **Detailmodus** (bis g07) | ja | vollständig | **ja** |
| **Übersichtsmodus** (ab g08) | nein, nur Nadeln | fast weg | **nein** |

Die Schwelle ist **dieselbe** für alle drei. Das ist der wichtigste strukturelle Befund:
Wo es Namen gibt, gibt es auch den Sprung — und wo der Bildschirm frei von HUD ist, gibt
es weder Namen noch Sprung. Geprüft über den Blauanteil an der Knopfstelle (vorhanden
0,13 · Übersichtsmodus 0,00 · Territorien 0,06) über die gesamte Zoomreihe.

### Der Arbeitspunkt: nicht der weiteste Zoom mit Namen, sondern der beste mit Treffern

Dass Banner **gerendert** werden, heißt nicht, dass sie **gelesen** werden. Gemessen an
einem festen Weltrechteck (X 477–487 · Y 545–561, per Augenschein 9 Basen darin):

| Stufe | px/Einheit X | Trefferquote |
|---|---|---|
| g02 | 200,7 | 33 % |
| **g03** | **169,3** | **78 %** |
| **g04** | **139,3** | **67 %** |
| g05 | 116,1 | 22 % |
| g06 | 98,7 | 44 % |
| g07 | 85,7 | 0 % |

**Arbeitspunkt ist damit g03/g04**, nicht g06. Ein Bildschirm deckt bei g04
18,4 × 26,4 Welteinheiten ab, HUD-frei etwa 12,5 × 20,0 — rund **4.450 Kacheln**
für die ganze Karte, etwa 11 h. Bei g06 wären es 2.100 Kacheln, aber ein Drittel
weniger Namen; das lohnt nur, wenn die Leseseite noch deutlich besser wird.

### Der eigentliche Engpass saß im Aufbau, nicht im Zoom

Die bisherige Kette benutzte **Tesseract als Finder**: erst wenn ein Wort gelesen
wurde, gab es eine Bannerstelle — und erst dann lief die gute Einzelbild-Aufbereitung.
Wo die OCR das Banner nicht lesen konnte, wurde es also gar nicht erst gefunden. Das
ist zirkulär und kostete die Hälfte der Treffer.

Ein Namensbanner ist geometrisch eindeutig: waagerechter dunkler Balken fester Höhe,
Seitenverhältnis über 4:1, Größe skaliert mit dem Zoom (470 × 60 px bei g02). Danach
gesucht — ohne ein Zeichen zu lesen — findet `bannerfinder.finde` bei g04 **7 von 9**
statt 3. Die Trefferquote in der Tabelle oben ist bereits die des geometrischen
Finders; mit dem alten OCR-Finder waren es 50 % (g02) bis 12 % (g06).

Nebeneffekt: der Bannermittelpunkt ist jetzt der Mittelpunkt des **Balkens** statt der
Schwerpunkt gelesener Wörter. Damit entfällt der Grund für die bekannte systematische
X-Abweichung von ~0,6 Einheiten.

### Übersichtsmodus: groß, aber teuer zu navigieren

Ein Bildschirm deckt dort **~67 × 86 Welteinheiten** ab (aus dem Nadelraster gemessen,
drei unabhängige Aufnahmen), und weil das HUD fehlt, ist fast die volle Fläche nutzbar
— rund **221 Kacheln** für die ganze Karte.

Aber: **kein Lupe-Knopf, also kein Koordinatensprung.** Eine Kachel kostet deshalb einen
Tanz — sättigend hineinzoomen, springen, wieder herauszoomen. Gemessen über 16 Kacheln:
**37,5 s je Kachel**, also ~2,3 h für die Karte. Das ist die Hälfte dessen, was der
Namensdurchgang selbst kostet.

### Die Belegungsfrage ist offen — und der naheliegende Detektor trägt nicht

16 über die Karte verteilte Stichproben zeigen: die Wildnis ist voll von Rohstoffpunkten,
Zombies und Allianzbauten, echte Spielerbasen sind selten und stehen in Hives.
Automatisch trennen ließ sich das bisher **nicht**:

- **Helligkeit taugt nicht** — die weißen Tropfen sind zum größten Teil Rohstoffpunkte,
  keine Basen. Der erste Versuch meldete 16 von 16 Kacheln als besiedelt.
- **Die Rasterperiode taugt auch nicht** — die Rohstoffpunkte stehen ebenfalls auf einem
  Raster. Die Autokorrelation an der Nadelperiode schlägt in der Wildnis genauso an wie
  im Hive.

Der Unterschied, an dem es hängt: **Basisnadeln tragen ein Levelabzeichen** (kleines
Sechseck mit Zahl), Rohstoffpunkte nicht. Das ist der zu bauende Detektor — und ohne ihn
gibt es keine belastbare Zahl für den besiedelten Anteil und damit keine Rechtfertigung
für den Vorlauf.

---

## Was daraus für den Plan folgt

**Der zweistufige Aufbau ist nicht mehr selbstverständlich.** Der Vorlauf im
Übersichtsmodus kostet 2,3 h und spart von 5 h nur, was tatsächlich leer ist — bei einem
Detektor, den es noch nicht gibt. Drei Wege, in dieser Reihenfolge zu prüfen:

1. **Vorlauf billiger machen, statt ihn zu streichen.** Die 37,5 s je Kachel sind fast
   vollständig der Zoom-Tanz. Wird im Übersichtsmodus stattdessen **gewischt** und nur
   am Zeilenanfang neu angesetzt, fällt das auf wenige Sekunden — die Karte wäre in
   ~20 min erfasst. Genau das war früher der Blocker (Schwenkweite nie kalibriert), aber
   heute ist er beherrschbar: jede Kachel überlappt ihre Nachbarin, und am Zeilenanfang
   steht ein exakter Sprung als Anker.
2. **Levelabzeichen-Detektor bauen** und an den 16 vorhandenen Stichproben gegen
   Augenschein prüfen. Erst danach gibt es eine ehrliche Zahl für den besiedelten Anteil.
3. **Notfalls ohne Vorlauf.** 2.100 Kacheln à ~9 s im Detailmodus (Sprung + Bild, kein
   Zoom-Tanz) sind ~5 h. Das ist machbar, nur eben nicht in einer Sitzung.

---

## Aufbau des Archivs

```
~/.local/state/warsync/kartenarchiv/<snapshot>/
  manifest.json                 Zoomstufe, Maßstäbe, Bannerversatz, Auflösung,
                                Zuschnitt-Rechteck, Server, Start/Ende, Version
  z6/x0481_y0553.png            Dateiname = angesprungene Kameraposition
  z6/x0481_y0553.json           Sollkoordinate, geprüfte Istkoordinate, Zeitstempel,
                                Bild-Hash, Status
  index.sqlite                  Kachel-Nachschlag über Weltrechteck
```

Drei Festlegungen:

- **Der Dateiname ist die Kameraposition, nicht eine laufende Nummer.** Wer die Gegend um
  X:640 Y:210 auswerten will, rechnet sich die Kacheln aus, statt einen Index zu befragen.
- **Gespeichert wird der Zuschnitt, nicht das Vollbild** — das Zuschnitt-Rechteck steht im
  Manifest, die HUD-Ränder sind unbrauchbar. Spart etwa 60 % Platz.
- **Das Modell (`SKALA_X`, `SKALA_Y`, Versatz, Zoomstufe) liegt im Manifest**, nicht im
  Auswertecode. Wird später nachgeeicht, lassen sich alte Archive weiter richtig lesen.

**Format:** PNG, bis das Gegenteil gemessen ist. Ein Vollbild wiegt ~4,5 MB, 2.100
Kacheln also ~9 GB unbeschnitten, ~4 GB zugeschnitten — bei 1,4 TB frei kein Argument
für JPEG. Die Bannerschrift ist genau das feine Detail, an dem die OCR ohnehin leidet.

## Ablauf je Kachel (Detailmodus)

1. Lupe öffnen, Zustand **am blauen Suchknopf prüfen** — der Dialog bleibt nach „Suchen"
   mal offen und mal nicht.
2. **Entfokus-Tap**, dann X-Feld, tippen, Entfokus-Tap, Y-Feld, tippen. Ohne den
   Entfokus-Tap wird der nächste Tap verbraucht und die Eingabe landet im Nichts.
3. Suchen, kurz auf das Rendern warten.
4. Bildschirmfoto, zuschneiden, ablegen, Kachel-JSON schreiben.

**Nach jeder Kachel gesichert**, nicht am Ende: ein vorhandenes Kachel-JSON heißt
„fertig", ein Neustart überspringt sie.

## Fallen, die diese Session gekostet hat

- **Ein Tap auf eine Basisnadel navigiert.** Im Übersichtsmodus fehlt der Lupe-Knopf; die
  blinde Zustandsprüfung tippte auf die Lupenstelle, traf die Karte und öffnete das
  Popup einer fremden Basis — mitsamt „Like"-Knopf. Der Scanner darf einen Knopf nie
  unterstellen, sondern muss ihn sehen.
- **Die Phasenkorrelation misst hier fast nie, was sie soll.** Enthält das Fenster HUD,
  rastet sie auf Versatz 0 ein (das HUD bewegt sich nicht) und die Messung sieht aus, als
  hätte der Sprung nicht stattgefunden. Ist die Sprungweite zu groß, gibt es gar keine
  Überlappung mehr — bei 100 px/Einheit schiebt ein 13-Einheiten-Sprung das Bild komplett
  aus dem Fenster (Güte 0,01). Und im Hive rastet sie auf der Gitterperiode ein.
  Brauchbar war stattdessen der **Skalenvergleich** zweier Aufnahmen derselben Position.
- **Die Autokorrelation braucht eine echte Peaksuche.** Das Maximum jenseits einer
  Mindestentfernung liegt immer auf der Flanke der Zentrallobe — gesucht ist ein lokales
  Maximum mit Prominenz.
- **Rohes OCR ist kein Banner-Detektor.** Die Bannerschrift braucht Zuschnitt,
  Vergrößerung, Invertierung und harte Schwelle; ein OCR-Nullwert heißt nicht, dass kein
  Banner da ist. Wo es um „ist die Stufe brauchbar", entscheidet der Augenschein.

## Vier Selbstprüfungen, die nichts extra kosten

- **Hat der Sprung stattgefunden?** Zwei aufeinanderfolgende Kacheln mit identischem
  Bild-Hash heißen: die Kamera steht. Sofort anhalten.
- **Überlappungs-Abgleich.** Eine Basis in zwei Nachbarkacheln muss aus beiden dieselbe
  Weltkoordinate ergeben (±0,5). Läuft offline, deckt einen falschen Maßstab sofort auf.
- **Vorlauf gegen Nahaufnahme.** Sagt die Belegungskarte 14 Basen in einem Rechteck und
  die OCR findet 11, fehlt etwas — Kachel auf die Nachlese-Liste, statt still unterzugehen.
- **Raster-Einrastung.** Die Basen stehen auf einem 3-Einheiten-Raster mit fester Phase
  (im eigenen Hive X ≡ 1, Y ≡ 2 mod 3). Runden darauf beseitigt die bekannte systematische
  X-Abweichung von ~0,6 Einheiten. **Vorher prüfen, ob die Phase global gilt.**

Dazu alle ~200 Kacheln eine echte Gegenprobe: Lupe öffnen und die Kameraposition als Text
gegen den Sollwert lesen.

## Auswertung — bewusst getrennt

Die Auswertung ist ein **eigenes Programm über dem Archiv**, ohne ADB, ohne BlueStacks,
ohne Gerätesperre. Es darf beliebig oft laufen, auch während das Spiel für den WS-Dienst
gebraucht wird. Eingang: Kacheln + Manifest. Ausgang: Spielername, Allianz-Tag, Level,
Weltkoordinate, Quellkachel, Vertrauensmaß.

Fremde Allianzen bekommen **dieselben Namensbanner** wie die eigene (`[0wub]Kegl30`,
`[AR1S]Jensorius` — in dieser Session gesehen). Der Zensus scheitert also nicht am
Rendering, nur an der OCR. Und genau die lässt sich am Archiv beliebig oft verbessern.

## Stand nach dem Pilotlauf (07.09.2026)

`scripts/karten_archiv/` ist gebaut und einmal durchgelaufen: 9 Kacheln um den
eigenen Hive, **14,1 s je Kachel**, 18 Bannerfunde, davon 13 lesbar, **10 Spieler des
Kaders mit Koordinate** — aus gespeicherten Bildern heraus, ohne eine Basis anzutippen.

### Tempo: 5,5 s je Kachel, ganze Karte in ~8 h

Die 14,1 s des ersten Piloten enthielten die OCR. Reines Fotografieren dauert nach
zwei Eingriffen **5,5 s**, gemessen über neun Kacheln:

| Posten | vorher | nachher | warum |
|---|---|---|---|
| Bildschirmfoto | 1.780 ms | **523 ms** | `screencap` **ohne** `-p`. Der Flaschenhals ist das PNG-Kodieren *auf dem Gerät*, nicht die Übertragung — roh sind es 26 MB statt 4,5 MB und trotzdem dreimal schneller. |
| Fotos je Kachel | 4 | **2** | Das Bild nach „Suchen" ist zugleich Zustandsprüfung und Nutzbild. Ein Foto nur zum Nachsehen ist der teuerste Posten überhaupt. |
| feste Wartezeiten | 5,0 s | 2,7 s | Ein Tap dauert 27 ms, ein `input text` 60 ms — die Pausen warten auf die Oberfläche. Nur `pause_suchen` wird wirklich gebraucht (die Kamera muss gerendert haben). |

Hochgerechnet: **91 × 59 = 5.369 Kacheln ≈ 8,2 h, 12,9 GB** (Kachel 1660 × 1690 px,
im Mittel 2,46 MB). Der Zoom entscheidet das mit:

| Stufe | Trefferquote | Schritt | Kacheln | Dauer |
|---|---|---|---|---|
| g03 | 78 % | 9 × 14 | 8.064 | 12,3 h |
| **g04** | **67 %** | **11 × 17** | **5.369** | **8,2 h** |
| g06 | 44 % | 16 × 24 | 2.646 | 4,0 h |

Der Lupe-Dialog lässt sich **nicht** offen stehen lassen, um ein weiteres Foto zu
sparen: er blendet unter den X/Y-Feldern eine ganze Sammel-Karte ein, die den
mittleren Teil des Kartenausschnitts verdeckt.

Ein Lauf ist an jeder Stelle abbrechbar und setzt fort — 8 h müssen keine
8 Stunden am Stück sein.

**Was der Pilot aufgedeckt hat:** die Koordinaten liegen um **±1 Welteinheit** neben
dem 3er-Raster (`Ben_the_men` 552 statt 554, `ShadowHawk39` 477 statt 479). `skala_y`
und `banner_versatz` für Stufe 4 sind bisher nur aus der Skalenkette abgeleitet, nicht
gemessen. Das ist die nächste Eichung — entweder gegen Stern-Wahrheiten auf dieser
Stufe oder, ohne jedes Antippen, durch Einpassen auf das 3er-Raster über alle
Fundstellen einer Kachel.

## Der Lupe-Sprung setzt den Zoom zurück (07.09.2026)

**Die Zoomstufe ist nicht frei wählbar, solange über den Dialog navigiert wird.**
Gemessen: nach 2, 4 und 6 Herauszoom-Gesten ergibt sich hinter dem Sprung derselbe
Maßstab, und ein direkter Vergleich der Bilder vor und nach dem Sprung zeigt den
Rückfall. Der ganze Abschnitt oben über den „Arbeitspunkt g04" beschreibt damit eine
Stufe, die beim Sprung-Betrieb gar nicht erreicht wird.

Die erzwungene Standardstufe, absolut gemessen: **199,1 px je Welteinheit in X,
134,8 in Y**, Bannerversatz **+2 / +140 px**. Das deckt sich mit der Eichung der
Vorarbeit (200,7 / 139,5) — die dort ebenfalls über Sprünge gearbeitet hat, also
zwangsläufig dieselbe Stufe traf.

**Wie das gemessen wurde, ohne zu fitten:** Sprung auf 481/557, wo `Little Kong`
steht, deren Koordinate per Stern-Dialog bestätigt ist. Damit steht diese Basis in
der Kameramitte, und die Pixellage ihres Banners gibt beide Versätze *direkt* her.
Der Maßstab kommt aus der Verschiebung derselben, namentlich erkannten Basis über
einen Sprung von 4 Einheiten. Weder Rasterabstand (dessen Vielfaches ist bei wenigen
Bannern mehrdeutig — zwei Spalten können 3 oder 6 Einheiten auseinander liegen) noch
Skalenkette (die trägt Fehler über Stufen weiter).

Folge für den Aufwand: HUD-frei sind es dort nur **8,3 × 12,5 Welteinheiten**, also
Schritt 8 × 12 und **10.500 Kacheln ≈ 16 h** — nicht die 8 h, die aus dem
angenommenen g04 folgten.

Wer weiter draußen fotografieren will, muss **nach** jedem Sprung zoomen. Gemessen:

| nach dem Sprung | skala_x | HUD-frei | Kacheln | Dauer |
|---|---|---|---|---|
| nichts | 199,1 | 8,3 × 12,5 E | 10.500 | 16,0 h |
| eine Geste 700→580 | ~127 | 13,1 × 19,7 E | 4.081 | 7,8 h |

Die Geste kostet je Kachel ~1,6 s und halbiert die Zeit — aber die Namenserkennung
verliert dabei: auf den herausgezoomten Stufen wurde die Ankerbasis nicht mehr
gelesen, obwohl die Bannersuche *mehr* Balken fand. Bevor das entschieden wird,
gehört die Trefferquote auf der Standardstufe gegen die auf 700→580 gemessen.

### Wischen schlägt Springen um das Siebenfache

Der Sprung hat einen teuren Nebeneffekt: er setzt den Zoom zurück. Wischen tut das
**nicht** — und ist obendrein schneller. Alles gemessen am 07.09.2026:

| | je Kachel | Zoom | Kachel deckt | Kacheln | Dauer |
|---|---|---|---|---|---|
| Sprung | 5,5 s | zurückgesetzt | 8,3 × 12,5 E | 10.500 | 16 h |
| **Wisch** | **1,4 s** | bleibt stehen | 13,2 × 19,9 E | ~6.300 | **~2,5 h** |

**Schwenkweiten** (bei 125,6 / 85,1 px je Einheit, also eine Zoomgeste heraus):

| Wisch | Weltversatz | Streuung |
|---|---|---|
| waagerecht 800 px / 250 ms | 9 E | ±0,5 |
| waagerecht 1160 px / 250 ms | 14 E | ±1 |
| waagerecht 1500 px / 300 ms | 17 E | ±1 |
| senkrecht 1200 px / 250 ms | −19 E | ±0,5 |

Die Trägheit ist also gutmütig und nicht der Blocker, für den sie in den alten
Notizen gehalten wurde („Confounded by inertia"). Sie ist auch gar nicht mehr
gefährlich, denn:

**Der Lupe-Dialog verrät die Kameraposition, ohne zu springen.** Nur „Suchen" setzt
den Zoom zurück; Öffnen und Schließen lassen ihn stehen (gemessen: Bannerhöhe
41 → 42 px, Standardstufe wäre 65). Die Wisch-Navigation muss ihre Schwenkweite
damit nicht raten — sie kann jederzeit nachfragen. Genau das fehlte allen früheren
Anläufen.

**Die Ablesung ist die gefährlichste Stelle und braucht zwei Sicherungen.** Die
Ziffern stehen weiß auf einem *durchscheinenden* Feld; was darunter liegt, wechselt
mit dem Kartenausschnitt. Mit einer festen Schwelle verschmolzen sie über hellem
Gelände mit dem Hintergrund, und es kam `52` statt `534` bzw. `5` statt `554`
heraus — das hätte die Kamera scheinbar um 482 Einheiten versetzt und **alle
folgenden Kacheln still an der falschen Stelle abgelegt**. Deshalb:

* **Vier Schwellen × drei Segmentierungsmodi, Mehrheitsentscheid.** Danach 6 von 6
  Ablesungen richtig statt 1 von 6.
* **Plausibilitätsschranke.** Wer weiß, wo er ungefähr steht, gibt es mit; eine
  unplausible Ablesung gilt als „nicht gelesen". Die Schranke darf **nicht** aus der
  eigenen Messreihe kommen — beim ersten Versuch vergiftete ein verlesener Wert den
  Median und verwarf danach alles Richtige.

**Aufbau des Sweeps:** jede Zeile beginnt mit einem exakten Sprung (der setzt den
Zoom zurück, also eine Zoomgeste hinterher), dann wird die Zeile entlang gewischt.
Der waagerechte Schritt bleibt bewusst unter der Kachelbreite (9 E Schritt bei
13,2 E Deckung = ein Drittel Überlappung): Überlappung fängt die Streuung auf und
ist zugleich die Selbstprüfung, weil dieselbe Basis in zwei Kacheln dieselbe
Koordinate ergeben muss. Zwischen den Ablesungen lässt sich der tatsächliche
Versatz zusätzlich aus der Überlappung berechnen — das kostet keine Gerätezeit.

### Die Y-Abbildung ist perspektivisch, nicht linear

Gegenprobe an drei per Stern-Dialog gemessenen Basen (Kamera 481/554):

| Basis | gerechnet | gemessen | Abweichung |
|---|---|---|---|
| Little Kong | 481,00 / 557,06 | 481/557 | 0,07 |
| Maggo1979 | 484,10 / 550,71 | 484/551 | 0,38 |
| Snailnuts | 481,03 / 550,67 | 481/551 | 0,36 |

X sitzt. In Y wächst der Fehler mit dem Abstand zur Bildmitte: die Bannerreihen
stehen je 3 Welteinheiten auseinander, ihre Pixelabstände sind aber **386, 408,
453 px** von oben nach unten. Ein einzelner `skala_y` kann das nicht abbilden; am
Rand des Bildes summiert sich das auf rund **eine Welteinheit**.

Zwei Auswege, beide offen:
* **Projektives Modell in Y** statt eines Faktors, gefittet an den Reihenabständen
  eines dichten Hive-Bildes (die Reihen liefern die Stützstellen frei Haus).
* **Auf das 3er-Raster einrasten.** Solange der Fehler unter 1,5 Einheiten bleibt,
  rundet er sich weg. Setzt voraus, dass die Rasterphase global gilt — lokal ist sie
  bestätigt (X ≡ 1, Y ≡ 2 mod 3), global nicht.

## Territorien-Überflug: der Vorlauf bringt wenig

16 Kacheln auf Territorienebene über das ganze Gebiet zeigen: **Allianzgebiet bedeckt
praktisch die ganze Karte**, frei ist nur ein Rand an den Außenkanten. Die Ansicht
taugt also **nicht** dazu, den Vollscan zu verkürzen — die Vermutung „die Karte ist zum
größten Teil leer" ist in dieser Form widerlegt.

Das heißt nicht, dass überall Spieler wohnen: Territorium wird über Allianzbauten
beansprucht und deckt auch leeres Land. Die Stichproben auf Nadelebene zeigten in der
Wildnis fast nur Rohstoffpunkte. Der Filter muss also dort ansetzen — und dafür fehlt
weiterhin der Detektor, der Basisnadeln am **Levelabzeichen** von Rohstoffpunkten
trennt.

## Offen

1. **Levelabzeichen-Detektor**, um Basen von Rohstoffpunkten zu trennen. Ohne ihn keine
   Belegungskarte und keine ehrliche Zahl für den besiedelten Anteil.
2. **Wisch-Navigation im Übersichtsmodus** — macht den Vorlauf von 2,3 h auf ~20 min.
3. **Eichung am Arbeitspunkt g06** gegen Stern-Wahrheiten, so wie die Vorarbeit es bei
   g02 gemacht hat. Y ist bisher nur aus dem Achsenverhältnis abgeleitet.
4. **Gilt die Raster-Phase global?** Zwei Stern-Wahrheiten fernab des eigenen Hive.
5. **Wiederholbarkeit der Zoomgesten** ist angedeutet (Rückkehr auf dieselbe Position
   wich um 3,8 Graustufen ab), aber nicht über viele Kacheln geprüft. Für einen Sweep muss
   der Zoom über Stunden stabil bleiben — sonst driftet der Maßstab mit.

## Was unehrlich wäre zu verschweigen

- **Ein Vollscan ist ein verschmierter Zeitpunkt.** Über 5 h liegen zwischen erster und
  letzter Kachel Umzüge. Jede Kachel trägt ihren Zeitstempel; „die Karte am 07.09." gibt
  es nicht, nur „diese Kachel um 14:23".
- **Es bleibt an eine Sitzung gebunden.** Gerätesperre, sichtbares Terminal, aktive
  Überwachung — 5 h sind mehrere begleitete Blöcke.
- **Es gibt womöglich einen kürzeren Weg zum reinen Namens-Zensus:** die Allianz-Rangliste
  im Spiel, über die sich fremde Allianzen samt Mitgliederliste aufrufen lassen. Das
  ersetzt das Archiv nicht (kein Bild, keine Nachauswertung), könnte aber für die Frage
  „wer wohnt auf diesem Server" deutlich billiger sein. Einmal von Hand nachsehen, bevor
  5 h Scan angesetzt werden.

## Aufbau im Repo

Neu unter `scripts/karten_archiv/` nach dem Muster von `ws_service`/`cs_service` —
`config.json` mit benannten Ankerpunkten bei der echten Auflösung, Gerätesperre aus
`device.py` wiederverwendet, dokumentierte Kalibrierung statt verstreuter Konstanten.
Nicht die alten `grid_*.py`/`scripts/scout/` flicken.

Die Primitive der Vorarbeit haben sich bewährt und sollten mitwandern:
`pinch.py` (Zwei-Finger-Zoom als rohe `sendevent`-Folge — die Finger müssen erst ~0,35 s
ruhig liegen, sonst wertet das Spiel es als Wisch) und `springen2.py` (Sprung mit
Zustandsprüfung am Suchknopf und Entfokus-Tap).

---

# Nachtrag 07.09.2026 (nachmittags): Sweep gebaut, Y-Modell gemessen

Alles hier Gemessene **ersetzt** die Schätzungen weiter oben. Wo Zahlen
auseinandergehen, gilt dieser Abschnitt.

## Die Y-Achse ist projektiv — und die X-Achse hängt am selben Parameter

`src`: `scripts/karten_archiv/ymodell.py`

    d = a * u / (1 + c * u)        u = kamera_y - welt_y,  d = banner_y - 1280 - versatz

Fitten lässt sich das **ohne bekannte Koordinaten**: die Bannerreihen stehen 3
Welteinheiten auseinander, und das Modell erzwingt d = 0 bei u = 0. Damit bleiben
die Stern-Wahrheiten als unabhängige Gegenprobe übrig, statt in den Fit einzugehen.
Der Fit ist gutmütig — bei ±6 px Rauschen auf den Reihenlagen bleibt der Fehler
unter 0,1 Welteinheiten.

Gemessen auf der Stufe `wisch` (6 Reihen, Rest 0,4 px):

| | Rasterfehler max |
|---|---|
| ein Faktor (`skala_y`) | **0,486 E** |
| projektiv | **0,009 E** |

**Auch X gehört dazu.** Bei einer gekippten Ebene schrumpft alles mit der
Entfernung: X einfach, Y doppelt. Das erklärt die Restfehler der Vormittags-
Gegenprobe vollständig — Maggo1979 (Δx 3, u 3) hatte 0,10 E X-Fehler, das Modell
sagt 0,09; Snailnuts (Δx 0) hatte 0,03, das Modell sagt 0. Ohne `y_modell` in der
Konfiguration bleibt alles beim alten linearen Verhalten, alte Archive lesen sich
also unverändert.

**Auf der Sprung-Stufe steht bewusst kein Modell.** Eine Kachel ist dort nur
12,5 Einheiten hoch; der Fehler des einen Faktors bleibt unter 0,7 E und damit
weit unter dem halben Rasterabstand von 1,5. Für einen belastbaren Fit fehlen die
Stützstellen — vier Reihen für drei Parameter sind eine Interpolation, keine
Messung. Ein Versuch, sie über zusätzliche Ankersprünge einzusammeln, wurde
verworfen: die Zuordnung Zeile→Welt-Y greift daneben, sobald eine Aufnahme nur
drei Reihen hergibt, und der gepoolte Fit war *schlechter* (Rasterfehler 1,14 E)
als der aus einer sauberen Aufnahme.

## Zoomstufen stehen jetzt getrennt in der Konfiguration

Massstab, Versatz, Bannergrösse, Kachelschritt und Trägheitsfaktor hängen an der
Zoomstufe (`config.json` → `stufen`, `zoom.stufe()`):

| | skala_x | skala_y | Banner | Kachel | Trägheit |
|---|---|---|---|---|---|
| `sprung` | 199,1 | 134,8 (linear) | 500 x 64 | 8,3 x 12,5 E | 1,47 |
| `wisch` | 110,1 | 82,82 + Modell | 293 x 38 | 15,1 x 20,4 E | 1,24 |

**Der Zoomfaktor taugt nicht, um Maßstäbe hochzurechnen.** Zwischen den Stufen
liegt in Y exakt der gemessene Faktor 0,586 (134,8 → 82,8 wäre 0,614; gefittete
Mittenwerte 141,5 → 82,8 sind 0,585). In X aber nicht: 199,1 → 110,1 ist 0,553.
Die Karte wird beim Herauszoomen also nicht nur kleiner, sie wird auch flacher —
das Spiel ändert die Neigung mit dem Zoom (`c` −0,0059 → −0,0050). Jede Stufe
gehört deshalb einzeln gemessen. Beleg für die Methode: dieselbe Spaltenmessung
liefert auf der Sprung-Stufe 198,0 gegen die per Sprung gemessenen 199,1.

## Der Sweep: 2,46 s je Kachel, 0,59 Einheiten Drift über 15 Wische

`scripts/karten_archiv/sweep.py` — Sprung nur an den **Zeilenanfang**, dann
wischen. Gemessen über 21 Kacheln:

| | Wert |
|---|---|
| je Kachel | **2,46 s** (bei Kontrolle alle 15 Kacheln) |
| Drift über 15 Wische ohne Kontrolle | **0,59 Welteinheiten** |
| Kachel | 2,6 MB PNG |

Die Position kommt aus zwei Quellen, und keine davon ist eine Annahme:

1. **Vorlagenabgleich in der Überlappung** (`wisch.versatz`) — kostet keine
   Gerätezeit, misst den tatsächlichen Versatz auf wenige Pixel.
2. **Lupe-Dialog als Stichprobe** — alle 15 Kacheln; weicht die Rechnung um mehr
   als 0,75 E ab, wird der abgelesene Wert übernommen (er ist auf ganze Einheiten
   gerundet, beendet dafür jede Drift), über 2,5 E bricht die Zeile ab.

### Drei Fallen, die das gekostet hat

- **Ein Treffer am Rand des Suchfensters ist keiner.** Liegt der wahre Versatz
  ausserhalb, rastet die Korrelation am Rand ein und meldet einen zu kleinen Wert
  — mit guter Güte, denn dort passt die Vorlage fast. Genau das hat eine Zeile
  schleichend um 3 Welteinheiten verschoben. Randtreffer gelten jetzt als
  ungemessen, und die Erwartung wird an sie herangezogen statt sie zu übernehmen.
- **Der Trägheitsfaktor ist stufenabhängig**, entgegen der Vormittags-Annahme:
  1,51 auf der Sprung-Stufe, 1,24 eine Zoomgeste weiter draussen. Er war der
  Grund für das zu enge Fenster. Er ist ohnehin nur noch der Startwert — der
  Sweep zieht die Erwartung aus den eigenen Messungen nach.
- **0,4 s Beruhigungspause sind zu wenig.** Die Karte gleitet dann noch; der
  gemessene Trägheitsfaktor fällt auf 1,38 statt 1,47, und die Kachel gehört
  nicht zu der Position, unter der sie abgelegt wird. 0,9 s reichen, 1,5 s
  bringen nichts mehr.

### Und zwei am Gerät

- **„WELT" und „BASIS" sitzen an derselben Stelle.** Zoomt man über die innerste
  Kartenstufe hinaus, wechselt das Spiel in die Basis-Ansicht. Der Tap auf den
  Rückweg ist aber nur richtig, wenn die Zustandsannahme stimmt — stimmte sie
  nicht, tippte der Lauf von der Weltkarte auf „BASIS", war danach wirklich in
  der Basis, tippte erneut und landete über „Allianz" im Chat. Zurück geht es
  deshalb über `KEYCODE_BACK`: die einzige Geste, die man ohne sichere
  Zustandskenntnis schicken darf.
- **Eine Eichung darf eine bestehende nicht still ersetzen.** `eichen_reihen.py`
  lief versehentlich auf der Sprung-Stufe, verglich ein Bild mit sich selbst,
  lief in den Rand seines Faktorbereichs (0,95 statt 1,00) und schrieb danach
  211 px je Einheit statt 199. Jetzt weigert es sich auf Stufen ohne
  Herauszoom-Geste und schreibt nicht, wenn der neue Massstab um mehr als 8 %
  abweicht.

## Was die Karte jetzt kostet

| Stufe | Kachel | Schritt | Kacheln | Dauer | Platz | Namen |
|---|---|---|---|---|---|---|
| `sprung` | 8,3 x 12,5 E | 5,4 E | ~14.900 | **10,2 h** | 38 GB | gut |
| `wisch` | 15,1 x 20,4 E | 9,8 E | ~5.000 | **3,4 h** | 13 GB | schlecht |

**Die weite Stufe ist noch nicht brauchbar, und der Grund ist nicht der Zoom.**
Der geometrische Bannerfinder findet dort 6 von rund 20 sichtbaren Bannern. Es
ist keine Schwellenfrage: bei weitem Zoom stehen die Basen dicht, und die dunklen
Bannerbalken verschmelzen mit der dunklen Umgebung zu einem einzigen Klumpen —
bei Schwelle 105 ist die halbe Karte eine Zusammenhangskomponente. Ein Finder,
der die Bannerfarbe statt der Helligkeit nimmt, würde die Stufe von 3,4 h
Aufnahmezeit her sofort attraktiv machen. **Das ist der grösste offene Hebel.**

## Gegenprobe: die ganze Kette an 21 Kacheln

`auswerten.py --name drift --neu` über den Sweep-Lauf: 44 Bannerfunde, 30 lesbar,
**16 Kaderspieler mit Koordinate**, dazu 10 gelesene Banner fremder Allianzen.

- Die drei Stern-Wahrheiten im Bild sitzen exakt: Little Kong 481/557,
  Snailnuts 481/551, Maggo1979 484/551.
- Fremde Basen landen auf dem 3er-Raster: Y-Werte 550,8 · 557,0 · 560,1 — alle
  ≡ 2 mod 3, wie im eigenen Hive.
- Dieselbe fremde Basis (`INRLNIAdam 095`) aus **zwei** Kacheln: 537,6 und 537,4.
  Das ist die Selbstprüfung der Überlappung, und sie geht auf.

## Offen (ersetzt die Liste weiter oben)

1. **Bannerfinder für weite Zoomstufen** — nach Farbe statt Helligkeit. Der
   Unterschied zwischen 10 h und 3,4 h für die ganze Karte.
2. **Namens-OCR für fremde Allianzen.** Von 44 Bannerfunden waren 30 lesbar, aber
   die fremden Namen kommen verstümmelt (`INRLNIAdam 095`, `XAXANHX = 4`). Für
   einen Zensus reicht das nicht — und genau das ist der Grund, warum es das
   Archiv gibt: die Erkennung lässt sich daran beliebig oft nachbessern.
3. **Gilt die Raster-Phase global?** Die zehn fremden Basen legen es nahe
   (Y ≡ 2 mod 3 auch bei X 537 und 564), belegt ist es nicht.
4. **Speicherplatz.** 38 GB für die ganze Karte auf der Sprung-Stufe. JPEG
   an 20 Kacheln gegenprüfen, bevor der Vollscan läuft — die Bannerschrift ist
   genau das Detail, an dem die OCR schon leidet.
