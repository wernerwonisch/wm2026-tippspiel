# E/A-Buchhaltung (Österreich)

Einnahmen-Ausgaben-Rechnung als selbst gehostete Web-App. Läuft am eigenen NAS oder auf einem kleinen Server (z. B. Hetzner)
und wird am Windows-Laptop im Browser sowie am Android-Handy/Tablet als installierbare App (PWA) genutzt. Alle Geräte
greifen auf dieselben Daten zu.

**Technik bewusst minimal:** Node.js mit eingebautem SQLite, keine npm-Pakete, keine Datenbank-Server, kein Build-Schritt.
Ein Docker-Container, ein Datenordner.

## Funktionen

| Bereich | Umfang |
|---|---|
| Datenimport | Bank-CSV (George, ELBA, Bank Austria, N26 u. a.), CAMT.053-XML, PayPal, Stripe, SumUp, eigene Excel-(.xlsx)/CSV-Listen. Spalten werden automatisch erkannt, Zuordnung je Dateiformat gespeichert. Duplikate werden übersprungen. Gebühren von Zahlungsanbietern werden eigene Buchungen. |
| Belege | Foto mit Handykamera, PDF/Scan-Upload, automatische Verkleinerung, Offline-Warteschlange. „Auslesen“ erkennt Datum, Betrag, USt-Satz, UID, Rechnungsnummer (OCR für Fotos, Textebene bei PDFs). Vorschlag passender Bankbuchung. Eigenbeleg mit Druckvorlage. |
| Kategorisierung | Vorbelegte Kategorien mit E1a-Kennzahl und Steuercode, Regeln („enthält …“ → Kategorie), Regelvorschlag nach manueller Zuordnung, Massenänderung. |
| Umsatzsteuer | Kleinunternehmer und Regelbesteuerung, **Wechsel unterjährig per Stichtag**. Ist-Besteuerung, 20/13/10 %, Reverse Charge (§ 19, z. B. Google/Meta), innergem. Erwerb/Lieferung, Privatanteile, Pkw ohne Vorsteuer, Bewirtung 50 %. UVA-Kennzahlen je Monat/Quartal inkl. Zahllast (KZ 095). Anzeige der Kleinunternehmergrenze (55.000 € brutto). |
| E/A-Rechnung | Summen je E1a-Kennzahl und Kategorie, Gewinn, Grundfreibetrag (Info). |
| Anlagenverzeichnis | Lineare AfA mit Halbjahresregel, GWG bis 1.000 € sofort, Abgang mit Restbuchwert, Privatanteil. |
| Jahresabschluss | Checkliste (offene Kategorien, fehlende Belege, Anlagen, Kontenabgleich zum 31.12.), Festschreibung von Zeiträumen, Änderungsprotokoll. |
| Export Steuerberater | Excel-Paket (E1a-Übersicht, Kategorien, Journal, UVA, Anlagenverzeichnis, Kontensalden), alle Belege als ZIP (Dateiname = Datum + Beleg-Nr.), Druck/PDF, BMD-CSV-Vorlage. RZL/DATEV als Erweiterung vorgesehen. |
| Sicherung | Download von Datenbank + Belegen als ZIP. |

## Installation

### Variante A: NAS (Synology, QNAP) mit Docker

1. Ordner `buchhaltung` auf das NAS kopieren (z. B. `/volume1/docker/buchhaltung`).
2. Datei `.env` anlegen (Vorlage `.env.example`) und ein langes Passwort setzen.
3. Datenordner anlegen und dem Container-Benutzer (UID 1000) geben: `mkdir data && chown 1000:1000 data`
4. Im Container Manager „Projekt erstellen“ → Ordner wählen → `docker-compose.yml` wird erkannt → starten.
   Per SSH alternativ: `docker compose up -d`
5. Aufruf im Heimnetz: `http://<NAS-IP>:8080`

### Variante B: Hetzner Cloud (CX22, ca. 4–5 €/Monat)

```bash
apt install -y docker.io docker-compose-v2
# Projektordner hochladen, .env anlegen, dann:
mkdir data && chown 1000:1000 data && docker compose up -d
```
HTTPS davor mit Caddy (eine Zeile Konfiguration, Zertifikat automatisch):
```
buchhaltung.meinefirma.at {
  reverse_proxy localhost:8080
}
```

### Variante C: Testen am Windows-Laptop

Node.js 22 LTS (≥ 22.13) installieren, dann im Ordner:
```
set APP_PASSWORD=meinpasswort123
node server.js
```
Aufruf: http://localhost:8080

### HTTPS und Zugriff von unterwegs

Für die App-Installation am Android-Gerät und die Kamera-Funktion verlangt Chrome **HTTPS**. Optionen:

- **Tailscale** (empfohlen für NAS, kostenlos für Privat/kleine Teams): NAS und Handy ins Tailnet, `tailscale serve 8080` liefert
  eine HTTPS-Adresse. Kein Port nach außen offen.
- Synology: Systemsteuerung → Anmeldeportal → Reverse Proxy + Let's-Encrypt-Zertifikat.
- Hetzner: Caddy wie oben.

### Am Gerät installieren

- **Android:** Adresse in Chrome öffnen → Menü → „App installieren“. Danach eigenes Symbol am Startbildschirm,
  Kurzbefehle „Beleg fotografieren“ und „Neue Buchung“ (lange auf das Symbol tippen).
- **Windows:** In Edge/Chrome → Adressleiste „App installieren“ oder einfach als Lesezeichen.

## Erste Schritte

1. **Einstellungen:** Firmendaten, USt-Status (Kleinunternehmer / regelbesteuert, mit Datum des Wechsels), UVA-Zeitraum,
   Zahlungskonten mit Anfangssaldo.
2. **Import:** Kontoauszug-Export der Bank einlesen. Bei George: Konto → Umsätze → Export CSV oder CAMT.
3. **Buchungen:** Kategorien zuordnen (Liste filtert „ohne Kategorie“). Regeln entstehen per Klick.
4. **Belege:** Fotos/PDFs hochladen, auslesen, der passenden Bankbuchung zuordnen. Barzahlungen direkt aus dem Beleg anlegen.
5. **Auswertung:** UVA je Periode → Werte in FinanzOnline übertragen → Periode festschreiben.
6. **Jahresabschluss:** Checkliste abarbeiten, Kontosalden mit Auszug zum 31.12. abgleichen, Excel-Paket + Beleg-ZIP an die Kanzlei.

## Steuerliche Grundlagen und Annahmen

| Wert | Stand | Wo im Code |
|---|---|---|
| Kleinunternehmergrenze 55.000 € brutto (Toleranz 10 %) | ab 2025 | `public/core/tax.js` → `GRENZEN` |
| GWG-Grenze 1.000 € | ab 2023 | `GRENZEN.gwg` |
| Grundfreibetrag 15 % von max. 33.000 € | ab 2024 | `GRENZEN` |
| Halbjahres-AfA bei Nutzung < 6 Monate (§ 7 Abs. 2 EStG) | | `public/core/afa.js` |
| Aufbewahrung Belege 7 Jahre (§ 132 BAO) | | Hinweis in der App |

- **Methode:** Ist-Prinzip (Zufluss/Abfluss = Buchungsdatum am Konto). Mit Vorsteuerabzug Nettomethode
  (USt-Zahlungen an das Finanzamt erfolgsneutral), als Kleinunternehmer Bruttobeträge.
- **USt-Wechsel:** Jede Buchung wird nach dem Status an ihrem Datum bewertet. Ein Wechsel gilt sofort für alle Auswertungen.
- **Reverse Charge als Kleinunternehmer:** Steuer erscheint in KZ 057 (keine Vorsteuer). Die Zahlung an das Finanzamt
  (Kategorie „Umsatzsteuer Zahlung/Gutschrift Finanzamt“) wird dann automatisch Betriebsausgabe.
- **Eigenbelege:** kein Vorsteuerabzug.

### Vor der ersten Abgabe mit dem Steuerberater abstimmen

- **E1a-Kennzahlen** der Kategorien (in den Einstellungen änderbar). Die Zuordnung folgt der Formularstruktur,
  wurde aber nicht gegen die Ausfüllhilfe E 2 des aktuellen Jahres geprüft.
- **UVA-Kennzahlen** (U30): Standardfälle 000, 016, 017, 020, 022, 029, 006, 057, 060, 065, 066, 070, 072, 095.
  Sonderfälle (Bauleistungen § 19 Abs. 1a, Einfuhr-USt, Berichtigungen § 16) sind nicht abgebildet.
- **BMD-Export:** Feldaufbau und Steuercodes sind eine Vorlage. Sachkonten je Kategorie und Zahlungskonto eintragen
  und einen Testimport mit der Kanzlei machen.
- **Nicht automatisiert:** degressive AfA, Pkw-Luxustangente (AfA-Basis max. 40.000 €), investitionsbedingter Gewinnfreibetrag,
  Basispauschalierung, Arbeitsplatzpauschale, Fremdwährungsumrechnung (Fremdwährungszeilen werden markiert).

## Datensicherung

- In der App: Einstellungen → „Sicherung herunterladen“ (Datenbank + Belege als ZIP).
- Automatisch: Ordner `data/` per NAS-Snapshot / Hyper Backup bzw. restic sichern. Wiederherstellen = Ordner zurückkopieren.

## Erweiterung

- **Weitere Exportformate (RZL, DATEV):** in `public/core/exporters.js` einen Eintrag in `EXPORTER` ergänzen
  (`run(daten, jahr)` liefert Dateiname, MIME-Typ, Inhalt). Erscheint automatisch unter Auswertung → Export.
- **Weitere Importformate:** Spaltennamen in `SYN` bzw. Erkennung in `detectQuelle` (`public/core/importers.js`).

## Entwicklung

```
npm test          # Unit-Tests der Steuer-, Import- und Exportlogik (node:test)
APP_PASSWORD=test1234 node server.js
```

Aufbau:
```
server.js              HTTP-Server, Login, REST-API, SQLite, Belegablage, ZIP-Export
public/core/           Fachlogik ohne DOM (auch in Node getestet): Steuer, AfA, Import, Excel, ZIP, Exporte
public/views/          Bildschirme (Übersicht, Buchungen, Belege, Import, Auswertung, Anlagen, Einstellungen)
public/sw.js           Offline-Cache der Oberfläche
test/                  Tests
```

Externe Bibliotheken werden nur beim „Auslesen“ von Belegen aus jsDelivr nachgeladen (tesseract.js 5.1.1, pdf.js 4.10.38).
Ohne Internet funktioniert alles andere weiter.
