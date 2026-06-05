// i18n + currency controller for the Ambient marketing site.
// en / de / tr translations + region-based currency detection.
// Lang choice persists in localStorage; the site is dark-only.

(function () {
  'use strict';

  /* eslint-disable @stylistic/quotes */
  var I18N = {
    en: {
      nav: { features: 'Features', pricing: 'Pricing', download: 'Download', about: 'About' },
      hero: {
        title: 'Wallpapers',
        titleAccent: 'that move with you.',
        sub: "A small desktop app for changing your wallpaper. Built-in patterns, a few photo sources, and an AI generator if you'd rather just describe one.",
        ctaBuy: 'Buy for {PRICE}',
        ctaDownload: 'Download →',
        meta: 'macOS · Windows · Linux &nbsp;·&nbsp; <strong>{PRICE} one-time</strong> &nbsp;·&nbsp; no subscription &nbsp;·&nbsp; no telemetry',
      },
      features: {
        eyebrow: "What's in it",
        patterns: {
          title: 'Ten pattern generators',
          body: 'Mesh gradients, dots, stripes, geometric shapes, flowing lines, waves, aurora, bokeh, petals, and emoji walls — ten in all. Tweak the knobs or hit shuffle until one clicks.',
        },
        sources: {
          title: 'Curated photo sources',
          body: 'A fresh photo daily from NASA and Bing, plus random shots from Lorem Picsum — all free, no key. Add a free Unsplash, Pexels, or Wallhaven key for search-driven picks. Everything you apply is saved locally.',
        },
        ai: {
          title: 'AI generation',
          body: 'Type a prompt, hit ⌘↩. Pollinations works out of the box for free — add a token to lift the rate limit. Or bring your own OpenAI key for DALL·E 3.',
        },
        library: {
          title: 'Your own library',
          body: "Everything you've used hangs around in the library. One click puts it back on the desktop, two clicks delete it. The files just sit on your disk.",
        },
        privacy: {
          title: 'Stays on your machine',
          body: "Tauri + Rust + React under the hood. No account, no telemetry, no backend at all. The only thing the app calls out to is whichever photo source you've turned on.",
        },
        design: {
          title: 'Designed like an Apple inspector',
          body: 'Inspector on the right, preview on the left that stays put while you tweak. Glass surfaces, minimal motion. Native Wayland on Linux.',
        },
      },
      pricing: {
        eyebrow: 'Pricing',
        sub: 'One price, one time. Future versions are free too.',
        period: 'once',
        tagline: 'Yours to keep, with every future update.',
        feat1: 'Every pattern, every source, the AI generator',
        feat2: 'macOS, Windows, and Linux',
        feat3: "Free updates for life, plus a heads-up in the app when a new one ships",
        feat4: 'Run it on as many of your own machines as you want',
        feat5: 'No subscription, no account, no analytics',
        buy: 'Buy for {PRICE}',
        fineprint:
          "Pay once and that's the whole thing. Same license for your Mac, PC, or Linux machine.",
      },
      download: {
        eyebrow: 'Download',
        sub: 'Anyone can download the app. Buying it gets you a license key by email, which you paste in on first launch.',
        cta: 'Download',
        others: 'Other platforms',
        arch: 'Architecture',
        distro: 'Distro / format',
        note: "The macOS and Windows builds aren't signed yet, so they complain about an unknown app the first time. On Mac, right-click the app and pick Open. On Windows, click 'More info' then 'Run anyway'.",
      },
      about: {
        eyebrow: 'The maker',
        role: 'Computer science student · building things on the internet',
        body: "I built Ambient because I wanted it on my own laptop. If you try it, tell me what works and what doesn't. I read everything that comes in.",
      },
      impressum: {
        title: 'Imprint',
        lede: 'Disclosure required under §5 Digitale-Dienste-Gesetz (DDG).',
        h: {
          provider: 'Service provider',
          contact: 'Contact',
          vat: 'VAT',
          responsible: 'Responsible for content (§ 18 Abs. 2 MStV)',
          odr: 'EU online dispute resolution',
          liability: 'Liability for content',
          links: 'Liability for links',
          copyright: 'Copyright',
        },
        contact_email_label: 'Email:',
        vat_body:
          'Operating under the small-business rule (§19 UStG — Kleinunternehmerregelung). VAT is not separately stated and cannot be deducted by customers as input tax.',
        responsible_body: 'Atay Özcan (address as above).',
        odr_body:
          'The European Commission provides a platform for online dispute resolution at <a href="https://ec.europa.eu/consumers/odr" target="_blank" rel="noopener">ec.europa.eu/consumers/odr</a>. We are neither obligated nor willing to participate in dispute-resolution procedures before a consumer arbitration board.',
        liability_body:
          'As a service provider we are responsible for our own content on this site according to general law (§7 (1) DDG). According to §§ 8 to 10 DDG, we are not obligated as a service provider to monitor third-party information transmitted or stored, or to investigate circumstances that suggest unlawful activity. Obligations to remove or block use of information under general law remain unaffected. Liability in this respect is, however, only possible from the point in time at which a concrete infringement of the law becomes known.',
        links_body:
          'This site contains links to external third-party websites whose content we have no influence over. We cannot therefore accept any liability for that external content. The respective provider is responsible. Linked sites were reviewed for possible legal violations at the time of linking. Without concrete indication of an infringement, continuous monitoring is unreasonable; links will be removed promptly upon becoming aware of any violation.',
        copyright_body:
          'All software, design, brand marks, marketing copy, and assets published on this site are © 2026 Atay Özcan. All rights reserved.',
      },
      privacy: {
        title: 'Privacy policy',
        lede:
          'Effective <time datetime="2026-05-16">2026-05-16</time>. Drafted to satisfy the General Data Protection Regulation (GDPR / DSGVO) and the German Bundesdatenschutzgesetz (BDSG).',
        h: {
          controller: 'Controller',
          what_data: 'What data is processed',
          logs: '1. Server logs (Cloudflare)',
          purchase: '2. Purchase data (when you buy)',
          cookies: 'Cookies',
          recipients: 'Recipients / sub-processors',
          intl: 'International transfers',
          rights: 'Your rights under GDPR',
          complaint: 'Right to lodge a complaint',
          changes: 'Changes',
        },
        controller_lede:
          'The controller is the natural or legal person who alone or jointly with others determines the purposes and means of processing of personal data.',
        what_data_intro: 'This site is intentionally minimal. Two sources of data:',
        logs_body:
          'When you visit this site, our hosting provider Cloudflare automatically records: IP address, requested URL, HTTP method, response status, user-agent string, referrer, timestamp. This is kept for at most 30 days for the purpose of detecting and mitigating attacks, abuse, and operational issues.',
        logs_basis:
          '<strong>Legal basis:</strong> Art. 6(1)(f) GDPR — our legitimate interest in the secure operation of this website.',
        purchase_body:
          'The "Buy" button takes you to a checkout hosted by <a href="https://polar.sh" target="_blank" rel="noopener">Polar Software, Inc.</a> ("Polar"), our Merchant of Record. Polar collects your payment information, billing country, and email address directly. We receive only: your email address, an order ID, the product purchased, and confirmation of payment. Polar\'s own privacy policy applies during checkout.',
        purchase_basis:
          '<strong>Legal basis:</strong> Art. 6(1)(b) GDPR — performance of the contract you enter into when you buy.',
        cookies_body1:
          'This site sets no first-party cookies. We do not run analytics (no Google Analytics, no Plausible, no Posthog, no anything).',
        cookies_body2:
          'Cloudflare may set a strictly-necessary technical cookie (<code>__cf_bm</code>, "bot management") for ~30 minutes for security purposes. Under §25 (2) TDDDG this falls under the consent exception for technically necessary cookies; no banner is required.',
        recipients_cf:
          '<strong>Cloudflare, Inc.</strong> — site hosting and CDN. Server-log data may transit and be cached in jurisdictions outside the EEA, including the United States, under the EU-U.S. Data Privacy Framework + Cloudflare\'s GDPR DPA.',
        recipients_polar:
          '<strong>Polar Software, Inc.</strong> — payment processing. Acts as Merchant of Record for purchases. Processes your payment info under their own privacy policy.',
        recipients_note:
          'We do not sell, rent, or otherwise share your data with any other party.',
        intl_body:
          'Where data is transferred outside the EEA (chiefly via Cloudflare and Polar), we rely on either an adequacy decision under Art. 45 GDPR or Standard Contractual Clauses under Art. 46(2)(c) GDPR for the relevant processors.',
        rights: {
          access:
            '<strong>Access</strong> (Art. 15) — confirmation of whether we process data about you and, if so, a copy.',
          rectification:
            '<strong>Rectification</strong> (Art. 16) — correction of inaccurate data.',
          erasure:
            '<strong>Erasure</strong> (Art. 17) — deletion of your data where the legal grounds for processing no longer exist.',
          restriction:
            '<strong>Restriction</strong> (Art. 18) — limit processing to storage during a dispute.',
          portability:
            '<strong>Portability</strong> (Art. 20) — export of your data in a structured, machine-readable format.',
          objection:
            '<strong>Objection</strong> (Art. 21) — to processing based on legitimate interest.',
          withdraw:
            '<strong>Withdraw consent</strong> at any time (where processing is based on consent), without affecting the lawfulness of processing already carried out.',
        },
        rights_exercise:
          'To exercise any of these rights, email <a href="mailto:atay@oezcan.me">atay@oezcan.me</a>. We will respond within one month per Art. 12(3) GDPR.',
        complaint_body:
          'You can lodge a complaint with a data-protection supervisory authority — typically the one in the federal state where you reside or work. In Germany, see the <a href="https://www.bfdi.bund.de" target="_blank" rel="noopener">Bundesbeauftragte für den Datenschutz</a> for the list of state authorities.',
        changes_body:
          'We may update this policy when our practices change. The effective date at the top reflects the most recent revision.',
      },
    },

    de: {
      nav: { features: 'Funktionen', pricing: 'Preis', download: 'Download', about: 'Über' },
      hero: {
        title: 'Hintergrundbilder,',
        titleAccent: 'die mit dir mitziehen.',
        sub: 'Eine kleine Desktop-App zum Wechseln deines Hintergrundbilds. Eingebaute Muster, ein paar Bildquellen und einen KI-Generator, falls du lieber einfach beschreibst was du willst.',
        ctaBuy: 'Für {PRICE} kaufen',
        ctaDownload: 'Herunterladen →',
        meta: 'macOS · Windows · Linux &nbsp;·&nbsp; <strong>{PRICE} einmalig</strong> &nbsp;·&nbsp; kein Abo &nbsp;·&nbsp; keine Telemetrie',
      },
      features: {
        eyebrow: 'Was drin steckt',
        patterns: {
          title: 'Zehn Muster-Generatoren',
          body: 'Mesh-Gradienten, Punkte, Streifen, geometrische Formen, fließende Linien, Wellen, Aurora, Bokeh, Blütenblätter und Emoji-Wallpaper — zehn an der Zahl. An den Reglern drehen oder mischen, bis eins passt.',
        },
        sources: {
          title: 'Kuratierte Bildquellen',
          body: 'Täglich ein frisches Foto von NASA und Bing, dazu zufällige Bilder von Lorem Picsum — alles kostenlos, ohne Key. Für suchbasierte Auswahl einen gratis Unsplash-, Pexels- oder Wallhaven-Key hinterlegen. Was du anwendest, wird lokal gespeichert.',
        },
        ai: {
          title: 'KI-Generierung',
          body: 'Prompt tippen, ⌘↩ drücken. Pollinations läuft kostenlos ohne Setup — mit einem Token hebst du das Limit. Oder du nimmst deinen eigenen OpenAI-Key für DALL·E 3.',
        },
        library: {
          title: 'Deine eigene Bibliothek',
          body: 'Alles was du benutzt hast bleibt in der Bibliothek. Ein Klick setzt es zurück aufs Desktop, zwei Klicks löschen. Die Dateien liegen einfach auf deiner Platte.',
        },
        privacy: {
          title: 'Bleibt auf deinem Rechner',
          body: 'Tauri + Rust + React unter der Haube. Kein Account, keine Telemetrie, gar kein Backend. Das einzige was die App im Netz macht ist die Bildquelle, die du selbst angeschaltet hast.',
        },
        design: {
          title: 'Wie ein Apple-Inspector entworfen',
          body: 'Inspector rechts, links die Vorschau, die stehen bleibt während du anpasst. Glasflächen, wenig Animation. Natives Wayland auf Linux.',
        },
      },
      pricing: {
        eyebrow: 'Preis',
        sub: 'Ein Preis, einmal. Spätere Versionen sind auch kostenlos.',
        period: 'einmalig',
        tagline: 'Gehört dir, mit jedem zukünftigen Update.',
        feat1: 'Jedes Muster, jede Quelle, der KI-Generator',
        feat2: 'macOS, Windows und Linux',
        feat3: 'Lebenslang kostenlose Updates, mit Hinweis in der App wenn eine neue Version draußen ist',
        feat4: 'Nutzbar auf so vielen deiner eigenen Rechner wie du willst',
        feat5: 'Kein Abo, kein Account, keine Analytics',
        buy: 'Für {PRICE} kaufen',
        fineprint:
          'Einmal zahlen und das war\'s. Dieselbe Lizenz für deinen Mac, PC oder Linux-Rechner.',
      },
      download: {
        eyebrow: 'Download',
        sub: 'Die App kann jeder runterladen. Beim Kauf bekommst du per E-Mail einen Lizenzschlüssel, den du beim ersten Start einfügst.',
        cta: 'Herunterladen',
        others: 'Andere Plattformen',
        arch: 'Architektur',
        distro: 'Distro / Format',
        note: 'Die macOS- und Windows-Builds sind noch nicht signiert, deshalb meckern sie beim ersten Öffnen über eine unbekannte App. Am Mac: Rechtsklick auf die App, dann „Öffnen". Auf Windows: „Weitere Informationen" und dann „Trotzdem ausführen".',
      },
      about: {
        eyebrow: 'Der Macher',
        role: 'Informatikstudent · baut Dinge im Internet',
        body: 'Ambient hab ich gebaut, weil ich es auf meinem eigenen Laptop wollte. Wenn du es ausprobierst, schreib mir was funktioniert und was nicht. Ich antworte auf alles.',
      },
      impressum: {
        title: 'Impressum',
        lede: 'Anbieterkennzeichnung gemäß § 5 Digitale-Dienste-Gesetz (DDG).',
        h: {
          provider: 'Diensteanbieter',
          contact: 'Kontakt',
          vat: 'Umsatzsteuer',
          responsible: 'Inhaltlich Verantwortlicher (§ 18 Abs. 2 MStV)',
          odr: 'EU-Online-Streitbeilegung',
          liability: 'Haftung für Inhalte',
          links: 'Haftung für Links',
          copyright: 'Urheberrecht',
        },
        contact_email_label: 'E-Mail:',
        vat_body:
          'Betrieb gemäß Kleinunternehmerregelung (§ 19 UStG). Umsatzsteuer wird nicht gesondert ausgewiesen und kann von Kunden nicht als Vorsteuer geltend gemacht werden.',
        responsible_body: 'Atay Özcan (Anschrift wie oben).',
        odr_body:
          'Die Europäische Kommission stellt eine Plattform zur Online-Streitbeilegung bereit: <a href="https://ec.europa.eu/consumers/odr" target="_blank" rel="noopener">ec.europa.eu/consumers/odr</a>. Wir sind weder verpflichtet noch bereit, an Streitbeilegungsverfahren vor einer Verbraucherschlichtungsstelle teilzunehmen.',
        liability_body:
          'Als Diensteanbieter sind wir gemäß § 7 Abs. 1 DDG für eigene Inhalte auf diesen Seiten nach den allgemeinen Gesetzen verantwortlich. Nach §§ 8 bis 10 DDG sind wir jedoch nicht verpflichtet, übermittelte oder gespeicherte fremde Informationen zu überwachen oder nach Umständen zu forschen, die auf eine rechtswidrige Tätigkeit hinweisen. Verpflichtungen zur Entfernung oder Sperrung der Nutzung von Informationen nach den allgemeinen Gesetzen bleiben hiervon unberührt. Eine diesbezügliche Haftung ist jedoch erst ab dem Zeitpunkt der Kenntnis einer konkreten Rechtsverletzung möglich.',
        links_body:
          'Diese Seite enthält Links zu externen Webseiten Dritter, auf deren Inhalte wir keinen Einfluss haben. Deshalb können wir für diese fremden Inhalte auch keine Gewähr übernehmen. Für die Inhalte der verlinkten Seiten ist stets der jeweilige Anbieter verantwortlich. Die verlinkten Seiten wurden zum Zeitpunkt der Verlinkung auf mögliche Rechtsverstöße überprüft. Eine permanente inhaltliche Kontrolle ist ohne konkrete Anhaltspunkte einer Rechtsverletzung nicht zumutbar; bei Bekanntwerden von Rechtsverletzungen werden derartige Links umgehend entfernt.',
        copyright_body:
          'Alle auf dieser Seite veröffentlichten Software-, Design-, Marken-, Werbetexte und Assets sind © 2026 Atay Özcan. Alle Rechte vorbehalten.',
      },
      privacy: {
        title: 'Datenschutzerklärung',
        lede:
          'Gültig ab <time datetime="2026-05-16">2026-05-16</time>. Erstellt zur Erfüllung der Datenschutz-Grundverordnung (DSGVO) und des deutschen Bundesdatenschutzgesetzes (BDSG).',
        h: {
          controller: 'Verantwortlicher',
          what_data: 'Welche Daten werden verarbeitet',
          logs: '1. Server-Logs (Cloudflare)',
          purchase: '2. Kaufdaten (bei Kauf)',
          cookies: 'Cookies',
          recipients: 'Empfänger / Auftragsverarbeiter',
          intl: 'Internationale Datenübermittlung',
          rights: 'Ihre Rechte nach DSGVO',
          complaint: 'Beschwerderecht',
          changes: 'Änderungen',
        },
        controller_lede:
          'Verantwortlicher ist die natürliche oder juristische Person, die allein oder gemeinsam mit anderen über die Zwecke und Mittel der Verarbeitung personenbezogener Daten entscheidet.',
        what_data_intro: 'Diese Seite ist bewusst minimal gehalten. Zwei Datenquellen:',
        logs_body:
          'Wenn Sie diese Seite besuchen, protokolliert unser Hosting-Anbieter Cloudflare automatisch: IP-Adresse, angefragte URL, HTTP-Methode, Antwortstatus, User-Agent-String, Referrer, Zeitstempel. Diese Daten werden für höchstens 30 Tage gespeichert, um Angriffe, Missbrauch und Betriebsstörungen erkennen und abwehren zu können.',
        logs_basis:
          '<strong>Rechtsgrundlage:</strong> Art. 6 Abs. 1 lit. f DSGVO — unser berechtigtes Interesse am sicheren Betrieb dieser Website.',
        purchase_body:
          'Die „Kaufen"-Schaltfläche führt Sie zu einem Checkout von <a href="https://polar.sh" target="_blank" rel="noopener">Polar Software, Inc.</a> („Polar"), unserem Merchant of Record. Polar erhebt Ihre Zahlungsinformationen, das Rechnungsland und Ihre E-Mail-Adresse direkt. Wir erhalten lediglich: Ihre E-Mail-Adresse, eine Bestell-ID, das gekaufte Produkt und die Zahlungsbestätigung. Während des Checkouts gilt die eigene Datenschutzerklärung von Polar.',
        purchase_basis:
          '<strong>Rechtsgrundlage:</strong> Art. 6 Abs. 1 lit. b DSGVO — Erfüllung des bei einem Kauf abgeschlossenen Vertrags.',
        cookies_body1:
          'Diese Seite setzt keine First-Party-Cookies. Wir nutzen keinerlei Analyse-Tools (kein Google Analytics, kein Plausible, kein Posthog, gar nichts).',
        cookies_body2:
          'Cloudflare kann aus Sicherheitsgründen ein technisch notwendiges Cookie (<code>__cf_bm</code>, „Bot-Management") für etwa 30 Minuten setzen. Gemäß § 25 Abs. 2 TDDDG fällt dies unter die Einwilligungsausnahme für technisch notwendige Cookies; ein Cookie-Banner ist nicht erforderlich.',
        recipients_cf:
          '<strong>Cloudflare, Inc.</strong> — Hosting und CDN. Server-Log-Daten können in Rechtsgebiete außerhalb des EWR übertragen und dort zwischengespeichert werden, darunter die USA, gestützt auf das EU-US Data Privacy Framework und Cloudflares DSGVO-Auftragsverarbeitungsvertrag.',
        recipients_polar:
          '<strong>Polar Software, Inc.</strong> — Zahlungsabwicklung. Tritt als Merchant of Record für Käufe auf. Verarbeitet Ihre Zahlungsinformationen nach eigener Datenschutzerklärung.',
        recipients_note:
          'Wir verkaufen, vermieten oder teilen Ihre Daten in keiner anderen Weise mit Dritten.',
        intl_body:
          'Soweit Daten außerhalb des EWR übermittelt werden (hauptsächlich über Cloudflare und Polar), stützen wir uns entweder auf einen Angemessenheitsbeschluss nach Art. 45 DSGVO oder auf Standardvertragsklauseln nach Art. 46 Abs. 2 lit. c DSGVO für die jeweiligen Auftragsverarbeiter.',
        rights: {
          access:
            '<strong>Auskunft</strong> (Art. 15) — Bestätigung, ob und welche Daten wir über Sie verarbeiten, samt einer Kopie.',
          rectification:
            '<strong>Berichtigung</strong> (Art. 16) — Korrektur unrichtiger Daten.',
          erasure:
            '<strong>Löschung</strong> (Art. 17) — Löschung Ihrer Daten, wenn die Rechtsgrundlage für die Verarbeitung entfällt.',
          restriction:
            '<strong>Einschränkung</strong> (Art. 18) — Beschränkung der Verarbeitung auf reine Speicherung während eines Streits.',
          portability:
            '<strong>Übertragbarkeit</strong> (Art. 20) — Export Ihrer Daten in einem strukturierten, maschinenlesbaren Format.',
          objection:
            '<strong>Widerspruch</strong> (Art. 21) — gegen Verarbeitungen, die auf berechtigtem Interesse beruhen.',
          withdraw:
            '<strong>Widerruf der Einwilligung</strong> jederzeit (sofern die Verarbeitung auf einer Einwilligung beruht), ohne die Rechtmäßigkeit der bisherigen Verarbeitung zu berühren.',
        },
        rights_exercise:
          'Zur Ausübung eines dieser Rechte senden Sie eine E-Mail an <a href="mailto:atay@oezcan.me">atay@oezcan.me</a>. Wir antworten innerhalb eines Monats gemäß Art. 12 Abs. 3 DSGVO.',
        complaint_body:
          'Sie können bei einer Datenschutz-Aufsichtsbehörde Beschwerde einlegen — in der Regel im Bundesland Ihres Wohn- oder Arbeitsorts. In Deutschland finden Sie die Übersicht der Landesbehörden bei der <a href="https://www.bfdi.bund.de" target="_blank" rel="noopener">Bundesbeauftragten für den Datenschutz</a>.',
        changes_body:
          'Wir können diese Erklärung aktualisieren, wenn sich unsere Praktiken ändern. Das Datum oben spiegelt die jüngste Überarbeitung wider.',
      },
    },

    tr: {
      nav: { features: 'Özellikler', pricing: 'Fiyat', download: 'İndir', about: 'Hakkımda' },
      hero: {
        title: 'Seninle hareket eden',
        titleAccent: 'duvar kağıtları.',
        sub: 'Bilgisayarının duvar kağıdını değiştirmek için küçük bir masaüstü uygulaması. Hazır desenler, birkaç fotoğraf kaynağı ve istersen ne yazarsan onu üreten bir AI üretici.',
        ctaBuy: '{PRICE}\'a satın al',
        ctaDownload: 'İndir →',
        meta: 'macOS · Windows · Linux &nbsp;·&nbsp; <strong>{PRICE} tek seferlik</strong> &nbsp;·&nbsp; abonelik yok &nbsp;·&nbsp; telemetri yok',
      },
      features: {
        eyebrow: 'İçinde neler var',
        patterns: {
          title: 'On desen üreticisi',
          body: 'Mesh gradientleri, noktalar, çizgiler, geometrik şekiller, akan çizgiler, dalgalar, aurora, bokeh, yapraklar ve emoji duvar kağıtları — toplam on tane. Ayarlarla oyna ya da karıştır, biri tutana kadar.',
        },
        sources: {
          title: 'Seçili fotoğraf kaynakları',
          body: 'NASA ve Bing\'den her gün yeni bir fotoğraf, Lorem Picsum\'dan rastgele kareler — hepsi bedava, anahtarsız. Aramaya dayalı seçim için ücretsiz bir Unsplash, Pexels ya da Wallhaven anahtarı ekle. Uyguladığın her şey yerele kaydediliyor.',
        },
        ai: {
          title: 'Yapay zeka üretimi',
          body: 'Bir komut yaz, ⌘↩ tuşla. Pollinations baştan ücretsiz çalışıyor — bir token ile limiti kaldırırsın. Ya da DALL·E 3 için kendi OpenAI anahtarını kullanırsın.',
        },
        library: {
          title: 'Kendi kütüphanen',
          body: 'Kullandığın her şey kütüphanede kalıyor. Tek tık tekrar uyguluyor, çift tık siliyor. Dosyalar sadece diskinde duruyor.',
        },
        privacy: {
          title: 'Cihazında kalır',
          body: 'Tauri + Rust + React üzerine kurulu. Hesap yok, telemetri yok, bir sunucu falan da yok. Uygulamanın internette tek konuştuğu, senin açtığın görüntü kaynağı.',
        },
        design: {
          title: 'Apple inspector\'ı gibi tasarlandı',
          body: 'Inspector sağda, sen ayarlarken önizleme yerinde duruyor. Cam yüzeyler, az animasyon. Linux\'ta yerel Wayland.',
        },
      },
      pricing: {
        eyebrow: 'Fiyat',
        sub: 'Tek fiyat, bir kez. Sonraki sürümler de bedava.',
        period: 'tek seferlik',
        tagline: 'Senin, her gelecek güncellemeyle birlikte.',
        feat1: 'Tüm desenler, tüm kaynaklar ve AI üretici',
        feat2: 'macOS, Windows ve Linux',
        feat3: 'Ömür boyu ücretsiz güncelleme, yenisi geldiğinde uygulama haber veriyor',
        feat4: 'Kendi sahip olduğun istediğin kadar makinede kullan',
        feat5: 'Abonelik yok, hesap yok, analitik yok',
        buy: '{PRICE}\'a satın al',
        fineprint:
          'Bir kez öde, hepsi bu. Aynı lisans Mac, PC ya da Linux makinen için geçerli.',
      },
      download: {
        eyebrow: 'İndir',
        sub: 'Uygulamayı herkes indirebilir. Satın aldığında e-postayla bir lisans anahtarı gelir, ilk açılışta yapıştırırsın.',
        cta: 'İndir',
        others: 'Diğer platformlar',
        arch: 'Mimari',
        distro: 'Dağıtım / format',
        note: 'macOS ve Windows sürümleri henüz imzasız, o yüzden ilk açılışta bilinmeyen uygulama diye uyarıyorlar. Mac\'te uygulamaya sağ tık atıp „Aç" diyorsun. Windows\'ta „Daha fazla bilgi" ve sonra „Yine de çalıştır".',
      },
      about: {
        eyebrow: 'Yapımcı',
        role: 'Bilgisayar Mühendisliği öğrencisi · internette projeler geliştiriyor',
        body: 'Ambient\'i kendi laptopumda istediğim için yaptım. Denersen, neyin çalıştığını ve neyin çalışmadığını bana yaz. Gelen her şeye cevap veriyorum.',
      },
      impressum: {
        title: 'Künye',
        lede: 'Almanya Digitale-Dienste-Gesetz (DDG) § 5 uyarınca zorunlu bilgilendirme.',
        h: {
          provider: 'Hizmet sağlayıcı',
          contact: 'İletişim',
          vat: 'KDV',
          responsible: 'İçerikten sorumlu (§ 18 Abs. 2 MStV)',
          odr: 'AB çevrimiçi uyuşmazlık çözümü',
          liability: 'İçeriklerden sorumluluk',
          links: 'Bağlantılardan sorumluluk',
          copyright: 'Telif hakkı',
        },
        contact_email_label: 'E-posta:',
        vat_body:
          'Almanya\'da küçük işletme kuralı (§ 19 UStG — Kleinunternehmerregelung) çerçevesinde faaliyet gösterilmektedir. KDV ayrıca gösterilmez ve müşteriler tarafından girdi vergisi olarak indirim konusu yapılamaz.',
        responsible_body: 'Atay Özcan (yukarıdaki adres).',
        odr_body:
          'Avrupa Komisyonu, çevrimiçi uyuşmazlık çözümü için bir platform sağlamaktadır: <a href="https://ec.europa.eu/consumers/odr" target="_blank" rel="noopener">ec.europa.eu/consumers/odr</a>. Tüketici tahkim kurulu önündeki uyuşmazlık çözüm süreçlerine katılma ne yükümlülüğümüz ne de niyetimiz vardır.',
        liability_body:
          '§ 7 (1) DDG uyarınca hizmet sağlayıcı olarak, bu sayfadaki kendi içeriklerimizden genel yasalara göre sorumluyuz. §§ 8 ila 10 DDG uyarınca, hizmet sağlayıcı olarak iletilen veya depolanan üçüncü taraf bilgilerini izleme ya da yasa dışı faaliyete işaret eden koşulları araştırma yükümlülüğümüz yoktur. Genel yasalara göre bilgileri kaldırma veya engelleme yükümlülükleri saklıdır. Bu kapsamdaki sorumluluk ancak somut bir hukuki ihlalin öğrenildiği andan itibaren mümkündür.',
        links_body:
          'Bu sayfa, içeriği üzerinde hiçbir etkimiz olmayan dış üçüncü taraf web sitelerine bağlantılar içerir. Bu nedenle bu yabancı içerikler için herhangi bir sorumluluk kabul edemeyiz. İlgili sağlayıcı sorumludur. Bağlantı verilen siteler, bağlantı verildiği sırada olası yasal ihlaller açısından incelenmiştir. Somut bir ihlal göstergesi olmaksızın sürekli izleme makul değildir; bir ihlal öğrenildiğinde bağlantılar derhal kaldırılır.',
        copyright_body:
          'Bu sitede yayımlanan tüm yazılım, tasarım, marka, pazarlama metni ve varlıklar © 2026 Atay Özcan\'a aittir. Tüm hakları saklıdır.',
      },
      privacy: {
        title: 'Gizlilik politikası',
        lede:
          'Yürürlük tarihi: <time datetime="2026-05-16">2026-05-16</time>. Genel Veri Koruma Tüzüğü (GDPR / DSGVO) ve Almanya Federal Veri Koruma Yasası (BDSG) gerekliliklerini karşılamak üzere hazırlanmıştır.',
        h: {
          controller: 'Veri sorumlusu',
          what_data: 'Hangi veriler işlenir',
          logs: '1. Sunucu kayıtları (Cloudflare)',
          purchase: '2. Satın alma verileri (satın aldığında)',
          cookies: 'Çerezler',
          recipients: 'Alıcılar / alt işleyenler',
          intl: 'Uluslararası veri aktarımı',
          rights: 'GDPR kapsamındaki haklarınız',
          complaint: 'Şikayet hakkı',
          changes: 'Değişiklikler',
        },
        controller_lede:
          'Veri sorumlusu, kişisel verilerin işlenmesinin amaçlarını ve araçlarını tek başına veya başkalarıyla birlikte belirleyen gerçek veya tüzel kişidir.',
        what_data_intro: 'Bu site bilinçli olarak minimaldir. İki veri kaynağı:',
        logs_body:
          'Bu siteyi ziyaret ettiğinizde, barındırma sağlayıcımız Cloudflare otomatik olarak şu bilgileri kaydeder: IP adresi, istenen URL, HTTP yöntemi, yanıt durumu, user-agent dizesi, referrer, zaman damgası. Bu veriler, saldırıları, kötüye kullanımı ve operasyonel sorunları tespit etmek ve azaltmak amacıyla en fazla 30 gün saklanır.',
        logs_basis:
          '<strong>Hukuki dayanak:</strong> GDPR Madde 6(1)(f) — bu web sitesinin güvenli işletilmesindeki meşru menfaatimiz.',
        purchase_body:
          '„Satın al" düğmesi, Merchant of Record\'ımız <a href="https://polar.sh" target="_blank" rel="noopener">Polar Software, Inc.</a> („Polar") tarafından barındırılan ödeme sayfasına götürür. Polar ödeme bilgilerinizi, fatura ülkenizi ve e-posta adresinizi doğrudan toplar. Biz yalnızca şunları alırız: e-posta adresiniz, sipariş kimliği, satın alınan ürün ve ödeme onayı. Ödeme sırasında Polar\'ın kendi gizlilik politikası geçerlidir.',
        purchase_basis:
          '<strong>Hukuki dayanak:</strong> GDPR Madde 6(1)(b) — satın alma sırasında akdettiğiniz sözleşmenin ifası.',
        cookies_body1:
          'Bu site birinci taraf çerez kullanmaz. Hiçbir analitik araç çalıştırmıyoruz (Google Analytics yok, Plausible yok, Posthog yok, hiçbir şey yok).',
        cookies_body2:
          'Cloudflare, güvenlik amacıyla yaklaşık 30 dakika boyunca kesinlikle gerekli bir teknik çerez (<code>__cf_bm</code>, „bot yönetimi") yerleştirebilir. § 25 (2) TDDDG kapsamında bu, teknik olarak gerekli çerezler için onay istisnasına girer; banner gerekmez.',
        recipients_cf:
          '<strong>Cloudflare, Inc.</strong> — site barındırma ve CDN. Sunucu kayıt verileri AB-ABD Veri Gizliliği Çerçevesi ve Cloudflare\'in GDPR Veri İşleme Sözleşmesi kapsamında ABD dahil AEA dışındaki yargı bölgelerine aktarılabilir ve önbelleğe alınabilir.',
        recipients_polar:
          '<strong>Polar Software, Inc.</strong> — ödeme işleme. Satın alımlar için Merchant of Record olarak hareket eder. Ödeme bilgilerinizi kendi gizlilik politikası altında işler.',
        recipients_note:
          'Verilerinizi başka hiçbir tarafa satmıyor, kiralamıyor veya başka şekilde paylaşmıyoruz.',
        intl_body:
          'Verilerin AEA dışına aktarıldığı durumlarda (esas olarak Cloudflare ve Polar üzerinden), ilgili işleyiciler için ya GDPR Madde 45 kapsamındaki yeterlilik kararına ya da GDPR Madde 46(2)(c) kapsamındaki Standart Sözleşme Maddelerine dayanırız.',
        rights: {
          access:
            '<strong>Erişim</strong> (Madde 15) — hakkınızda veri işleyip işlemediğimizin teyidi ve işliyorsak bir kopyası.',
          rectification:
            '<strong>Düzeltme</strong> (Madde 16) — hatalı verilerin düzeltilmesi.',
          erasure:
            '<strong>Silme</strong> (Madde 17) — işleme için hukuki gerekçenin kalmadığı verilerinizin silinmesi.',
          restriction:
            '<strong>Kısıtlama</strong> (Madde 18) — uyuşmazlık süresince işlemenin saklamayla sınırlandırılması.',
          portability:
            '<strong>Taşınabilirlik</strong> (Madde 20) — verilerinizin yapılandırılmış, makine tarafından okunabilir biçimde dışa aktarılması.',
          objection:
            '<strong>İtiraz</strong> (Madde 21) — meşru menfaate dayalı işlemelere.',
          withdraw:
            'İşleme onaya dayalı olduğunda <strong>onayı geri çekme</strong> hakkı; geri çekme, önceki işlemlerin hukuka uygunluğunu etkilemez.',
        },
        rights_exercise:
          'Bu haklardan herhangi birini kullanmak için <a href="mailto:atay@oezcan.me">atay@oezcan.me</a> adresine e-posta gönderin. GDPR Madde 12(3) uyarınca bir ay içinde yanıtlarız.',
        complaint_body:
          'Bir veri koruma denetim makamına şikayette bulunabilirsiniz — genellikle yaşadığınız veya çalıştığınız eyaletteki makam. Almanya\'da eyalet makamlarının listesi için <a href="https://www.bfdi.bund.de" target="_blank" rel="noopener">Bundesbeauftragte für den Datenschutz</a> sayfasına bakın.',
        changes_body:
          'Uygulamalarımız değiştiğinde bu politikayı güncelleyebiliriz. Üstteki yürürlük tarihi en son revizyonu yansıtır.',
      },
    },
  };
  /* eslint-enable @stylistic/quotes */

  var currentLang = localStorage.getItem('ambient.lang') || detectLang();

  // Polar offers the product at €15 EUR + $15 USD (both round, not
  // FX-converted). Pick EUR for eurozone visitors so the checkout shows
  // the same currency they saw on the page; everyone else gets USD.
  // Polar's hosted checkout honors the customer's billing country if
  // they pick differently, so worst case we under-guess and Polar
  // shows the alternative — still consistent.
  var EUROZONE = {
    AT: 1, BE: 1, CY: 1, DE: 1, EE: 1, ES: 1, FI: 1, FR: 1, GR: 1, HR: 1,
    IE: 1, IT: 1, LT: 1, LU: 1, LV: 1, MT: 1, NL: 1, PT: 1, SI: 1, SK: 1,
  };

  // Sync best-guess region for the initial paint — used before the
  // /cdn-cgi/trace fetch returns. Order: TZ (mirrors physical
  // location better than browser language) → browser locale region.
  function detectRegionSync() {
    try {
      var tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
      var tzRegion = tzToRegion(tz);
      if (tzRegion) return tzRegion;
    } catch (_) {}
    try {
      var loc = new Intl.Locale(navigator.language || 'en');
      if (loc && loc.region) return loc.region.toUpperCase();
    } catch (_) {}
    var raw = (navigator.language || '').split('-')[1];
    return raw ? raw.toUpperCase() : '';
  }

  // Tiny TZ → ISO country map. Covers only the eurozone capitals we
  // need to flip the currency for; everything else falls through to
  // an empty string and the locale fallback (or USD default) wins.
  function tzToRegion(tz) {
    var TZ_TO_COUNTRY = {
      'Europe/Berlin':    'DE', 'Europe/Vienna':    'AT',
      'Europe/Brussels':  'BE', 'Europe/Nicosia':   'CY',
      'Europe/Tallinn':   'EE', 'Europe/Madrid':    'ES',
      'Europe/Helsinki':  'FI', 'Europe/Paris':     'FR',
      'Europe/Athens':    'GR', 'Europe/Zagreb':    'HR',
      'Europe/Dublin':    'IE', 'Europe/Rome':      'IT',
      'Europe/Vilnius':   'LT', 'Europe/Luxembourg':'LU',
      'Europe/Riga':      'LV', 'Europe/Malta':     'MT',
      'Europe/Amsterdam': 'NL', 'Europe/Lisbon':    'PT',
      'Europe/Ljubljana': 'SI', 'Europe/Bratislava':'SK',
    };
    return TZ_TO_COUNTRY[tz] || '';
  }

  var currentRegion = detectRegionSync();
  var currentCurrency = EUROZONE[currentRegion] ? 'EUR' : 'USD';
  // Both displayed as "$15" / "€15" with the symbol before the digits —
  // matches the existing price-card layout and reads consistently across
  // locales. Polar's invoice will use the locale-correct format.
  var PRICE_FORMS = { USD: '$15', EUR: '€15' };
  var CURRENCY_SYMBOLS = { USD: '$', EUR: '€' };

  function priceString() {
    return PRICE_FORMS[currentCurrency];
  }

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
    var price = priceString();

    document.documentElement.lang = lang;

    document.querySelectorAll('[data-i18n]').forEach(function (el) {
      var v = lookup(dict, el.getAttribute('data-i18n'));
      if (typeof v === 'string') el.textContent = v.split('{PRICE}').join(price);
    });

    document.querySelectorAll('[data-i18n-html]').forEach(function (el) {
      var v = lookup(dict, el.getAttribute('data-i18n-html'));
      if (typeof v === 'string') el.innerHTML = v.split('{PRICE}').join(price);
    });

    document.querySelectorAll('[data-i18n-placeholder]').forEach(function (el) {
      var v = lookup(dict, el.getAttribute('data-i18n-placeholder'));
      if (typeof v === 'string') el.placeholder = v;
    });

    localStorage.setItem('ambient.lang', lang);
    currentLang = lang;

    var sel = document.getElementById('lang-switcher');
    if (sel) sel.value = lang;
  }

  function applyCurrency() {
    // Visual price-card: swap the symbol (number stays 15 in both
    // currencies since Polar lists both at round 15).
    document.querySelectorAll('.price-currency').forEach(function (el) {
      el.textContent = CURRENCY_SYMBOLS[currentCurrency];
    });
  }

  // Cloudflare exposes the visitor's country at /cdn-cgi/trace on
  // every CF-hosted domain. We hit it AFTER initial paint so the
  // first render uses the best-guess (TZ/locale) region, then snap
  // to the truth once the trace responds. Free, no JSON parse —
  // text key=value lines.
  function refineCurrencyFromTrace() {
    fetch('/cdn-cgi/trace', { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.text() : ''; })
      .then(function (text) {
        if (!text) return;
        var m = text.match(/^loc=([A-Z]{2})$/m) || text.match(/^country=([A-Z]{2})$/m);
        if (!m) return;
        var region = m[1].toUpperCase();
        var nextCurrency = EUROZONE[region] ? 'EUR' : 'USD';
        if (nextCurrency === currentCurrency) return;
        currentRegion = region;
        currentCurrency = nextCurrency;
        applyCurrency();
        // Re-run language so {PRICE} placeholders pick up the new
        // currency without a page reload.
        applyLanguage(currentLang);
      })
      .catch(function () {});
  }

  document.addEventListener('DOMContentLoaded', function () {
    applyCurrency();
    applyLanguage(currentLang);
    refineCurrencyFromTrace();

    var langSel = document.getElementById('lang-switcher');
    if (langSel) langSel.addEventListener('change', function () { applyLanguage(langSel.value); });
  });
})();
