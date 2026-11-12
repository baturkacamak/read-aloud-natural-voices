# Mağaza Yayın Dosyası — Read Aloud: Natural Voices

Bu dosya, eklentiyi **Microsoft Edge Add-ons** mağazasına göndermek için gereken
metinleri ve kontrol listesini içerir.

> **Uyumluluk:** Ses servisi bazı tarayıcı ve ortamlarda 403 hatası verebilir.
> Chrome dahil hedef tarayıcılarda gerçek ses üretimini yayın öncesi test edin.

## Temel bilgiler

| Alan | Değer |
| --- | --- |
| Ad | Dile göre yerelleştirilir; Türkçe: Sesli Oku: Doğal Sesler |
| Sürüm | `manifest.json` içindeki sürüm (şu an 0.7.1) |
| Kategori | Accessibility (Erişilebilirlik) |
| Dil | Türkçe (varsayılan); yerelleştirilmiş metinler `store-assets/` altında |
| Lisans | GPL-3.0 |
| Gizlilik politikası | `PRIVACY.md` (yayın için herkese açık bir URL'de barındırılmalı) |

## Kısa açıklama (≤132 karakter)

> Edge'in doğal sesleriyle sayfaları ve seçimleri dinleyin. Kelime
> vurgusu, hız kontrolü ve Türkçe sesler.

Alternatif:

> Edge Read Aloud: sayfaları ve seçimleri Microsoft'un doğal sesleriyle
> dinleyin.

## Uzun açıklama

**Read Aloud: Natural Voices ile web sayfalarını ve belgeleri dinleyin.**

Read Aloud: Natural Voices, Microsoft Edge'in Read Aloud servisini doğrudan kullanarak web
sayfalarını ve seçili metinleri 300'den fazla doğal neural sesle okur. Türkçe
için Emel ve Ahmet sesleri hazırdır.

**Özellikler**

- Sayfanın tamamını, seçili metni veya imlecin olduğu yerden okuma
- Okunan paragrafı ve kelimeyi sayfada vurgulama, otomatik kaydırma
- Yumuşak geçişli vurgu halesi ve seçimden sonra devam etme
- Oynatıcıda canlı hız (0.75×–2×), önceki/sonraki paragraf, duraklat/durdur
- Çok dilli arayüz, klavye kısayolları ve sağ tık menüsü
- Ayarlar yerel olarak saklanır; geliştirici hiçbir veri toplamaz

**Nasıl kullanılır?**

1. Araç çubuğundaki Read Aloud: Natural Voices simgesine tıklayın.
2. **Sayfayı oku** veya **Seçimi oku** düğmesini seçin.
3. Alternatif: `Alt+Shift+R` (sayfa), `Alt+Shift+S` (seçim),
   `Alt+Shift+H` (imleçten), `Alt+Shift+Space` (oynat/duraklat).
4. Sayfanın altındaki oynatıcıdan hızı değiştirin, paragraflar arasında geçin.

**Notlar**

- İnternet bağlantısı gerekir; metin seslendirme için Microsoft'un servisine
  gönderilir.
- PDF ve EPUB dosyaları uzantının belge okuyucusunda açılır; `edge://` sayfaları desteklenmez.
- Microsoft'un Read Aloud uç noktası resmî olmayan bir API'dir; Microsoft
  algoritmayı değiştirirse eklenti güncellemesi gerekebilir.
- Microsoft, Edge ve Read Aloud; Microsoft Corporation'ın ticari markalarıdır.
  Bu eklenti Microsoft ile bağlantılı değildir.

## İzin gerekçeleri (inceleme formu için)

| İzin | Gerekçe |
| --- | --- |
| `storage` | Ses, hız, ses düzeyi ve oynatma hızı ayarlarını yerel olarak saklamak. |
| `contextMenus` | Sağ tık menüsüne "Sayfayı sesli oku" ve "Seçimi sesli oku" eklemek. |
| `activeTab` + `scripting` | Kullanıcı eklentiye tıkladıktan sonra etkin sekmedeki metni okumak ve oynatıcıyı sayfaya eklemek. |
| `host_permissions`: `speech.platform.bing.com` | Ses listesini almak ve ses üretmek için Microsoft Read Aloud servisine bağlanmak. |
| `content_scripts`: `<all_urls>` | Kullanıcının başlattığı okuma için sayfa metnine erişmek. Yalnızca kullanıcı eylemiyle çalışır. |

## Gizlilik formu yanıtları

- Kişisel veri topluyor musunuz? **Hayır.**
- Sağlık verisi işliyor musunuz? **Hayır.**
- Finansal bilgi işliyor musunuz? **Hayır.**
- Kimlik bilgisi işliyor musunuz? **Hayır.**
- Kişisel iletişim bilgisi işliyor musunuz? **Hayır.**
- Konum işliyor musunuz? **Hayır.**
- Web geçmişi işliyor musunuz? **Hayır.** (Yalnızca kullanıcının o an okuttuğu sayfanın metni işlenir; geçmiş saklanmaz.)
- Kullanıcı etkinliği izliyor musunuz? **Hayır.**
- Verileri üçüncü taraflarla paylaşıyor musunuz? **Yalnızca seslendirme için Microsoft'a metin gönderilir.** Bu, gizlilik politikasında açıklanmıştır.

## Ekran görüntüleri (1280×800)

| Dosya | İçerik |
| --- | --- |
| `store/screenshots/01-sayfa.png` | Okunan paragraf + kelime vurgusu + alt oynatıcı |
| `store/screenshots/02-popup.png` | Ses seçimi, hız ve ses düzeyi arayüzü |
| `store/screenshots/03-secim.png` | Seçili metni okuma (opsiyonel) |

Ekran görüntüleri `store/screenshots/` altındadır. Demo sayfası
`store/demo/index.html`; mağaza görselleri bu sayfa ve gerçek popup arayüzü
kullanılarak 1280×800 olarak hazırlanmıştır.

## Yayın kontrol listesi

- [ ] `manifest.json` sürümünü kontrol et (`0.7.1`).
- [ ] `python3 scripts/package.py` ile ZIP üret.
- [ ] ZIP'i Edge Add-ons geliştirici paneline yükle.
- [ ] `PRIVACY.md` içeriğini herkese açık bir URL'de yayınla (GitHub Pages,
      depo README'si veya kişisel site) ve mağaza formuna gir.
- [ ] En az 1, tercihen 3 ekran görüntüsü yükle (1280×800).
- [ ] Mağaza açıklamasını ve izin gerekçelerini yapıştır.
- [ ] İnceleme notuna şunu ekle: "Read Aloud, Linux'ta Edge'de bulunmadığı için
      bu eklenti Microsoft'un kendi Read Aloud WebSocket servisini kullanır.
      Metin yalnızca kullanıcı eylemiyle gönderilir."
- [ ] Yayın sonrası 403 hatası için `README.md` sorun giderme adımlarını takip et.

## Bilinen mağaza riskleri

- **Resmî olmayan API:** Microsoft, Read Aloud uç noktasını yalnızca Edge
  istemcisi için sunuyor. Mağaza incelemesi bunu "yetkisiz API kullanımı" olarak
  değerlendirebilir. Gerekirse eklenti "deneysel" olarak işaretlenir veya yalnızca
  kişisel dağıtım (unpacked) ile kullanılır.
- **SSML/token değişiklikleri:** Microsoft token algoritmasını değiştirirse
  güncelleme yayınlamak gerekir; mağaza incelemesi birkaç gün sürebilir.
- **Telif/atıf:** Token algoritması GPL-3.0 `rany2/edge-tts` projesinden port
  edilmiştir; kaynak kod açıktır ve `NOTICE` dosyasında atıf yapılmıştır.

## Mağaza metni (İngilizce taslak)

**Short description:** Listen to web pages and selections with
Microsoft Edge's natural Read Aloud voices. Word highlighting, speed control and
Turkish voices.

**Detailed description:**

> Read Aloud: Natural Voices lets you listen to web pages and documents with
> natural voices by talking directly to Edge's Read Aloud service.
>
> • Read the whole page or just the selected text
> • Highlight the current paragraph and word, with automatic scrolling
> • Soft animated glow around the word being read
> • Continue after a selection (can be disabled in the popup)
> • Player with live speed (0.75×–2×), previous/next paragraph, pause and stop
> • The current word is highlighted directly in the article text
> • Multilingual UI, keyboard shortcuts and a right-click menu
> • Settings stay local; the developer collects no data
>
> Requires an internet connection: text is sent to Microsoft's speech service
> for synthesis. Not affiliated with Microsoft.
