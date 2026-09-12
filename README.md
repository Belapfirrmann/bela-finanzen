# Bela Finanzen

Depot-Dashboard fürs Handy. Öffnet sich über einen normalen Browser-Link, lässt sich
zum Startbildschirm hinzufügen und verhält sich dann wie eine App.

Die Seite liest deinen comdirect-Depotexport (CSV) direkt im Browser aus und zeigt die
Auswertungen, die die comdirect selbst nicht liefert.

## Datenschutz

**Die Finanzdaten liegen ausschließlich auf deinem Gerät.** Die CSV wird lokal im
Browser gelesen, das Ergebnis landet im `localStorage`. Es gibt keinen Server, keine
Datenbank, keine Übertragung. Die Seite selbst ist öffentlich, aber leer: Wer den Link
öffnet, sieht das Dashboard ohne deine Zahlen.

Zwei Konsequenzen daraus:

* Auf einem anderen Gerät oder in einem anderen Browser musst du erneut importieren.
* Wenn du den Browser-Speicher löschst, sind die Stichtage weg. Darum unter
  **Import → Daten & Sicherung** ab und zu eine Sicherung herunterladen.

Committe niemals echte Exporte ins Repository - `.gitignore` blockt `*.csv` bereits.

## Die fünf Bereiche

| Tab | Inhalt |
|---|---|
| **Übersicht** | Depotwert, Gewinn, Wertentwicklung, Aufteilung, Streuung |
| **Heute** | Kursbewegung seit Börsenschluss gestern, je Position und in Summe |
| **Aktien** | Kurse und deutschsprachige Schlagzeilen zu deinen Werten |
| **Positionen** | alle Wertpapiere, sortierbar, mit Detailblatt |
| **Mehr** | Import, Darstellung, Marktdaten, Stichtage, Sicherung |

Hell und dunkel lassen sich unter **Mehr → Darstellung** umstellen; „System“ folgt
der Einstellung des Handys. Der Mond oben rechts schaltet schnell durch.

## Was das Dashboard zeigt

* **Depotwert** mit Veränderung seit dem letzten Stichtag, wahlweise um Ein- und
  Auszahlungen bereinigt, damit frisches Geld nicht als Rendite durchgeht.
* **Gewinn und Verlust** gesamt und je Position, absolut und in Prozent.
* **Wertentwicklung über die Zeit.** Jeder Import legt einen Stichtag an. Je öfter du
  importierst, desto feiner die Kurve - genau das, was die comdirect nicht aufbewahrt.
* **Aufteilung** nach Position und nach selbst vergebener Anlageklasse.
* **Stärkste Bewegungen** seit dem letzten Stichtag, auf Kursbasis gerechnet, damit
  Zukäufe nicht als Kursgewinn erscheinen.
* **Streuung**: größte Position, Top 3, effektive Anzahl Positionen (Klumpenrisiko).

Jede Auswertung gibt es zusätzlich als Tabelle, damit die Zahlen auch ohne Farben
lesbar sind.

## Live-Kurse und Nachrichten

Optional. Ohne sie läuft alles andere unverändert weiter.

Eine Webseite darf Börsendaten nicht direkt abfragen, darum liegt im Ordner
`worker/` ein kleines Zwischenstück für Cloudflare Workers. Es braucht **keinen
API-Schlüssel**, speichert nichts und holt Kurse von Yahoo Finance sowie
Schlagzeilen von Google News. Einrichtung und Fehlersuche stehen in
[`worker/README.md`](worker/README.md); die Adresse trägst du danach unter
**Mehr → Marktdaten** ein.

### Wie ein Wertpapier zu seinem Kurs kommt

Dafür braucht es ein Börsensymbol. Drei Wege, vom bequemsten zum genauesten:

1. **Automatisch zuordnen** (Knopf in „Heute“ und „Aktien“). Sucht zu jedem
   Namen die Kandidaten und prüft jeden gegen den Kurs aus deiner CSV.
2. **Wertpapierliste einfügen** (Mehr → Marktdaten). Eine Zeile je Papier mit
   ISIN oder WKN, oder JSON. Genauer als die Namenssuche, weil der
   comdirect-Export keine ISIN mitliefert.
3. **Von Hand**: Position antippen, suchen, auswählen.

In allen drei Fällen gilt dieselbe Schranke: zugeordnet wird nur, was
preislich zum Kurs aus deiner CSV passt (Fremdwährungen werden vorher über
den Wechselkurs umgerechnet). Was nicht passt, bleibt offen und wird benannt,
statt auf Verdacht das falsche Papier einzutragen.

Die Tagesrechnung weist immer aus, wie viele Positionen erfasst sind. Was kein
Symbol hat, fehlt in der Summe und wird auch so benannt.

## Benutzen

1. Bei der comdirect: **Depot → Depotübersicht → Export** als CSV.
2. Im Dashboard auf **Import**, Datei auswählen.
3. Vorschau prüfen. Stimmt eine Spalte nicht, unter *Spaltenzuordnung prüfen oder
   ändern* korrigieren.
4. Stichtag speichern. Optional die Ein- oder Auszahlung seit dem letzten Stichtag
   eintragen.

Der Import erkennt Trennzeichen, Kodierung (auch Windows-1252), deutsche Zahlenformate
und die üblichen comdirect-Spaltennamen selbst. Passt etwas nicht, lässt sich jede
Spalte von Hand zuordnen - es muss also kein Code angefasst werden, wenn die comdirect
ihr Exportformat ändert.

### Warum manche Zahlen geschätzt sind

Die Depotübersicht der comdirect exportiert **keinen aktuellen Kurs**, nur Tages-Hoch
und Tages-Tief je Position. Daraus folgt:

* **Exakt** sind Depotwert, Kaufwert und der Gewinn insgesamt. Die stehen als Summen
  im Fuß der Datei und werden von dort übernommen, nicht selbst addiert.
* **Exakt** ist auch der Einstandswert je Position: Stückzahl mal Kaufkurs ergibt
  auf den Cent genau den ausgewiesenen Kaufwert.
* **Geschätzt** ist der aktuelle Wert je Position. Gerechnet wird mit der Mitte aus
  Tages-Hoch und Tages-Tief; die Summe dieser Schätzungen wird anschließend anteilig
  auf den ausgewiesenen Depotwert gezogen. Die Gesamtsumme stimmt dadurch exakt, die
  Aufteilung auf die einzelnen Positionen liegt im Bereich weniger Zehntelprozent.

Enthält ein Export doch eine Kursspalte, wird sie verwendet und nichts geschätzt.

### Was nicht gespeichert wird

Der Export enthält unten auch Inhabername und Kundennummer. Die Positionstabelle endet
an der ersten Leerzeile, alles danach wird nur nach Summen und Stichtag durchsucht.
Name, Kundennummer und Depotnummer landen nirgends in den gespeicherten Daten.

### Zum Startbildschirm hinzufügen

* **iPhone:** Link in Safari öffnen → Teilen → *Zum Home-Bildschirm*.
* **Android:** Link in Chrome öffnen → Menü → *App installieren*.

## Hosting einrichten

Die Seite ist statisch, ohne Build-Schritt. Der Workflow
`.github/workflows/pages.yml` veröffentlicht bei jedem Push auf den Standard-Branch -
unabhängig davon, wie der gerade heißt.

Einmalig von Hand nötig, weil der Workflow-Token das nicht selbst darf:
**Settings → Pages → Build and deployment → Source: GitHub Actions.** Danach den
Workflow unter *Actions* einmal neu starten oder etwas pushen.

## Lokal starten

```bash
npx http-server . -p 8099
# http://127.0.0.1:8099
```

Ein einfaches Öffnen der `index.html` per Doppelklick reicht nicht: Die App nutzt
ES-Module, die brauchen einen Webserver.

## Aufbau

```
index.html            Aufbau der Oberfläche
css/app.css           Farbrollen, helles und dunkles Design
js/main.js            Ansichten, Import-Ablauf, Ereignisse
js/market.js          Kurse, Nachrichten, Symbolzuordnung
js/views-market.js    die Ansichten „Heute" und „Aktien"
js/parse.js           CSV-Erkennung und comdirect-Spaltenlogik
js/store.js           localStorage, Stichtage, Sicherung
js/stats.js           Auswertungen
js/charts.js          SVG-Diagramme ohne Fremdbibliothek
sw.js                 Offline-Cache der App-Hülle
worker/worker.js      Marktdaten-Zwischenstück für Cloudflare
```
