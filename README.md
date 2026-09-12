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

### Zum Startbildschirm hinzufügen

* **iPhone:** Link in Safari öffnen → Teilen → *Zum Home-Bildschirm*.
* **Android:** Link in Chrome öffnen → Menü → *App installieren*.

## Hosting einrichten

Die Seite ist statisch, ohne Build-Schritt. Der Workflow
`.github/workflows/pages.yml` veröffentlicht bei jedem Push auf `main`.

Einmalig in den Repository-Einstellungen: **Settings → Pages → Source: GitHub Actions**.

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
js/parse.js           CSV-Erkennung und comdirect-Spaltenlogik
js/store.js           localStorage, Stichtage, Sicherung
js/stats.js           Auswertungen
js/charts.js          SVG-Diagramme ohne Fremdbibliothek
sw.js                 Offline-Cache der App-Hülle
```
