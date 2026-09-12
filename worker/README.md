# Marktdaten-Worker

Ein kleines Zwischenstück, damit die App Kurse und Nachrichten laden kann.
Der Browser darf Yahoo Finance und Google News nicht direkt abfragen, ein
Cloudflare Worker schon.

Es wird **kein API-Schlüssel** gebraucht, es wird **nichts gespeichert**, und
der Worker sieht nur, welche Börsensymbole abgefragt werden. Deine
Depotdaten bleiben wie bisher ausschließlich im Browser.

## Einrichten (einmalig, etwa zehn Minuten)

### Weg A: über die Cloudflare-Oberfläche, ohne Installation

1. Auf [dash.cloudflare.com](https://dash.cloudflare.com) einen kostenlosen
   Account anlegen.
2. Links **Workers & Pages** → **Create** → **Start with Hello World!** →
   **Deploy**.
3. Oben auf **Edit code**. Den gesamten Beispielcode löschen, den Inhalt von
   `worker.js` aus diesem Ordner hineinkopieren, **Deploy** drücken.
4. Zurück auf der Worker-Übersicht: **Settings → Variables and Secrets →
   Add**. Name `ALLOWED_ORIGINS`, Wert:
   `https://belapfirrmann.github.io` — speichern.
5. Die Adresse des Workers steht oben, etwa
   `https://bela-finanzen-markt.DEIN-NAME.workers.dev`.
6. In der App unter **Mehr → Marktdaten** diese Adresse eintragen und auf
   *Verbindung prüfen* tippen.

### Weg B: über die Kommandozeile

```bash
cd worker
npx wrangler login
npx wrangler deploy
```

`wrangler.toml` setzt `ALLOWED_ORIGINS` bereits richtig.

## Was der Worker anbietet

| Pfad | Zweck |
|---|---|
| `/quote?symbols=SXR8.DE,CRWV` | Kurs, Vortagesschluss, Tagesspanne, Intraday-Punkte |
| `/search?q=Vanguard%20All-World` | Börsensymbol suchen, auch per ISIN |
| `/news?q=Nasdaq&limit=12` | deutschsprachige Schlagzeilen zum Suchbegriff |

Antworten werden von Cloudflare zwischengespeichert: Kurse 60 Sekunden,
Nachrichten 15 Minuten. Der kostenlose Tarif erlaubt 100.000 Anfragen am Tag,
das reicht um ein Vielfaches.

## Wenn etwas nicht geht

* **„Verbindung fehlgeschlagen"** — meist die Adresse. Sie muss mit `https://`
  anfangen und auf `.workers.dev` enden, ohne Pfad dahinter.
* **Kurse kommen, News nicht** — Google News antwortet gelegentlich langsam.
  Die App zeigt dann den Fehler an und versucht es beim nächsten Aufruf erneut.
* **Alles leer** — prüfe, ob `ALLOWED_ORIGINS` genau die Adresse enthält, unter
  der du die App öffnest.
