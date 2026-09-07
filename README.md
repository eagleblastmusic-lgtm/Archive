# Archivebate Video Browser 🎥

Nowoczesna aplikacja desktopowo-webowa GUI do przeglądania i wyszukiwania materiałów z serwisu **Archivebate.com** w kafelkowym układzie (Grid View) z automatycznym logowaniem kontem użytkownika, wyszukiwarką tagów oraz wbudowanym odtwarzaczem.

## ✨ Funkcje
- **Automatyczne logowanie:** dane konta są czytane bezpiecznie z `.env.local`, zmiennych środowiskowych albo `data/credentials.local.json` — nie są zapisane w kodzie.
- **Kafelkowy interfejs (Dark Mode):** responsywna siatka z animowanymi podglądami wideo, czasem trwania, liczbą wyświetleń i platformą.
- **Wyszukiwarka po tagach i profilach:** wyszukiwanie fraz takich jak `#trans`, `#teen`, `#couple`, `#female`, `#lovense`, nazw modelek itp.
- **Pasek szybkich tagów:** klikalne pigułki/tagi ułatwiające filtrowanie.
- **Wbudowany odtwarzacz wideo:** modal z odtwarzaczem Mixdrop iframe, opcją pobierania i bezpośrednim linkiem.
- **Przeglądanie profili:** szybkie przejście do wszystkich archiwalnych nagrań wybranej modelki.

## 🚀 Jak uruchomić?

Wystarczy dwukrotnie kliknąć plik:
```bash
start.bat
```
lub uruchomić w konsoli:
```bash
python run.py
```
Aplikacja automatycznie otworzy się w domyślnej przeglądarce pod adresem: `http://127.0.0.1:8000`.


## 🔐 Konfiguracja konta

Skopiuj `.env.example` jako `.env.local` i wpisz:

```env
ARCHIVEBATE_EMAIL=twoj_email@example.com
ARCHIVEBATE_PASSWORD=twoje_haslo
```

`.env.local` jest ignorowany przez Git. Bez danych logowania aplikacja uruchomi się w trybie anonimowym, a funkcje konta mogą być niedostępne.

## ⚡ Cache i szybkość

- feed strony głównej jest trwale cache'owany na dysku i działa w trybie stale-while-revalidate;
- miniatury używają RAM + SSD LRU oraz prefetchu;
- detale filmów mają persistent cache;
- storyboard timeline jest zapisywany w IndexedDB po pierwszym przygotowaniu;
- odległe kafelki są renderowane i pobierane leniwie.

## Timeline w stylu YouTube

Podgląd osi czasu dla Archivebate jest teraz generowany jako jeden cache'owany sprite JPG z wieloma klatkami. Przy pierwszym otwarciu filmu storyboard może być przez chwilę przygotowywany; każde kolejne otwarcie korzysta z cache SSD i zmiana klatek podczas ruchu kursora jest natychmiastowa. Generator korzysta z `imageio-ffmpeg`, więc nie wymaga osobnej ręcznej instalacji FFmpeg.

Jeżeli logowanie było wcześniej skonfigurowane przez `USTAW_KONTO.bat`, nowa wersja poprawnie obsługuje także pliki `.env.local` zapisane z BOM. Przycisk ponownego logowania wczytuje plik ponownie bez konieczności restartu aplikacji.
