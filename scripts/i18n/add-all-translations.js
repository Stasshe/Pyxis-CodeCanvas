#!/usr/bin/env node
/**
 * add-all-translations.js
 * Comprehensive translation fix script that adds all missing translations
 */

const fs = require('fs');
const path = require('path');

const LOCALES_DIR = path.join(__dirname, '../../locales');

// Translation data for all missing keys across all locales
const translations = {
  // Keys that need translation in common.json
  common: {
    "gitHistory.allFiles": {
      en: "All {count} files",
      ja: "全{count}ファイル",
      zh: "全部 {count} 个文件",
      "zh-TW": "全部 {count} 個檔案",
      ko: "전체 {count} 파일",
      de: "Alle {count} Dateien",
      fr: "Tous les {count} fichiers",
      es: "Todos los {count} archivos",
      pt: "Todos {count} arquivos",
      ru: "Все {count} файлов",
      it: "Tutti {count} file",
      ar: "جميع {count} الملفات",
      hi: "सभी {count} फाइलें",
      nl: "Alle {count} bestanden",
      pl: "Wszystkie {count} pliki",
      sv: "Alla {count} filer",
      tr: "Tüm {count} dosya",
      vi: "Tất cả {count} tệp",
      th: "ทั้งหมด {count} ไฟล์",
      id: "Semua {count} file"
    },
    "gitHistory.loadMore": {
      en: "Load more",
      ja: "さらに読み込む",
      zh: "加载更多",
      "zh-TW": "載入更多",
      ko: "더 불러오기",
      de: "Mehr laden",
      fr: "Charger plus",
      es: "Cargar más",
      pt: "Carregar mais",
      ru: "Загрузить ещё",
      it: "Carica altro",
      ar: "تحميل المزيد",
      hi: "और लोड करें",
      nl: "Meer laden",
      pl: "Załaduj więcej",
      sv: "Ladda mer",
      tr: "Daha fazla yükle",
      vi: "Tải thêm",
      th: "โหลดเพิ่มเติม",
      id: "Muat lebih banyak"
    },
    "gitHistory.loadingMore": {
      en: "Loading...",
      ja: "読み込み中...",
      zh: "加载中...",
      "zh-TW": "載入中...",
      ko: "로딩 중...",
      de: "Laden...",
      fr: "Chargement...",
      es: "Cargando...",
      pt: "Carregando...",
      ru: "Загрузка...",
      it: "Caricamento...",
      ar: "جارٍ التحميل...",
      hi: "लोड हो रहा है...",
      nl: "Laden...",
      pl: "Ładowanie...",
      sv: "Laddar...",
      tr: "Yükleniyor...",
      vi: "Đang tải...",
      th: "กำลังโหลด...",
      id: "Memuat..."
    },
    "paneNavigator.activate": {
      en: "Activate",
      ja: "選択",
      zh: "激活",
      "zh-TW": "啟用",
      ko: "활성화",
      de: "Aktivieren",
      fr: "Activer",
      es: "Activar",
      pt: "Ativar",
      ru: "Активировать",
      it: "Attiva",
      ar: "تفعيل",
      hi: "सक्रिय करें",
      nl: "Activeren",
      pl: "Aktywuj",
      sv: "Aktivera",
      tr: "Etkinleştir",
      vi: "Kích hoạt",
      th: "เปิดใช้งาน",
      id: "Aktifkan"
    },
    "paneNavigator.close": {
      en: "Close",
      ja: "閉じる",
      zh: "关闭",
      "zh-TW": "關閉",
      ko: "닫기",
      de: "Schließen",
      fr: "Fermer",
      es: "Cerrar",
      pt: "Fechar",
      ru: "Закрыть",
      it: "Chiudi",
      ar: "إغلاق",
      hi: "बंद करें",
      nl: "Sluiten",
      pl: "Zamknij",
      sv: "Stäng",
      tr: "Kapat",
      vi: "Đóng",
      th: "ปิด",
      id: "Tutup"
    },
    "paneNavigator.deletePane": {
      en: "Delete Pane",
      ja: "ペインを削除",
      zh: "删除窗格",
      "zh-TW": "刪除窗格",
      ko: "패인 삭제",
      de: "Bereich löschen",
      fr: "Supprimer le volet",
      es: "Eliminar panel",
      pt: "Excluir painel",
      ru: "Удалить панель",
      it: "Elimina pannello",
      ar: "حذف اللوحة",
      hi: "पेन हटाएं",
      nl: "Paneel verwijderen",
      pl: "Usuń panel",
      sv: "Ta bort panel",
      tr: "Paneli sil",
      vi: "Xóa bảng điều khiển",
      th: "ลบแผงควบคุม",
      id: "Hapus panel"
    },
    "paneNavigator.emptyPane": {
      en: "Empty",
      ja: "空",
      zh: "空",
      "zh-TW": "空",
      ko: "비어 있음",
      de: "Leer",
      fr: "Vide",
      es: "Vacío",
      pt: "Vazio",
      ru: "Пусто",
      it: "Vuoto",
      ar: "فارغ",
      hi: "खाली",
      nl: "Leeg",
      pl: "Pusty",
      sv: "Tom",
      tr: "Boş",
      vi: "Trống",
      th: "ว่าง",
      id: "Kosong"
    },
    "paneNavigator.navigate": {
      en: "Navigate",
      ja: "移動",
      zh: "导航",
      "zh-TW": "導航",
      ko: "탐색",
      de: "Navigieren",
      fr: "Naviguer",
      es: "Navegar",
      pt: "Navegar",
      ru: "Навигация",
      it: "Naviga",
      ar: "تنقل",
      hi: "नेविगेट करें",
      nl: "Navigeren",
      pl: "Nawiguj",
      sv: "Navigera",
      tr: "Gezin",
      vi: "Điều hướng",
      th: "นำทาง",
      id: "Navigasi"
    },
    "paneNavigator.splitHorizontal": {
      en: "Split Horizontal",
      ja: "横に分割",
      zh: "水平拆分",
      "zh-TW": "水平分割",
      ko: "가로 분할",
      de: "Horizontal teilen",
      fr: "Diviser horizontalement",
      es: "Dividir horizontalmente",
      pt: "Dividir horizontalmente",
      ru: "Разделить горизонтально",
      it: "Dividi orizzontalmente",
      ar: "تقسيم أفقي",
      hi: "क्षैतिज विभाजन",
      nl: "Horizontaal splitsen",
      pl: "Podziel poziomo",
      sv: "Dela horisontellt",
      tr: "Yatay böl",
      vi: "Chia ngang",
      th: "แบ่งแนวนอน",
      id: "Bagi horizontal"
    },
    "paneNavigator.splitVertical": {
      en: "Split Vertical",
      ja: "縦に分割",
      zh: "垂直拆分",
      "zh-TW": "垂直分割",
      ko: "세로 분할",
      de: "Vertikal teilen",
      fr: "Diviser verticalement",
      es: "Dividir verticalmente",
      pt: "Dividir verticalmente",
      ru: "Разделить вертикально",
      it: "Dividi verticalmente",
      ar: "تقسيم عمودي",
      hi: "ऊर्ध्वाधर विभाजन",
      nl: "Verticaal splitsen",
      pl: "Podziel pionowo",
      sv: "Dela vertikalt",
      tr: "Dikey böl",
      vi: "Chia dọc",
      th: "แบ่งแนวตั้ง",
      id: "Bagi vertikal"
    },
    "paneNavigator.tab": {
      en: "tab",
      ja: "タブ",
      zh: "标签页",
      "zh-TW": "分頁",
      ko: "탭",
      de: "Tab",
      fr: "onglet",
      es: "pestaña",
      pt: "aba",
      ru: "вкладка",
      it: "scheda",
      ar: "تبويب",
      hi: "टैब",
      nl: "tab",
      pl: "karta",
      sv: "flik",
      tr: "sekme",
      vi: "tab",
      th: "แท็บ",
      id: "tab"
    },
    "paneNavigator.tabs": {
      en: "tabs",
      ja: "タブ",
      zh: "标签页",
      "zh-TW": "分頁",
      ko: "탭",
      de: "Tabs",
      fr: "onglets",
      es: "pestañas",
      pt: "abas",
      ru: "вкладки",
      it: "schede",
      ar: "تبويبات",
      hi: "टैब्स",
      nl: "tabs",
      pl: "karty",
      sv: "flikar",
      tr: "sekmeler",
      vi: "các tab",
      th: "แท็บ",
      id: "tab"
    },
    "paneNavigator.title": {
      en: "Pane Navigator",
      ja: "ペインナビゲーター",
      zh: "窗格导航",
      "zh-TW": "窗格導航器",
      ko: "패인 탐색기",
      de: "Bereich-Navigator",
      fr: "Navigateur de volets",
      es: "Navegador de paneles",
      pt: "Navegador de painéis",
      ru: "Навигатор панелей",
      it: "Navigatore pannelli",
      ar: "متصفح اللوحات",
      hi: "पेन नेविगेटर",
      nl: "Paneelnavigator",
      pl: "Nawigator paneli",
      sv: "Panelnavigator",
      tr: "Panel gezgini",
      vi: "Điều hướng bảng điều khiển",
      th: "ตัวนำทางแผงควบคุม",
      id: "Navigasi panel"
    },
    // Untranslated strings that need translation
    "ai.fileChangeItem.noHandler": {
      en: "No handler available",
      ja: "ハンドラが見つかりません",
      zh: "没有可用的处理程序",
      "zh-TW": "沒有可用的處理程式",
      ko: "사용 가능한 핸들러가 없습니다",
      de: "Kein Handler verfügbar",
      fr: "Aucun gestionnaire disponible",
      es: "No hay controlador disponible",
      pt: "Nenhum manipulador disponível",
      ru: "Обработчик недоступен",
      it: "Nessun gestore disponibile",
      ar: "لا يوجد معالج متاح",
      hi: "कोई हैंडलर उपलब्ध नहीं है",
      nl: "Geen handler beschikbaar",
      pl: "Brak dostępnego handlera",
      sv: "Ingen hanterare tillgänglig",
      tr: "İşleyici mevcut değil",
      vi: "Không có trình xử lý",
      th: "ไม่มีตัวจัดการ",
      id: "Tidak ada handler"
    },
    "ai.fileContextBar.remove": {
      en: "Remove",
      ja: "削除",
      zh: "移除",
      "zh-TW": "移除",
      ko: "제거",
      de: "Entfernen",
      fr: "Supprimer",
      es: "Eliminar",
      pt: "Remover",
      ru: "Удалить",
      it: "Rimuovi",
      ar: "إزالة",
      hi: "हटाएं",
      nl: "Verwijderen",
      pl: "Usuń",
      sv: "Ta bort",
      tr: "Kaldır",
      vi: "Xóa",
      th: "ลบ",
      id: "Hapus"
    },
    "AI.ask": {
      en: "Ask the AI questions or consult about code...",
      ja: "AIに質問やコード相談をしてください...",
      zh: "向 AI 提问或咨询代码...",
      "zh-TW": "向 AI 詢問問題或諮詢程式碼...",
      ko: "AI에게 질문하거나 코드 상담을 하세요...",
      de: "Stellen Sie der KI Fragen oder konsultieren Sie Code...",
      fr: "Posez des questions à l'IA ou demandez des conseils sur le code...",
      es: "Pregunte al asistente AI o consulte sobre código...",
      pt: "Pergunte à IA ou consulte sobre código...",
      ru: "Задайте ИИ вопросы или проконсультируйтесь по коду...",
      it: "Fai domande all'IA o consulta il codice...",
      ar: "اسأل الذكاء الاصطناعي أو استشر حول الشيفرة...",
      hi: "AI से प्रश्न पूछें या कोड के बारे में परामर्श लें...",
      nl: "Stel de AI vragen of vraag om advies over code...",
      pl: "Zadaj AI pytanie lub skonsultuj kod...",
      sv: "Ställ AI frågor eller be om hjälp med kod...",
      tr: "Yapay zekaya soru sorun veya kod hakkında danışın...",
      vi: "Hỏi AI các câu hỏi hoặc tư vấn về mã...",
      th: "ถาม AI หรือปรึกษาเกี่ยวกับโค้ด...",
      id: "Tanyakan kepada AI atau konsultasikan tentang kode..."
    },
    "AI.edit": {
      en: "Enter instructions to edit code...",
      ja: "コードの編集指示を入力してください...",
      zh: "输入指示以编辑代码...",
      "zh-TW": "輸入編輯程式碼的指示...",
      ko: "코드 수정을 위한 지시를 입력하세요...",
      de: "Geben Sie Anweisungen zum Bearbeiten des Codes ein...",
      fr: "Saisissez les instructions pour modifier le code...",
      es: "Introduzca instrucciones para editar el código...",
      pt: "Digite instruções para editar o código...",
      ru: "Введите инструкции для редактирования кода...",
      it: "Inserisci istruzioni per modificare il codice...",
      ar: "أدخل تعليمات لتحرير الشيفرة...",
      hi: "कोड संपादित करने के निर्देश दर्ज करें...",
      nl: "Voer instructies in om code te bewerken...",
      pl: "Wprowadź instrukcje do edycji kodu...",
      sv: "Ange instruktioner för att redigera kod...",
      tr: "Kod düzenleme talimatlarını girin...",
      vi: "Nhập hướng dẫn để chỉnh sửa mã...",
      th: "ใส่คำสั่งเพื่อแก้ไขโค้ด...",
      id: "Masukkan instruksi untuk mengedit kode..."
    },
    "bottom.problems": {
      en: "Problems",
      ja: "問題",
      zh: "问题",
      "zh-TW": "問題",
      ko: "문제",
      de: "Probleme",
      fr: "Problèmes",
      es: "Problemas",
      pt: "Problemas",
      ru: "Проблемы",
      it: "Problemi",
      ar: "المشاكل",
      hi: "समस्याएं",
      nl: "Problemen",
      pl: "Problemy",
      sv: "Problem",
      tr: "Sorunlar",
      vi: "Sự cố",
      th: "ปัญหา",
      id: "Masalah"
    },
    "chatSpaceList.title": {
      en: "Chat spaces",
      ja: "チャットスペース",
      zh: "聊天空间",
      "zh-TW": "聊天空間",
      ko: "채팅 공간",
      de: "Chat-Bereiche",
      fr: "Espaces de chat",
      es: "Espacios de chat",
      pt: "Espaços de chat",
      ru: "Чат-пространства",
      it: "Spazi chat",
      ar: "مساحات الدردشة",
      hi: "चैट स्पेस",
      nl: "Chatruimtes",
      pl: "Przestrzenie czatu",
      sv: "Chattutrymmen",
      tr: "Sohbet alanları",
      vi: "Không gian trò chuyện",
      th: "พื้นที่แชท",
      id: "Ruang obrolan"
    },
    "diffTab.binaryFile": {
      en: "Binary file: cannot display diff",
      ja: "バイナリファイル：差分を表示できません",
      zh: "二进制文件：无法显示差异",
      "zh-TW": "二進位檔案：無法顯示差異",
      ko: "바이너리 파일: diff 표시 불가",
      de: "Binärdatei: Diff kann nicht angezeigt werden",
      fr: "Fichier binaire : impossible d'afficher le diff",
      es: "Archivo binario: no se puede mostrar el diff",
      pt: "Arquivo binário: não é possível exibir diff",
      ru: "Бинарный файл: невозможно отобразить различия",
      it: "File binario: impossibile mostrare il diff",
      ar: "ملف ثنائي: لا يمكن عرض الفرق",
      hi: "बाइनरी फाइल: diff प्रदर्शित नहीं हो सकता",
      nl: "Binair bestand: diff kan niet worden weergegeven",
      pl: "Plik binarny: nie można wyświetlić różnic",
      sv: "Binärfil: kan inte visa diff",
      tr: "İkili dosya: diff görüntülenemiyor",
      vi: "Tệp nhị phân: không thể hiển thị diff",
      th: "ไฟล์ไบนารี: ไม่สามารถแสดงความแตกต่างได้",
      id: "File biner: tidak dapat menampilkan diff"
    },
    "fileTree.menu.importFiles": {
      en: "Import files",
      ja: "ファイルをインポート",
      zh: "导入文件",
      "zh-TW": "匯入檔案",
      ko: "파일 가져오기",
      de: "Dateien importieren",
      fr: "Importer des fichiers",
      es: "Importar archivos",
      pt: "Importar arquivos",
      ru: "Импортировать файлы",
      it: "Importa file",
      ar: "استيراد الملفات",
      hi: "फाइलें आयात करें",
      nl: "Bestanden importeren",
      pl: "Importuj pliki",
      sv: "Importera filer",
      tr: "Dosyaları içe aktar",
      vi: "Nhập tệp",
      th: "นำเข้าไฟล์",
      id: "Impor file"
    },
    "fileTree.menu.importFolder": {
      en: "Import folder",
      ja: "フォルダをインポート",
      zh: "导入文件夹",
      "zh-TW": "匯入資料夾",
      ko: "폴더 가져오기",
      de: "Ordner importieren",
      fr: "Importer un dossier",
      es: "Importar carpeta",
      pt: "Importar pasta",
      ru: "Импортировать папку",
      it: "Importa cartella",
      ar: "استيراد المجلد",
      hi: "फ़ोल्डर आयात करें",
      nl: "Map importeren",
      pl: "Importuj folder",
      sv: "Importera mapp",
      tr: "Klasörü içe aktar",
      vi: "Nhập thư mục",
      th: "นำเข้าโฟลเดอร์",
      id: "Impor folder"
    },
    "menu.extensions": {
      en: "Extensions",
      ja: "拡張機能",
      zh: "扩展",
      "zh-TW": "擴充功能",
      ko: "확장",
      de: "Erweiterungen",
      fr: "Extensions",
      es: "Extensiones",
      pt: "Extensões",
      ru: "Расширения",
      it: "Estensioni",
      ar: "الإضافات",
      hi: "एक्सटेंशन",
      nl: "Extensies",
      pl: "Rozszerzenia",
      sv: "Tillägg",
      tr: "Uzantılar",
      vi: "Tiện ích mở rộng",
      th: "ส่วนขยาย",
      id: "Ekstensi"
    },
    "operationWindow.noItemsFound": {
      en: "No items found",
      ja: "項目が見つかりません",
      zh: "未找到项目",
      "zh-TW": "找不到項目",
      ko: "항목을 찾을 수 없습니다",
      de: "Keine Einträge gefunden",
      fr: "Aucun élément trouvé",
      es: "No se encontraron elementos",
      pt: "Nenhum item encontrado",
      ru: "Элементы не найдены",
      it: "Nessun elemento trovato",
      ar: "لم يتم العثور على عناصر",
      hi: "कोई आइटम नहीं मिला",
      nl: "Geen items gevonden",
      pl: "Nie znaleziono elementów",
      sv: "Inga objekt hittades",
      tr: "Öğe bulunamadı",
      vi: "Không tìm thấy mục nào",
      th: "ไม่พบรายการ",
      id: "Tidak ada item yang ditemukan"
    },
    "operationWindow.quickOpen": {
      en: "Quick open",
      ja: "クイックオープン",
      zh: "快速打开",
      "zh-TW": "快速開啟",
      ko: "빠른 열기",
      de: "Schnell öffnen",
      fr: "Ouverture rapide",
      es: "Apertura rápida",
      pt: "Abertura rápida",
      ru: "Быстрое открытие",
      it: "Apertura rapida",
      ar: "فتح سريع",
      hi: "त्वरित खोलें",
      nl: "Snel openen",
      pl: "Szybkie otwieranie",
      sv: "Snabböppna",
      tr: "Hızlı aç",
      vi: "Mở nhanh",
      th: "เปิดด่วน",
      id: "Buka cepat"
    },
    "settingsPanel.editor.preloadModelCount": {
      en: "Number of models to preload",
      ja: "事前読み込みするモデル数",
      zh: "预加载模型数量",
      "zh-TW": "預載模型數量",
      ko: "미리 로드할 모델 수",
      de: "Anzahl der vorzuladenden Modelle",
      fr: "Nombre de modèles à précharger",
      es: "Número de modelos a precargar",
      pt: "Número de modelos para pré-carregar",
      ru: "Количество моделей для предзагрузки",
      it: "Numero di modelli da precaricare",
      ar: "عدد النماذج للتحميل المسبق",
      hi: "प्री-लोड करने के लिए मॉडल की संख्या",
      nl: "Aantal modellen om vooraf te laden",
      pl: "Liczba modeli do wstępnego załadowania",
      sv: "Antal modeller att förladda",
      tr: "Önceden yüklenecek model sayısı",
      vi: "Số lượng mô hình tải trước",
      th: "จำนวนโมเดลที่จะโหลดล่วงหน้า",
      id: "Jumlah model untuk dimuat sebelumnya"
    },
    "settingsPanel.editor.preloadModelCountHint": {
      en: "How many models to keep preloaded for faster startup",
      ja: "起動を高速化するために事前に読み込んでおくモデルの数",
      zh: "为加快启动速度，预加载多少个模型",
      "zh-TW": "為加快啟動速度，預載多少個模型",
      ko: "더 빠른 시작을 위해 미리 로드할 모델 수",
      de: "Wie viele Modelle vorab geladen werden sollen, um den Start zu beschleunigen",
      fr: "Nombre de modèles à garder préchargés pour un démarrage plus rapide",
      es: "Cuántos modelos precargar para un inicio más rápido",
      pt: "Quantos modelos manter pré-carregados para início mais rápido",
      ru: "Сколько моделей держать предзагруженными для быстрого запуска",
      it: "Quanti modelli tenere precaricati per un avvio più rapido",
      ar: "كم عدد النماذج للتحميل المسبق لبدء أسرع",
      hi: "तेज़ स्टार्टअप के लिए कितने मॉडल प्री-लोड रखें",
      nl: "Hoeveel modellen vooraf geladen moeten blijven voor snellere start",
      pl: "Ile modeli utrzymywać wstępnie załadowanych dla szybszego startu",
      sv: "Hur många modeller att hålla förladdade för snabbare start",
      tr: "Daha hızlı başlangıç için kaç model önceden yüklensin",
      vi: "Số lượng mô hình giữ sẵn để khởi động nhanh hơn",
      th: "จำนวนโมเดลที่จะโหลดไว้ล่วงหน้าเพื่อเริ่มต้นเร็วขึ้น",
      id: "Berapa model untuk dimuat sebelumnya agar startup lebih cepat"
    },
    "settingsPanel.markdown.mathDelimiter": {
      en: "Math delimiter",
      ja: "数式区切り記号",
      zh: "数学分隔符",
      "zh-TW": "數學分隔符",
      ko: "수학 구분 기호",
      de: "Mathe-Trennzeichen",
      fr: "Délimiteur mathématique",
      es: "Delimitador matemático",
      pt: "Delimitador matemático",
      ru: "Разделитель формул",
      it: "Delimitatore matematico",
      ar: "فاصل الرياضيات",
      hi: "गणित विभाजक",
      nl: "Scheidingsteken voor wiskunde",
      pl: "Separator matematyczny",
      sv: "Matematisk avgränsare",
      tr: "Matematik ayırıcı",
      vi: "Dấu phân cách toán",
      th: "ตัวคั่นคณิตศาสตร์",
      id: "Pemisah matematika"
    },
    "settingsPanel.markdown.mathDelimiterHint": {
      en: "Delimiter used for inline and block math (e.g. $ $ or $$ $$)",
      ja: "インライン/ブロック数式に使う区切り記号（例: $ $ や $$ $$）",
      zh: "用于行内和块数学的分隔符（例如 $ $ 或 $$ $$）",
      "zh-TW": "用於行內和區塊數學的分隔符（例如 $ $ 或 $$ $$）",
      ko: "인라인 및 블록 수식에 사용되는 구분 기호 (예: $ $ 또는 $$ $$)",
      de: "Trennzeichen für Inline- und Block-Mathematik (z. B. $ $ oder $$ $$)",
      fr: "Délimiteur utilisé pour les mathématiques en ligne et en bloc (ex : $ $ ou $$ $$)",
      es: "Delimitador usado para matemáticas inline y en bloque (ej: $ $ o $$ $$)",
      pt: "Delimitador usado para matemática inline e em bloco (ex: $ $ ou $$ $$)",
      ru: "Разделитель для встроенных и блочных формул (например, $ $ или $$ $$)",
      it: "Delimitatore usato per la matematica inline e a blocchi (es. $ $ o $$ $$)",
      ar: "الفاصل المستخدم للرياضيات المضمنة والكتلة (مثل $ $ أو $$ $$)",
      hi: "इनलाइन और ब्लॉक गणित के लिए उपयोग किया जाने वाला विभाजक (जैसे $ $ या $$ $$)",
      nl: "Scheidingsteken gebruikt voor inline en blok wiskunde (bijv. $ $ of $$ $$)",
      pl: "Separator używany dla matematyki wbudowanej i blokowej (np. $ $ lub $$ $$)",
      sv: "Avgränsare för inline- och blockmatematik (t.ex. $ $ eller $$ $$)",
      tr: "Satır içi ve blok matematik için kullanılan ayırıcı (örn. $ $ veya $$ $$)",
      vi: "Dấu phân cách cho toán inline và khối (vd: $ $ hoặc $$ $$)",
      th: "ตัวคั่นสำหรับคณิตศาสตร์แบบอินไลน์และบล็อก (เช่น $ $ หรือ $$ $$)",
      id: "Pemisah untuk matematika inline dan blok (mis. $ $ atau $$ $$)"
    },
    "tabBar.openPreview": {
      en: "Open Preview",
      ja: "プレビューを開く",
      zh: "打开预览",
      "zh-TW": "開啟預覽",
      ko: "미리보기 열기",
      de: "Vorschau öffnen",
      fr: "Ouvrir l'aperçu",
      es: "Abrir vista previa",
      pt: "Abrir visualização",
      ru: "Открыть предпросмотр",
      it: "Apri anteprima",
      ar: "فتح المعاينة",
      hi: "पूर्वावलोकन खोलें",
      nl: "Voorbeeld openen",
      pl: "Otwórz podgląd",
      sv: "Öppna förhandsvisning",
      tr: "Önizlemeyi aç",
      vi: "Mở xem trước",
      th: "เปิดตัวอย่าง",
      id: "Buka pratinjau"
    },
    "tabBar.unsavedChanges": {
      en: "Unsaved changes",
      ja: "未保存の変更",
      zh: "未保存的更改",
      "zh-TW": "未儲存的變更",
      ko: "저장되지 않은 변경사항",
      de: "Ungespeicherte Änderungen",
      fr: "Modifications non enregistrées",
      es: "Cambios sin guardar",
      pt: "Alterações não salvas",
      ru: "Несохранённые изменения",
      it: "Modifiche non salvate",
      ar: "تغييرات غير محفوظة",
      hi: "असहेजे गए परिवर्तन",
      nl: "Niet-opgeslagen wijzigingen",
      pl: "Niezapisane zmiany",
      sv: "Osparade ändringar",
      tr: "Kaydedilmemiş değişiklikler",
      vi: "Thay đổi chưa lưu",
      th: "การเปลี่ยนแปลงที่ยังไม่ได้บันทึก",
      id: "Perubahan belum disimpan"
    }
  },
  // Keys that need translation in welcome.json
  welcome: {
    "welcome.githubNote": {
      en: "GitHub integration has no known bugs to our knowledge, but avoid extreme actions such as using it on very large repositories or closing the browser mid-operation.",
      ja: "GitHubとの連携は、現状で既知のバグは確認されていませんが、中規模以上のリポジトリや、途中でブラウザを閉じる等の無茶な操作は避けてください。",
      zh: "据我们所知，GitHub 集成没有已知的错误，但请避免在非常大的仓库上使用或在操作过程中关闭浏览器等极端操作。",
      "zh-TW": "據我們所知，GitHub 整合沒有已知的錯誤，但請避免在非常大的倉庫上使用或在操作過程中關閉瀏覽器等極端操作。",
      ko: "GitHub 연동에 알려진 버그는 없지만, 매우 큰 저장소에서 사용하거나 작업 중 브라우저를 닫는 등의 극단적인 행동은 피하십시오.",
      de: "Nach unserem Kenntnisstand sind für die GitHub-Integration keine bekannten Fehler vorhanden. Vermeiden Sie jedoch extreme Aktionen, z. B. die Nutzung in sehr großen Repositories oder das Schließen des Browsers während eines laufenden Vorgangs.",
      fr: "À notre connaissance, l'intégration GitHub ne présente pas de bogues connus. Évitez toutefois les actions extrêmes, comme l'utilisation sur des dépôts très volumineux ou la fermeture du navigateur en cours d'opération.",
      es: "Según nuestro conocimiento, la integración con GitHub no presenta errores conocidos. Evite sin embargo acciones extremas, como usarla en repositorios muy grandes o cerrar el navegador durante una operación en curso.",
      pt: "Até onde sabemos, a integração com GitHub não possui bugs conhecidos, mas evite ações extremas como usá-la em repositórios muito grandes ou fechar o navegador durante uma operação.",
      ru: "Насколько нам известно, интеграция с GitHub не имеет известных ошибок, но избегайте экстремальных действий, таких как использование в очень больших репозиториях или закрытие браузера во время операции.",
      it: "Per quanto ne sappiamo, l'integrazione con GitHub non presenta bug noti, ma evita azioni estreme come usarla su repository molto grandi o chiudere il browser durante un'operazione.",
      ar: "حسب علمنا، لا توجد أخطاء معروفة في تكامل GitHub، لكن تجنب الإجراءات المتطرفة مثل استخدامه على مستودعات كبيرة جدًا أو إغلاق المتصفح أثناء العملية.",
      hi: "जहाँ तक हम जानते हैं, GitHub एकीकरण में कोई ज्ञात बग नहीं है, लेकिन बहुत बड़े रिपॉजिटरी पर उपयोग करने या ऑपरेशन के दौरान ब्राउज़र बंद करने जैसी चरम क्रियाओं से बचें।",
      nl: "Voor zover wij weten bevat de GitHub-integratie geen bekende bugs, maar vermijd extreme acties zoals het gebruiken op zeer grote repositories of het sluiten van de browser tijdens een bewerking.",
      pl: "O ile nam wiadomo, integracja z GitHub nie ma znanych błędów, ale unikaj ekstremalnych działań, takich jak używanie jej na bardzo dużych repozytoriach lub zamykanie przeglądarki w trakcie operacji.",
      sv: "Så vitt vi vet har GitHub-integrationen inga kända buggar, men undvik extrema åtgärder som att använda den på mycket stora repositories eller stänga webbläsaren mitt i en operation.",
      tr: "Bildiğimiz kadarıyla GitHub entegrasyonunda bilinen bir hata yok, ancak çok büyük depolarda kullanmak veya işlem sırasında tarayıcıyı kapatmak gibi aşırı eylemlerden kaçının.",
      vi: "Theo hiểu biết của chúng tôi, tích hợp GitHub không có lỗi đã biết, nhưng tránh các hành động cực đoan như sử dụng trên kho lưu trữ rất lớn hoặc đóng trình duyệt giữa chừng.",
      th: "เท่าที่เราทราบ การเชื่อมต่อ GitHub ไม่มีข้อบกพร่องที่ทราบ แต่หลีกเลี่ยงการกระทำที่รุนแรง เช่น การใช้กับ repository ขนาดใหญ่มากหรือปิดเบราว์เซอร์ระหว่างการดำเนินการ",
      id: "Sejauh yang kami ketahui, integrasi GitHub tidak memiliki bug yang diketahui, tetapi hindari tindakan ekstrem seperti menggunakannya di repositori yang sangat besar atau menutup browser di tengah operasi."
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
    // Process common.json
    const commonPath = path.join(LOCALES_DIR, locale, 'common.json');
    if (fs.existsSync(commonPath)) {
      const data = JSON.parse(fs.readFileSync(commonPath, 'utf8'));
      let updates = 0;
      
      for (const key in translations.common) {
        const trans = translations.common[key];
        const val = trans[locale] || trans.en; // fallback to English if locale not found
        const existing = getByPath(data, key);
        
        // Only update if key doesn't exist or value is same as English (untranslated)
        if (existing === undefined || existing === trans.en) {
          setByPath(data, key, val);
          updates++;
        }
      }
      
      if (updates > 0) {
        fs.writeFileSync(commonPath, JSON.stringify(data, null, 2) + '\n', 'utf8');
        console.log(`Updated ${locale}/common.json with ${updates} translations`);
        totalUpdates += updates;
      }
    }
    
    // Process welcome.json
    const welcomePath = path.join(LOCALES_DIR, locale, 'welcome.json');
    if (fs.existsSync(welcomePath)) {
      const data = JSON.parse(fs.readFileSync(welcomePath, 'utf8'));
      let updates = 0;
      
      for (const key in translations.welcome) {
        const trans = translations.welcome[key];
        const val = trans[locale] || trans.en;
        const existing = getByPath(data, key);
        
        if (existing === undefined || existing === trans.en) {
          setByPath(data, key, val);
          updates++;
        }
      }
      
      if (updates > 0) {
        fs.writeFileSync(welcomePath, JSON.stringify(data, null, 2) + '\n', 'utf8');
        console.log(`Updated ${locale}/welcome.json with ${updates} translations`);
        totalUpdates += updates;
      }
    }
  }
  
  console.log(`\nTotal updates: ${totalUpdates}`);
}

processLocales();
