#!/usr/bin/env node
/**
 * add-hardcoded-translations.js
 * Add translations for hardcoded Japanese strings found in UI components
 */

const fs = require('fs');
const path = require('path');

const LOCALES_DIR = path.join(__dirname, '../../locales');

// New translation keys for hardcoded Japanese strings
const newTranslations = {
  common: {
    // AI Panel
    "ai.changedFilesList.title": {
      en: "Changed files",
      ja: "変更ファイル",
      zh: "已更改的文件",
      "zh-TW": "已變更的檔案",
      ko: "변경된 파일",
      de: "Geänderte Dateien",
      fr: "Fichiers modifiés",
      es: "Archivos modificados",
      pt: "Arquivos alterados",
      ru: "Изменённые файлы",
      it: "File modificati",
      ar: "الملفات المُعدلة",
      hi: "बदली हुई फाइलें",
      nl: "Gewijzigde bestanden",
      pl: "Zmienione pliki",
      sv: "Ändrade filer",
      tr: "Değişen dosyalar",
      vi: "Tệp đã thay đổi",
      th: "ไฟล์ที่เปลี่ยนแปลง",
      id: "File yang berubah"
    },
    "ai.changedFilesList.count": {
      en: "{count} files",
      ja: "{count} 個",
      zh: "{count} 个",
      "zh-TW": "{count} 個",
      ko: "{count} 개",
      de: "{count} Dateien",
      fr: "{count} fichiers",
      es: "{count} archivos",
      pt: "{count} arquivos",
      ru: "{count} файлов",
      it: "{count} file",
      ar: "{count} ملفات",
      hi: "{count} फाइलें",
      nl: "{count} bestanden",
      pl: "{count} plików",
      sv: "{count} filer",
      tr: "{count} dosya",
      vi: "{count} tệp",
      th: "{count} ไฟล์",
      id: "{count} file"
    },
    "ai.changedFilesList.expand": {
      en: "Expand",
      ja: "展開する",
      zh: "展开",
      "zh-TW": "展開",
      ko: "펼치기",
      de: "Erweitern",
      fr: "Développer",
      es: "Expandir",
      pt: "Expandir",
      ru: "Развернуть",
      it: "Espandi",
      ar: "توسيع",
      hi: "विस्तार करें",
      nl: "Uitvouwen",
      pl: "Rozwiń",
      sv: "Expandera",
      tr: "Genişlet",
      vi: "Mở rộng",
      th: "ขยาย",
      id: "Perluas"
    },
    "ai.changedFilesList.minimize": {
      en: "Minimize",
      ja: "最小化する",
      zh: "最小化",
      "zh-TW": "最小化",
      ko: "최소화",
      de: "Minimieren",
      fr: "Réduire",
      es: "Minimizar",
      pt: "Minimizar",
      ru: "Свернуть",
      it: "Riduci",
      ar: "تصغير",
      hi: "छोटा करें",
      nl: "Minimaliseren",
      pl: "Minimalizuj",
      sv: "Minimera",
      tr: "Küçült",
      vi: "Thu nhỏ",
      th: "ย่อ",
      id: "Perkecil"
    },
    // AI Review Tab
    "aiReviewTab.revertApplied": {
      en: "Revert applied",
      ja: "適用済みを元に戻す",
      zh: "撤销已应用的更改",
      "zh-TW": "撤銷已套用的變更",
      ko: "적용된 항목 되돌리기",
      de: "Angewendete zurücksetzen",
      fr: "Annuler les applications",
      es: "Revertir aplicados",
      pt: "Reverter aplicados",
      ru: "Отменить примененные",
      it: "Ripristina applicati",
      ar: "استعادة المطبقة",
      hi: "लागू किए गए को वापस करें",
      nl: "Toegepaste terugdraaien",
      pl: "Cofnij zastosowane",
      sv: "Återställ tillämpade",
      tr: "Uygulananları geri al",
      vi: "Hoàn tác đã áp dụng",
      th: "ยกเลิกที่ใช้แล้ว",
      id: "Batalkan yang diterapkan"
    },
    "aiReviewTab.revertButton": {
      en: "Revert",
      ja: "元に戻す",
      zh: "撤销",
      "zh-TW": "撤銷",
      ko: "되돌리기",
      de: "Zurücksetzen",
      fr: "Annuler",
      es: "Revertir",
      pt: "Reverter",
      ru: "Отменить",
      it: "Ripristina",
      ar: "استعادة",
      hi: "वापस करें",
      nl: "Terugdraaien",
      pl: "Cofnij",
      sv: "Återställ",
      tr: "Geri al",
      vi: "Hoàn tác",
      th: "ยกเลิก",
      id: "Batalkan"
    },
    // Problems Panel
    "bottom.outputPanel.partiallyHidden": {
      en: "Some items hidden",
      ja: "一部非表示中",
      zh: "部分内容已隐藏",
      "zh-TW": "部分內容已隱藏",
      ko: "일부 항목이 숨겨짐",
      de: "Einige Elemente ausgeblendet",
      fr: "Certains éléments masqués",
      es: "Algunos elementos ocultos",
      pt: "Alguns itens ocultos",
      ru: "Некоторые элементы скрыты",
      it: "Alcuni elementi nascosti",
      ar: "بعض العناصر مخفية",
      hi: "कुछ आइटम छिपे हुए हैं",
      nl: "Sommige items verborgen",
      pl: "Niektóre elementy ukryte",
      sv: "Vissa objekt dolda",
      tr: "Bazı öğeler gizli",
      vi: "Một số mục ẩn",
      th: "ซ่อนบางรายการ",
      id: "Beberapa item tersembunyi"
    },
    // Settings Panel
    "settingsPanel.shortcutKeys": {
      en: "Shortcut Keys",
      ja: "ショートカットキー設定",
      zh: "快捷键设置",
      "zh-TW": "快捷鍵設定",
      ko: "단축키 설정",
      de: "Tastenkombinationen",
      fr: "Raccourcis clavier",
      es: "Atajos de teclado",
      pt: "Atalhos de teclado",
      ru: "Горячие клавиши",
      it: "Scorciatoie da tastiera",
      ar: "اختصارات لوحة المفاتيح",
      hi: "शॉर्टकट कुंजियाँ",
      nl: "Sneltoetsen",
      pl: "Skróty klawiaturowe",
      sv: "Kortkommandon",
      tr: "Kısayol tuşları",
      vi: "Phím tắt",
      th: "ปุ่มลัด",
      id: "Pintasan keyboard"
    },
    // Shortcut Keys Tab
    "shortcutKeys.title": {
      en: "Shortcut Keys",
      ja: "ショートカットキー",
      zh: "快捷键",
      "zh-TW": "快捷鍵",
      ko: "단축키",
      de: "Tastenkombinationen",
      fr: "Raccourcis clavier",
      es: "Atajos de teclado",
      pt: "Atalhos de teclado",
      ru: "Горячие клавиши",
      it: "Scorciatoie da tastiera",
      ar: "اختصارات لوحة المفاتيح",
      hi: "शॉर्टकट कुंजियाँ",
      nl: "Sneltoetsen",
      pl: "Skróty klawiaturowe",
      sv: "Kortkommandon",
      tr: "Kısayol tuşları",
      vi: "Phím tắt",
      th: "ปุ่มลัด",
      id: "Pintasan keyboard"
    },
    "shortcutKeys.searchPlaceholder": {
      en: "Search (function, key)...",
      ja: "検索 (機能名, キー)...",
      zh: "搜索（功能名、按键）...",
      "zh-TW": "搜尋（功能名、按鍵）...",
      ko: "검색 (기능, 키)...",
      de: "Suchen (Funktion, Taste)...",
      fr: "Rechercher (fonction, touche)...",
      es: "Buscar (función, tecla)...",
      pt: "Pesquisar (função, tecla)...",
      ru: "Поиск (функция, клавиша)...",
      it: "Cerca (funzione, tasto)...",
      ar: "بحث (الوظيفة، المفتاح)...",
      hi: "खोजें (फ़ंक्शन, कुंजी)...",
      nl: "Zoeken (functie, toets)...",
      pl: "Szukaj (funkcja, klawisz)...",
      sv: "Sök (funktion, tangent)...",
      tr: "Ara (fonksiyon, tuş)...",
      vi: "Tìm kiếm (chức năng, phím)...",
      th: "ค้นหา (ฟังก์ชัน, คีย์)...",
      id: "Cari (fungsi, tombol)..."
    },
    "shortcutKeys.resetDefaults": {
      en: "Reset to defaults",
      ja: "初期設定に戻す",
      zh: "重置为默认值",
      "zh-TW": "重置為預設值",
      ko: "기본값으로 복원",
      de: "Auf Standard zurücksetzen",
      fr: "Réinitialiser par défaut",
      es: "Restablecer valores predeterminados",
      pt: "Restaurar padrões",
      ru: "Сбросить настройки",
      it: "Ripristina impostazioni predefinite",
      ar: "إعادة التعيين للافتراضي",
      hi: "डिफ़ॉल्ट पर रीसेट करें",
      nl: "Standaardinstellingen herstellen",
      pl: "Przywróć domyślne",
      sv: "Återställ till standard",
      tr: "Varsayılanlara sıfırla",
      vi: "Đặt lại mặc định",
      th: "รีเซ็ตเป็นค่าเริ่มต้น",
      id: "Reset ke default"
    },
    "shortcutKeys.noResults": {
      en: "No matching shortcuts found",
      ja: "該当するショートカットが見つかりません",
      zh: "未找到匹配的快捷键",
      "zh-TW": "找不到符合的快捷鍵",
      ko: "일치하는 단축키를 찾을 수 없습니다",
      de: "Keine passenden Tastenkombinationen gefunden",
      fr: "Aucun raccourci correspondant trouvé",
      es: "No se encontraron atajos coincidentes",
      pt: "Nenhum atalho correspondente encontrado",
      ru: "Подходящие горячие клавиши не найдены",
      it: "Nessuna scorciatoia corrispondente trovata",
      ar: "لم يتم العثور على اختصارات مطابقة",
      hi: "कोई मिलान शॉर्टकट नहीं मिला",
      nl: "Geen overeenkomende sneltoetsen gevonden",
      pl: "Nie znaleziono pasujących skrótów",
      sv: "Inga matchande kortkommandon hittades",
      tr: "Eşleşen kısayol bulunamadı",
      vi: "Không tìm thấy phím tắt phù hợp",
      th: "ไม่พบปุ่มลัดที่ตรงกัน",
      id: "Tidak ada pintasan yang cocok"
    },
    "shortcutKeys.clickToEdit": {
      en: "Click to edit",
      ja: "クリックして編集",
      zh: "点击编辑",
      "zh-TW": "點擊編輯",
      ko: "클릭하여 편집",
      de: "Klicken zum Bearbeiten",
      fr: "Cliquez pour modifier",
      es: "Haga clic para editar",
      pt: "Clique para editar",
      ru: "Нажмите для редактирования",
      it: "Clicca per modificare",
      ar: "انقر للتحرير",
      hi: "संपादित करने के लिए क्लिक करें",
      nl: "Klik om te bewerken",
      pl: "Kliknij, aby edytować",
      sv: "Klicka för att redigera",
      tr: "Düzenlemek için tıklayın",
      vi: "Nhấp để chỉnh sửa",
      th: "คลิกเพื่อแก้ไข",
      id: "Klik untuk mengedit"
    },
    "shortcutKeys.enterNewKey": {
      en: "Enter new key",
      ja: "新しいキーを入力",
      zh: "输入新的按键",
      "zh-TW": "輸入新的按鍵",
      ko: "새 키 입력",
      de: "Neue Taste eingeben",
      fr: "Entrez une nouvelle touche",
      es: "Ingrese una nueva tecla",
      pt: "Digite uma nova tecla",
      ru: "Введите новую клавишу",
      it: "Inserisci nuovo tasto",
      ar: "أدخل مفتاح جديد",
      hi: "नई कुंजी दर्ज करें",
      nl: "Voer nieuwe toets in",
      pl: "Wprowadź nowy klawisz",
      sv: "Ange ny tangent",
      tr: "Yeni tuş girin",
      vi: "Nhập phím mới",
      th: "ป้อนคีย์ใหม่",
      id: "Masukkan tombol baru"
    },
    "shortcutKeys.shortcutFor": {
      en: "shortcut for",
      ja: "のショートカット",
      zh: "的快捷键",
      "zh-TW": "的快捷鍵",
      ko: "의 단축키",
      de: "Tastenkombination für",
      fr: "raccourci pour",
      es: "atajo para",
      pt: "atalho para",
      ru: "горячая клавиша для",
      it: "scorciatoia per",
      ar: "اختصار لـ",
      hi: "के लिए शॉर्टकट",
      nl: "sneltoets voor",
      pl: "skrót dla",
      sv: "kortkommando för",
      tr: "kısayolu",
      vi: "phím tắt cho",
      th: "ปุ่มลัดสำหรับ",
      id: "pintasan untuk"
    },
    "shortcutKeys.pressKey": {
      en: "Press a key...",
      ja: "キーを押してください...",
      zh: "请按下按键...",
      "zh-TW": "請按下按鍵...",
      ko: "키를 누르세요...",
      de: "Taste drücken...",
      fr: "Appuyez sur une touche...",
      es: "Presione una tecla...",
      pt: "Pressione uma tecla...",
      ru: "Нажмите клавишу...",
      it: "Premi un tasto...",
      ar: "اضغط على مفتاح...",
      hi: "एक कुंजी दबाएं...",
      nl: "Druk op een toets...",
      pl: "Naciśnij klawisz...",
      sv: "Tryck på en tangent...",
      tr: "Bir tuşa basın...",
      vi: "Nhấn một phím...",
      th: "กดคีย์...",
      id: "Tekan tombol..."
    },
    "shortcutKeys.escToCancel": {
      en: "Esc to cancel",
      ja: "Esc でキャンセル",
      zh: "Esc 取消",
      "zh-TW": "Esc 取消",
      ko: "Esc로 취소",
      de: "Esc zum Abbrechen",
      fr: "Échap pour annuler",
      es: "Esc para cancelar",
      pt: "Esc para cancelar",
      ru: "Esc для отмены",
      it: "Esc per annullare",
      ar: "Esc للإلغاء",
      hi: "रद्द करने के लिए Esc",
      nl: "Esc om te annuleren",
      pl: "Esc, aby anulować",
      sv: "Esc för att avbryta",
      tr: "İptal için Esc",
      vi: "Esc để hủy",
      th: "Esc เพื่อยกเลิก",
      id: "Esc untuk membatalkan"
    },
    "shortcutKeys.autoSaved": {
      en: "Auto-saved",
      ja: "自動保存されます",
      zh: "自动保存",
      "zh-TW": "自動儲存",
      ko: "자동 저장됨",
      de: "Automatisch gespeichert",
      fr: "Sauvegarde automatique",
      es: "Guardado automáticamente",
      pt: "Salvo automaticamente",
      ru: "Автосохранение",
      it: "Salvato automaticamente",
      ar: "حفظ تلقائي",
      hi: "स्वचालित रूप से सहेजा गया",
      nl: "Automatisch opgeslagen",
      pl: "Automatycznie zapisano",
      sv: "Sparat automatiskt",
      tr: "Otomatik kaydedildi",
      vi: "Tự động lưu",
      th: "บันทึกอัตโนมัติ",
      id: "Tersimpan otomatis"
    },
    // Welcome Tab - Dev Server
    "welcome.devServer.warning": {
      en: "⚠️ You are viewing the development server (Render).",
      ja: "⚠️ 現在、開発用サーバー（Render）で動作しています。",
      zh: "⚠️ 您正在使用开发服务器（Render）。",
      "zh-TW": "⚠️ 您正在使用開發伺服器（Render）。",
      ko: "⚠️ 개발 서버(Render)를 보고 있습니다.",
      de: "⚠️ Sie sehen den Entwicklungsserver (Render).",
      fr: "⚠️ Vous consultez le serveur de développement (Render).",
      es: "⚠️ Está viendo el servidor de desarrollo (Render).",
      pt: "⚠️ Você está visualizando o servidor de desenvolvimento (Render).",
      ru: "⚠️ Вы просматриваете сервер разработки (Render).",
      it: "⚠️ Stai visualizzando il server di sviluppo (Render).",
      ar: "⚠️ أنت تستعرض خادم التطوير (Render).",
      hi: "⚠️ आप विकास सर्वर (Render) देख रहे हैं।",
      nl: "⚠️ U bekijkt de ontwikkelserver (Render).",
      pl: "⚠️ Przeglądasz serwer deweloperski (Render).",
      sv: "⚠️ Du tittar på utvecklingsservern (Render).",
      tr: "⚠️ Geliştirme sunucusunu (Render) görüntülüyorsunuz.",
      vi: "⚠️ Bạn đang xem máy chủ phát triển (Render).",
      th: "⚠️ คุณกำลังดูเซิร์ฟเวอร์พัฒนา (Render)",
      id: "⚠️ Anda sedang melihat server pengembangan (Render)."
    },
    "welcome.devServer.stableVersion": {
      en: "For a stable experience, please visit",
      ja: "安定版は",
      zh: "如需稳定版本，请访问",
      "zh-TW": "如需穩定版本，請訪問",
      ko: "안정적인 환경을 위해",
      de: "Für eine stabile Version besuchen Sie",
      fr: "Pour une version stable, veuillez visiter",
      es: "Para una experiencia estable, visite",
      pt: "Para uma experiência estável, visite",
      ru: "Для стабильной работы посетите",
      it: "Per un'esperienza stabile, visita",
      ar: "للحصول على تجربة مستقرة، يرجى زيارة",
      hi: "स्थिर अनुभव के लिए, कृपया देखें",
      nl: "Voor een stabiele ervaring, bezoek",
      pl: "Dla stabilnej wersji odwiedź",
      sv: "För en stabil upplevelse, besök",
      tr: "Kararlı bir deneyim için lütfen ziyaret edin",
      vi: "Để có trải nghiệm ổn định, vui lòng truy cập",
      th: "สำหรับประสบการณ์ที่มั่นคง กรุณาเยี่ยมชม",
      id: "Untuk pengalaman yang stabil, silakan kunjungi"
    },
    "welcome.devServer.officialSite": {
      en: "the official site (GitHub Pages)",
      ja: "公式サイト（GitHub Pages）",
      zh: "官方网站（GitHub Pages）",
      "zh-TW": "官方網站（GitHub Pages）",
      ko: "공식 사이트(GitHub Pages)",
      de: "die offizielle Website (GitHub Pages)",
      fr: "le site officiel (GitHub Pages)",
      es: "el sitio oficial (GitHub Pages)",
      pt: "o site oficial (GitHub Pages)",
      ru: "официальный сайт (GitHub Pages)",
      it: "il sito ufficiale (GitHub Pages)",
      ar: "الموقع الرسمي (GitHub Pages)",
      hi: "आधिकारिक साइट (GitHub Pages)",
      nl: "de officiële site (GitHub Pages)",
      pl: "oficjalną stronę (GitHub Pages)",
      sv: "den officiella webbplatsen (GitHub Pages)",
      tr: "resmi siteyi (GitHub Pages)",
      vi: "trang chính thức (GitHub Pages)",
      th: "เว็บไซต์ทางการ (GitHub Pages)",
      id: "situs resmi (GitHub Pages)"
    }
  }
};

// Helper to get value at nested path
function getByPath(obj, path) {
  const parts = path.split('.');
  let cur = obj;
  for (const p of parts) {
    if (cur && typeof cur === 'object' && p in cur) {
      cur = cur[p];
    } else {
      return undefined;
    }
  }
  return cur;
}

// Helper to set value at nested path (with prototype pollution guard)
function setByPath(obj, path, value) {
  const parts = path.split('.');
  let cur = obj;
  for (let i = 0; i < parts.length; i++) {
    const k = parts[i];
    // Guard against prototype pollution
    if (k === '__proto__' || k === 'constructor' || k === 'prototype') {
      return;
    }
    if (i === parts.length - 1) {
      cur[k] = value;
    } else {
      if (!(k in cur) || typeof cur[k] !== 'object' || cur[k] === null) {
        cur[k] = {};
      }
      cur = cur[k];
    }
  }
}

// Process all locales
function processLocales() {
  const locales = fs.readdirSync(LOCALES_DIR).filter(f => {
    const stat = fs.statSync(path.join(LOCALES_DIR, f));
    return stat.isDirectory();
  });

  let totalUpdates = 0;
  
  for (const locale of locales) {
    const commonPath = path.join(LOCALES_DIR, locale, 'common.json');
    if (fs.existsSync(commonPath)) {
      const data = JSON.parse(fs.readFileSync(commonPath, 'utf8'));
      let updates = 0;
      
      for (const key in newTranslations.common) {
        const trans = newTranslations.common[key];
        const val = trans[locale] || trans.en;
        const existing = getByPath(data, key);
        
        if (existing === undefined) {
          setByPath(data, key, val);
          updates++;
        }
      }
      
      if (updates > 0) {
        fs.writeFileSync(commonPath, JSON.stringify(data, null, 2) + '\n', 'utf8');
        console.log('Updated ' + locale + '/common.json with ' + updates + ' new keys');
        totalUpdates += updates;
      }
    }
  }
  
  console.log('\nTotal updates: ' + totalUpdates);
}

processLocales();
