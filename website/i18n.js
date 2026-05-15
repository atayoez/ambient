// i18n + theme controller for the Ambient marketing site.
// Mirrors the en/de/tr pattern from oezcan.me and the auto/dark/light
// theme cycle. State persists in localStorage.

(function () {
  'use strict';

  /* eslint-disable @stylistic/quotes */
  var I18N = {
    en: {
      nav: { features: 'Features', pricing: 'Pricing', about: 'About' },
      theme: { auto: 'Auto', dark: 'Dark', light: 'Light' },
      hero: {
        title: 'Wallpapers',
        titleAccent: 'that move with you.',
        sub: "A native desktop wallpaper studio. Generate infinite patterns, pull from curated photo sources, or write a prompt and ship pixel-perfect wallpapers to your screen.",
        ctaBuy: 'Buy for $15',
        ctaFeatures: "See what's in it →",
        meta: 'macOS · Windows · Linux &nbsp;·&nbsp; <strong>$15 one-time</strong> &nbsp;·&nbsp; no subscription &nbsp;·&nbsp; no telemetry',
      },
      features: {
        eyebrow: "What's in it",
        patterns: {
          title: 'Five pattern generators',
          body: "Mesh gradients, geometric shapes, dot grids, stripes, and iOS-style emoji wallpapers using Microsoft Fluent 3D. Re-rolls in milliseconds at your screen's exact resolution.",
        },
        sources: {
          title: 'Curated photo sources',
          body: 'One-click pulls from NASA APOD, Unsplash, and Pexels. Free, BYO key for the search-driven providers. Cached locally so the preview is instant.',
        },
        ai: {
          title: 'AI generation',
          body: 'Write a prompt, hit ⌘↩, get a wallpaper applied. Free via Pollinations (no key needed) or bring your OpenAI key for DALL-E 3.',
        },
        library: {
          title: 'Your own library',
          body: 'Every wallpaper you apply is saved locally. Re-apply with a click, delete with a second click. Lives in <code>~/.local/share</code>; never leaves your machine.',
        },
        privacy: {
          title: 'Local. Private. Yours.',
          body: 'Built on Tauri + Rust + React. No telemetry, no accounts, no servers. Every wallpaper you make stays on your machine — nothing leaves the device without your say-so.',
        },
        design: {
          title: 'Designed like an Apple inspector',
          body: 'Liquid-glass surfaces, intrinsic-width sliders, sticky preview column. Native Wayland on Linux, vibrancy on macOS, Mica on Windows.',
        },
      },
      pricing: {
        eyebrow: 'Pricing',
        sub: 'One price. Yours forever. All updates included.',
        period: 'once',
        tagline: 'Lifetime license. Every future update. Every platform.',
        feat1: 'All five pattern generators, all sources, AI generation',
        feat2: 'Works on macOS, Windows, and Linux',
        feat3: 'Signed binaries with automatic updates',
        feat4: 'Use on every Mac/PC you own — no per-device cap',
        feat5: 'No subscription, no telemetry, no account required',
        buy: 'Buy for $15',
        fineprint:
          'Pay once. Get a signed, auto-updating build for every platform. Lifetime updates, no recurring fees.',
      },
      about: {
        eyebrow: 'The maker',
        role: 'Computer science student · building things on the internet',
        body: "Ambient is something I made for myself first. If it works for you (or doesn't), I'd love to hear — drop me a line or check what else I'm working on.",
      },
    },

    de: {
      nav: { features: 'Funktionen', pricing: 'Preis', about: 'Über' },
      theme: { auto: 'Auto', dark: 'Dunkel', light: 'Hell' },
      hero: {
        title: 'Hintergrundbilder,',
        titleAccent: 'die mit dir mitziehen.',
        sub: 'Ein natives Desktop-Studio für Hintergrundbilder. Erzeuge unendlich viele Muster, hole dir Bilder aus kuratierten Quellen, oder schreibe einen Prompt und liefere pixelgenaue Hintergrundbilder direkt auf deinen Bildschirm.',
        ctaBuy: 'Für 15 $ kaufen',
        ctaFeatures: 'Was drin steckt →',
        meta: 'macOS · Windows · Linux &nbsp;·&nbsp; <strong>15 $ einmalig</strong> &nbsp;·&nbsp; kein Abo &nbsp;·&nbsp; keine Telemetrie',
      },
      features: {
        eyebrow: 'Was drin steckt',
        patterns: {
          title: 'Fünf Muster-Generatoren',
          body: 'Mesh-Gradienten, geometrische Formen, Punkte, Streifen und iOS-artige Emoji-Wallpaper mit Microsoft Fluent 3D. Sekundenschnelle Re-Rolls in der nativen Auflösung deines Bildschirms.',
        },
        sources: {
          title: 'Kuratierte Bildquellen',
          body: 'Ein-Klick-Abruf von NASA APOD, Unsplash und Pexels. Kostenlos, eigene API-Keys für die suchbasierten Anbieter. Lokal gecached für sofortige Vorschau.',
        },
        ai: {
          title: 'KI-Generierung',
          body: 'Prompt eintippen, ⌘↩ drücken, fertiges Hintergrundbild. Kostenlos via Pollinations (ohne Key) oder mit deinem OpenAI-Key für DALL-E 3.',
        },
        library: {
          title: 'Deine eigene Bibliothek',
          body: 'Jedes angewendete Hintergrundbild wird lokal gespeichert. Mit einem Klick erneut anwenden, mit einem zweiten löschen. Liegt unter <code>~/.local/share</code>; verlässt dein Gerät nie.',
        },
        privacy: {
          title: 'Lokal. Privat. Deins.',
          body: 'Auf Tauri + Rust + React aufgebaut. Keine Telemetrie, keine Accounts, keine Server. Jedes Hintergrundbild bleibt auf deinem Rechner — nichts verlässt das Gerät ohne dein OK.',
        },
        design: {
          title: 'Wie ein Apple-Inspector entworfen',
          body: 'Liquid-Glass-Oberflächen, kompakte Slider, sticky Vorschau-Spalte. Natives Wayland auf Linux, Vibrancy auf macOS, Mica auf Windows.',
        },
      },
      pricing: {
        eyebrow: 'Preis',
        sub: 'Ein Preis. Für immer deins. Alle Updates inklusive.',
        period: 'einmalig',
        tagline: 'Lebenslange Lizenz. Jedes zukünftige Update. Jede Plattform.',
        feat1: 'Alle fünf Muster-Generatoren, alle Quellen, KI-Generierung',
        feat2: 'Funktioniert auf macOS, Windows und Linux',
        feat3: 'Signierte Builds mit automatischen Updates',
        feat4: 'Nutzbar auf allen deinen Macs/PCs — kein Gerätelimit',
        feat5: 'Kein Abo, keine Telemetrie, kein Account nötig',
        buy: 'Für 15 $ kaufen',
        fineprint:
          'Einmal zahlen. Signierter, automatisch aktualisierender Build für jede Plattform. Lebenslange Updates, keine wiederkehrenden Gebühren.',
      },
      about: {
        eyebrow: 'Der Macher',
        role: 'Informatikstudent · baut Dinge im Internet',
        body: 'Ambient habe ich erst mal für mich selbst gebaut. Ob es bei dir funktioniert (oder nicht) — ich würde es gerne hören. Schreib mir oder schau dir an, woran ich sonst noch arbeite.',
      },
    },

    tr: {
      nav: { features: 'Özellikler', pricing: 'Fiyat', about: 'Hakkımda' },
      theme: { auto: 'Otomatik', dark: 'Koyu', light: 'Açık' },
      hero: {
        title: 'Seninle hareket eden',
        titleAccent: 'duvar kağıtları.',
        sub: 'Yerel bir masaüstü duvar kağıdı stüdyosu. Sonsuz desenler oluştur, seçili fotoğraf kaynaklarından çek veya bir komut yazıp piksel mükemmel duvar kağıtlarını doğrudan ekranına gönder.',
        ctaBuy: '15 $\'a satın al',
        ctaFeatures: 'İçinde neler var →',
        meta: 'macOS · Windows · Linux &nbsp;·&nbsp; <strong>15 $ tek seferlik</strong> &nbsp;·&nbsp; abonelik yok &nbsp;·&nbsp; telemetri yok',
      },
      features: {
        eyebrow: 'İçinde neler var',
        patterns: {
          title: 'Beş desen üreticisi',
          body: 'Mesh gradientleri, geometrik şekiller, nokta ızgaraları, çizgiler ve Microsoft Fluent 3D ile iOS tarzı emoji duvar kağıtları. Ekranının tam çözünürlüğünde milisaniyeler içinde yeniden üretir.',
        },
        sources: {
          title: 'Seçili fotoğraf kaynakları',
          body: 'NASA APOD, Unsplash ve Pexels\'tan tek tıkla. Ücretsiz, arama tabanlı sağlayıcılar için kendi anahtarını kullanırsın. Anında önizleme için yerel önbellekte tutulur.',
        },
        ai: {
          title: 'Yapay zeka üretimi',
          body: 'Komutu yaz, ⌘↩ tuşla, duvar kağıdı hazır. Pollinations ile ücretsiz (anahtar gerekmez) veya kendi OpenAI anahtarınla DALL-E 3.',
        },
        library: {
          title: 'Kendi kütüphanen',
          body: 'Uyguladığın her duvar kağıdı yerel olarak kaydedilir. Tek tıkla yeniden uygula, iki tıkla sil. <code>~/.local/share</code> altında durur; cihazından asla çıkmaz.',
        },
        privacy: {
          title: 'Yerel. Özel. Senin.',
          body: 'Tauri + Rust + React üzerine kurulu. Telemetri yok, hesap yok, sunucu yok. Yaptığın her duvar kağıdı cihazında kalır — onayın olmadan hiçbir şey dışarı çıkmaz.',
        },
        design: {
          title: 'Apple inspector\'ı gibi tasarlandı',
          body: 'Liquid-glass yüzeyler, kompakt slider\'lar, yapışkan önizleme sütunu. Linux\'ta yerel Wayland, macOS\'ta vibrancy, Windows\'ta Mica.',
        },
      },
      pricing: {
        eyebrow: 'Fiyat',
        sub: 'Tek fiyat. Sonsuza dek senin. Tüm güncellemeler dahil.',
        period: 'tek seferlik',
        tagline: 'Ömür boyu lisans. Tüm gelecek güncellemeler. Her platform.',
        feat1: 'Beş desen üreticisinin tamamı, tüm kaynaklar, yapay zeka üretimi',
        feat2: 'macOS, Windows ve Linux\'ta çalışır',
        feat3: 'Otomatik güncellemeli imzalı sürümler',
        feat4: 'Sahip olduğun her Mac/PC\'de kullan — cihaz sınırı yok',
        feat5: 'Abonelik yok, telemetri yok, hesap gerekmez',
        buy: '15 $\'a satın al',
        fineprint:
          'Bir kez öde. Her platform için imzalı, otomatik güncellenen bir sürüm al. Ömür boyu güncelleme, tekrar eden ücret yok.',
      },
      about: {
        eyebrow: 'Yapımcı',
        role: 'Bilgisayar Mühendisliği öğrencisi · internette projeler geliştiriyor',
        body: 'Ambient\'i önce kendim için yaptım. Sende işe yarıyorsa (ya da yaramıyorsa) duymak isterim — bana bir mesaj at ya da başka neler yaptığıma bak.',
      },
    },
  };
  /* eslint-enable @stylistic/quotes */

  var THEME_ICONS = {
    auto: '<circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>',
    dark: '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>',
    light:
      '<circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>',
  };
  var THEMES = ['auto', 'dark', 'light'];

  var currentLang = localStorage.getItem('ambient.lang') || detectLang();
  var currentTheme = localStorage.getItem('ambient.theme') || 'auto';

  function detectLang() {
    var nav = (navigator.language || 'en').slice(0, 2).toLowerCase();
    if (I18N[nav]) return nav;
    return 'en';
  }

  function lookup(dict, path) {
    return path.split('.').reduce(function (acc, key) {
      return acc != null ? acc[key] : undefined;
    }, dict);
  }

  function applyLanguage(lang) {
    var dict = I18N[lang] || I18N.en;

    document.documentElement.lang = lang;

    document.querySelectorAll('[data-i18n]').forEach(function (el) {
      var v = lookup(dict, el.getAttribute('data-i18n'));
      if (typeof v === 'string') el.textContent = v;
    });

    document.querySelectorAll('[data-i18n-html]').forEach(function (el) {
      var v = lookup(dict, el.getAttribute('data-i18n-html'));
      if (typeof v === 'string') el.innerHTML = v;
    });

    document.querySelectorAll('[data-i18n-placeholder]').forEach(function (el) {
      var v = lookup(dict, el.getAttribute('data-i18n-placeholder'));
      if (typeof v === 'string') el.placeholder = v;
    });

    // theme label depends on both current language AND current theme.
    updateThemeButton();

    localStorage.setItem('ambient.lang', lang);
    currentLang = lang;

    var sel = document.getElementById('lang-switcher');
    if (sel) sel.value = lang;
  }

  function applyTheme(theme) {
    document.documentElement.classList.remove('theme-dark', 'theme-light');
    if (theme === 'dark') document.documentElement.classList.add('theme-dark');
    if (theme === 'light') document.documentElement.classList.add('theme-light');
    localStorage.setItem('ambient.theme', theme);
    currentTheme = theme;
    updateThemeButton();
  }

  function updateThemeButton() {
    var btn = document.getElementById('theme-toggle');
    if (!btn) return;
    var dict = I18N[currentLang] || I18N.en;
    var icon = btn.querySelector('.theme-icon');
    var label = btn.querySelector('.theme-label');
    if (icon) icon.innerHTML = THEME_ICONS[currentTheme];
    if (label) label.textContent = dict.theme[currentTheme];
  }

  function cycleTheme() {
    var idx = THEMES.indexOf(currentTheme);
    var next = THEMES[(idx + 1) % THEMES.length];
    applyTheme(next);
  }

  document.addEventListener('DOMContentLoaded', function () {
    applyLanguage(currentLang);
    applyTheme(currentTheme);

    var langSel = document.getElementById('lang-switcher');
    if (langSel) langSel.addEventListener('change', function () { applyLanguage(langSel.value); });

    var themeBtn = document.getElementById('theme-toggle');
    if (themeBtn) themeBtn.addEventListener('click', cycleTheme);
  });
})();
