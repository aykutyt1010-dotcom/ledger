/**
 * Ledger — Veritabanı ve İş Mantığı Motoru (db.js)
 * IndexedDB tabanlı, ACID uyumlu, %100 çevrimdışı çalışan finansal motor.
 */

const DB_NAME = 'LedgerDB';
const DB_VERSION = 1;

let dbInstance = null;
let initPromise = null;

/**
 * IndexedDB bağlantısını başlatır (Singleton)
 */
function initDB() {
    if (dbInstance) return Promise.resolve(dbInstance);
    if (initPromise) return initPromise;

    initPromise = new Promise((resolve, reject) => {
        if (!window.indexedDB) {
            console.error('IndexedDB bu tarayıcıda desteklenmiyor.');
            return reject(new Error('IndexedDB desteklenmiyor'));
        }

        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onerror = (event) => {
            console.error('Veritabanı açılamadı:', event.target.error);
            initPromise = null;
            reject(event.target.error);
        };

        request.onsuccess = (event) => {
            dbInstance = event.target.result;
            // Arka planda yetim kayıtları temizle (asenkron & güvenli)
            setTimeout(() => {
                yetimHareketleriTemizle().catch((e) => console.warn('Yetim temizleme uyarısı:', e));
            }, 1000);
            resolve(dbInstance);
        };

        request.onupgradeneeded = (event) => {
            const db = event.target.result;

            // 1. Müşteriler Tablosu
            if (!db.objectStoreNames.contains('musteriler')) {
                const musteriStore = db.createObjectStore('musteriler', { keyPath: 'id', autoIncrement: true });
                musteriStore.createIndex('ad_index', 'ad', { unique: false });
                musteriStore.createIndex('olusturmaTarihi_index', 'olusturmaTarihi', { unique: false });
            }

            // 2. Hareketler (İşlemler) Tablosu
            if (!db.objectStoreNames.contains('hareketler')) {
                const hareketStore = db.createObjectStore('hareketler', { keyPath: 'id', autoIncrement: true });
                hareketStore.createIndex('musteriId_index', 'musteriId', { unique: false });
                hareketStore.createIndex('tarih_index', 'tarih', { unique: false });
                hareketStore.createIndex('tip_index', 'tip', { unique: false });
            }
        };
    });

    return initPromise;
}

// --- PARA FORMATLAMA & HESAPLAMA (KURUŞ ESASLI TAM HASSASİYET) --- //

/**
 * Sayı veya string tutarı kuruşa (tam sayı integer) çevirir.
 * "12.50", "12,50", "1.250,50", 1250 hepsi doğru işlenir.
 */
function tlToKurus(tlAmount) {
    if (tlAmount === null || tlAmount === undefined || tlAmount === '') return 0;
    if (typeof tlAmount === 'number') {
        if (isNaN(tlAmount)) return 0;
        return Math.round(tlAmount * 100);
    }
    if (typeof tlAmount === 'string') {
        let str = tlAmount.trim();
        if (!str) return 0;
        // Hem nokta hem virgül varsa (Örn: 1.250,50 veya 1,250.50)
        if (str.includes('.') && str.includes(',')) {
            if (str.lastIndexOf(',') > str.lastIndexOf('.')) {
                // Türkçe format: 1.250,50 -> noktayı kaldır, virgülü nokta yap
                str = str.replace(/\./g, '').replace(',', '.');
            } else {
                // İngilizce format: 1,250.50 -> virgülü kaldır
                str = str.replace(/,/g, '');
            }
        } else if (str.includes(',')) {
            // Sadece virgül var: 12,50 -> 12.50
            str = str.replace(',', '.');
        } else if ((str.match(/\./g) || []).length > 1) {
            // Birden fazla nokta var (binlik ayırıcı): 1.500.000
            str = str.replace(/\./g, '');
        }
        const parsed = parseFloat(str);
        return isNaN(parsed) ? 0 : Math.round(parsed * 100);
    }
    return 0;
}

function kurusToTL(kurusAmount) {
    if (!kurusAmount || isNaN(kurusAmount)) return 0;
    return kurusAmount / 100;
}

function formatCurrency(kurusAmount) {
    const kurus = (kurusAmount === null || kurusAmount === undefined || isNaN(kurusAmount)) ? 0 : kurusAmount;
    return new Intl.NumberFormat('tr-TR', {
        style: 'currency',
        currency: 'TRY',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    }).format(kurus / 100);
}

function formatNumberTR(kurusAmount) {
    const kurus = (kurusAmount === null || kurusAmount === undefined || isNaN(kurusAmount)) ? 0 : kurusAmount;
    return new Intl.NumberFormat('tr-TR', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    }).format(kurus / 100);
}

// --- GÜVENLİK & TÜRKÇE DİL NORMALİZASYONU --- //

function escapeHtml(str) {
    if (!str && str !== 0) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

/**
 * Türkçe karakter duyarsız arama normalleştiricisi.
 * iPhone klavyesinden İ, ı, Ş, ş, Ç, ç yazılsa da aramayı kusursuz eşleştirir.
 */
function turkishNormalize(text) {
    if (!text && text !== 0) return '';
    return String(text)
        .toLocaleLowerCase('tr-TR')
        .replace(/ı/g, 'i')
        .replace(/ğ/g, 'g')
        .replace(/ü/g, 'u')
        .replace(/ş/g, 's')
        .replace(/ö/g, 'o')
        .replace(/ç/g, 'c')
        .replace(/[^a-z0-9]/g, '')
        .trim();
}

function getInitials(name) {
    if (!name || typeof name !== 'string') return '--';
    const parts = name.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return '--';
    if (parts.length === 1) {
        return parts[0].substring(0, 2).toLocaleUpperCase('tr-TR');
    }
    return (parts[0][0] + (parts[parts.length - 1][0] || '')).toLocaleUpperCase('tr-TR');
}

/**
 * Telefon numarasını Türkiye standartlarına göre okunaklı formatlar
 * "05321234567" -> "0532 123 45 67"
 */
function formatPhoneTR(phone) {
    if (!phone) return '';
    const digits = String(phone).replace(/\D/g, '');
    if (digits.length === 10) {
        return `0${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6, 8)} ${digits.slice(8, 10)}`;
    }
    if (digits.length === 11 && digits.startsWith('0')) {
        return `${digits.slice(0, 4)} ${digits.slice(4, 7)} ${digits.slice(7, 9)} ${digits.slice(9, 11)}`;
    }
    return phone;
}

// --- MÜŞTERİ (CARİ) İŞLEMLERİ --- //

async function musteriEkle(ad, telefon = '', ilkBakiyeTL = 0) {
    if (!ad || !ad.trim()) {
        throw new Error('Müşteri adı boş bırakılamaz.');
    }

    const db = await initDB();
    const musteriId = await new Promise((resolve, reject) => {
        const tx = db.transaction(['musteriler'], 'readwrite');
        const store = tx.objectStore('musteriler');

        const yeniMusteri = {
            ad: ad.trim(),
            telefon: (telefon || '').trim(),
            olusturmaTarihi: new Date().toISOString()
        };

        const req = store.add(yeniMusteri);
        req.onsuccess = () => resolve(req.result);
        req.onerror = (e) => reject(e.target.error);
    });

    // Açılış devir bakiyesi varsa otomatik borç işlemi ekle
    const ilkBakiyeKurus = tlToKurus(ilkBakiyeTL);
    if (ilkBakiyeKurus > 0) {
        await islemEkle(musteriId, 'hizmet', ilkBakiyeKurus / 100, 'Devreden Açılış Bakiyesi', new Date().toISOString());
    }

    return musteriId;
}

async function getMusteriler() {
    const db = await initDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(['musteriler'], 'readonly');
        const store = tx.objectStore('musteriler');
        const req = store.getAll();
        req.onsuccess = () => {
            const list = req.result || [];
            resolve(list);
        };
        req.onerror = (e) => reject(e.target.error);
    });
}

async function getMusteriById(id) {
    if (id === null || id === undefined || isNaN(parseInt(id, 10))) return null;
    const targetId = parseInt(id, 10);
    const db = await initDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(['musteriler'], 'readonly');
        const store = tx.objectStore('musteriler');
        const req = store.get(targetId);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = (e) => reject(e.target.error);
    });
}

async function musteriGuncelle(id, yeniAd, yeniTelefon = '') {
    const musteriId = parseInt(id, 10);
    if (!musteriId || isNaN(musteriId)) throw new Error('Geçersiz müşteri ID');
    if (!yeniAd || !yeniAd.trim()) throw new Error('Müşteri adı boş olamaz.');

    const db = await initDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(['musteriler', 'hareketler'], 'readwrite');
        const mStore = tx.objectStore('musteriler');
        const hStore = tx.objectStore('hareketler');

        const getReq = mStore.get(musteriId);
        getReq.onsuccess = () => {
            const m = getReq.result;
            if (!m) return reject(new Error('Müşteri bulunamadı'));

            m.ad = yeniAd.trim();
            m.telefon = (yeniTelefon || '').trim();
            mStore.put(m);

            // Hareket kayıtlarındaki iliştirilmiş müşteri adını da güncelle
            const hReq = hStore.openCursor();
            hReq.onsuccess = (e) => {
                const cursor = e.target.result;
                if (cursor) {
                    if (parseInt(cursor.value.musteriId, 10) === musteriId) {
                        const h = cursor.value;
                        h.musteriAd = yeniAd.trim();
                        cursor.update(h);
                    }
                    cursor.continue();
                }
            };
        };
        getReq.onerror = (e) => reject(e.target.error);

        tx.oncomplete = () => resolve(true);
        tx.onerror = (e) => reject(e.target.error);
    });
}

async function musteriSil(id) {
    const musteriId = parseInt(id, 10);
    if (!musteriId || isNaN(musteriId)) throw new Error('Geçersiz müşteri ID');

    const db = await initDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(['musteriler', 'hareketler'], 'readwrite');
        const mStore = tx.objectStore('musteriler');
        const hStore = tx.objectStore('hareketler');

        mStore.delete(musteriId);

        // Bu müşteriye ait tüm hareket kayıtlarını temizle
        const hReq = hStore.openCursor();
        hReq.onsuccess = (e) => {
            const cursor = e.target.result;
            if (cursor) {
                if (parseInt(cursor.value.musteriId, 10) === musteriId) {
                    cursor.delete();
                }
                cursor.continue();
            }
        };

        tx.oncomplete = () => resolve(true);
        tx.onerror = (e) => reject(e.target.error);
    });
}

// --- İŞLEM (HAREKET) İŞLEMLERİ --- //

/**
 * İşlem ekler. Parametre sırası toleranslıdır:
 * islemEkle(musteriId, tip, tutarTL, aciklama, tarihStr)
 * VEYA eski kod uyumu için:
 * islemEkle(tip, musteriId, tutarTL, aciklama, tarihStr)
 */
async function islemEkle(arg1, arg2, tutarTL, aciklama = '', tarihStr = null) {
    let musteriId, tip;
    if (typeof arg1 === 'string' && (arg1 === 'hizmet' || arg1 === 'odeme')) {
        tip = arg1;
        musteriId = parseInt(arg2, 10);
    } else {
        musteriId = parseInt(arg1, 10);
        tip = String(arg2 || '').toLowerCase();
    }

    if (!musteriId || isNaN(musteriId)) {
        throw new Error('Geçersiz müşteri seçimi.');
    }
    if (tip !== 'hizmet' && tip !== 'odeme') {
        throw new Error('Geçersiz işlem tipi. Sadece "hizmet" veya "odeme" kabul edilir.');
    }

    const tutarKurus = tlToKurus(tutarTL);
    if (tutarKurus <= 0) {
        throw new Error('Lütfen sıfırdan büyük geçerli bir tutar girin.');
    }

    const musteri = await getMusteriById(musteriId);
    const musteriAd = musteri ? musteri.ad : 'Bilinmeyen Müşteri';

    let islemTarihi;
    try {
        if (tarihStr) {
            if (/^\d{4}-\d{2}-\d{2}$/.test(tarihStr)) {
                // Saat 12:00 verilerek UTC gün kaymaları engellenir
                islemTarihi = new Date(tarihStr + 'T12:00:00').toISOString();
            } else {
                islemTarihi = new Date(tarihStr).toISOString();
            }
        } else {
            islemTarihi = new Date().toISOString();
        }
    } catch (e) {
        islemTarihi = new Date().toISOString();
    }

    const db = await initDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(['hareketler'], 'readwrite');
        const store = tx.objectStore('hareketler');

        const yeniHareket = {
            musteriId: musteriId,
            musteriAd: musteriAd,
            tip: tip, // 'hizmet' (Borç ekleme) | 'odeme' (Tahsilat)
            tutarKurus: tutarKurus,
            tarih: islemTarihi,
            aciklama: (aciklama || '').trim()
        };

        const req = store.add(yeniHareket);
        req.onsuccess = () => resolve(req.result);
        req.onerror = (e) => reject(e.target.error);
    });
}

async function islemSil(id) {
    const islemId = parseInt(id, 10);
    if (!islemId || isNaN(islemId)) throw new Error('Geçersiz işlem ID');

    const db = await initDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(['hareketler'], 'readwrite');
        const store = tx.objectStore('hareketler');
        store.delete(islemId);
        tx.oncomplete = () => resolve(true);
        tx.onerror = (e) => reject(e.target.error);
    });
}

async function getHareketler(musteriId = null) {
    const db = await initDB();
    const targetId = (musteriId !== null && musteriId !== undefined && musteriId !== '' && !isNaN(parseInt(musteriId, 10)))
        ? parseInt(musteriId, 10)
        : null;

    return new Promise((resolve, reject) => {
        const tx = db.transaction(['hareketler'], 'readonly');
        const store = tx.objectStore('hareketler');
        const req = store.getAll();

        req.onsuccess = () => {
            let list = req.result || [];
            if (targetId !== null) {
                list = list.filter((h) => parseInt(h.musteriId, 10) === targetId);
            }
            // Tarihe göre azalan (en yeni en üstte)
            list.sort((a, b) => new Date(b.tarih) - new Date(a.tarih));
            resolve(list);
        };
        req.onerror = (e) => reject(e.target.error);
    });
}

// --- HESAPLAMA VE RAPORLAMA METRİKLERİ --- //

async function getGenelOzet() {
    const musteriler = await getMusteriler();
    const gecerliMusteriIdleri = new Set(musteriler.map((m) => parseInt(m.id, 10)));
    const hareketler = await getHareketler();

    let toplamAlacakKurus = 0; // Toplam Veresiye / Hizmet
    let toplamTahsilatKurus = 0; // Toplam Alınan Ödeme
    let borcluMusteriSayisi = 0;
    let alacakliMusteriSayisi = 0;

    // Müşteri bazlı bakiye hesabı
    const bakiyeMap = {};
    for (const islem of hareketler) {
        const mId = parseInt(islem.musteriId, 10);
        if (!gecerliMusteriIdleri.has(mId)) continue;

        if (bakiyeMap[mId] === undefined) bakiyeMap[mId] = 0;

        if (islem.tip === 'hizmet') {
            toplamAlacakKurus += islem.tutarKurus;
            bakiyeMap[mId] += islem.tutarKurus;
        } else if (islem.tip === 'odeme') {
            toplamTahsilatKurus += islem.tutarKurus;
            bakiyeMap[mId] -= islem.tutarKurus;
        }
    }

    for (const m of musteriler) {
        const b = bakiyeMap[m.id] || 0;
        if (b > 0) borcluMusteriSayisi++;
        else if (b < 0) alacakliMusteriSayisi++;
    }

    return {
        toplamAlacakKurus,
        toplamTahsilatKurus,
        genelBakiyeKurus: toplamAlacakKurus - toplamTahsilatKurus,
        musteriSayisi: musteriler.length,
        islemSayisi: hareketler.length,
        borcluMusteriSayisi,
        alacakliMusteriSayisi
    };
}

async function getMusteriBakiyeleri() {
    const musteriler = await getMusteriler();
    const hareketler = await getHareketler();

    const bakiyeMap = {};
    const sonIslemMap = {};
    const sonOdemeMap = {};
    const islemSayisiMap = {};

    for (const islem of hareketler) {
        const mId = parseInt(islem.musteriId, 10);
        if (isNaN(mId)) continue;

        if (bakiyeMap[mId] === undefined) {
            bakiyeMap[mId] = 0;
            sonIslemMap[mId] = islem.tarih;
            islemSayisiMap[mId] = 0;
        }

        islemSayisiMap[mId]++;

        if (islem.tarih > sonIslemMap[mId]) {
            sonIslemMap[mId] = islem.tarih;
        }

        if (islem.tip === 'hizmet') {
            bakiyeMap[mId] += islem.tutarKurus;
        } else if (islem.tip === 'odeme') {
            bakiyeMap[mId] -= islem.tutarKurus;
            if (!sonOdemeMap[mId] || islem.tarih > sonOdemeMap[mId]) {
                sonOdemeMap[mId] = islem.tarih;
            }
        }
    }

    return musteriler.map((m) => {
        const mId = parseInt(m.id, 10);
        const netBakiyeKurus = bakiyeMap[mId] || 0;
        const sonOdemeTarihi = sonOdemeMap[mId] || null;
        const sonIslemTarihi = sonIslemMap[mId] || m.olusturmaTarihi;
        const islemSayisi = islemSayisiMap[mId] || 0;

        return {
            ...m,
            id: mId,
            netBakiyeKurus,
            sonIslemTarihi,
            sonOdemeTarihi,
            islemSayisi,
            odemeDurumu: hesaplaOdemeDurumu(sonOdemeTarihi, netBakiyeKurus, m.olusturmaTarihi)
        };
    }).sort((a, b) => new Date(b.sonIslemTarihi) - new Date(a.sonIslemTarihi));
}

function hesaplaOdemeDurumu(sonOdemeTarihi, netBakiyeKurus, olusturmaTarihi) {
    if (netBakiyeKurus === 0) {
        return { text: 'Hesap Dengede', status: 'clean', icon: 'check-circle' };
    }
    if (netBakiyeKurus < 0) {
        return { text: 'Alacaklı (Fazla Ödeme)', status: 'surplus', icon: 'wallet' };
    }

    const now = Date.now();
    if (!sonOdemeTarihi) {
        const baseDate = olusturmaTarihi ? new Date(olusturmaTarihi).getTime() : now;
        const diffDays = Math.max(0, Math.floor((now - baseDate) / (1000 * 60 * 60 * 24)));
        const diffMonths = Math.floor(diffDays / 30);

        if (diffMonths >= 1) {
            return { text: `${diffMonths} aydır ödeme yok`, status: 'danger', icon: 'clock' };
        } else if (diffDays > 0) {
            return { text: `${diffDays} gündür ödeme yok`, status: 'warning', icon: 'clock' };
        } else {
            return { text: 'Yeni Kayıt · Henüz ödeme yok', status: 'warning', icon: 'clock' };
        }
    }

    const diffDays = Math.max(0, Math.floor((now - new Date(sonOdemeTarihi).getTime()) / (1000 * 60 * 60 * 24)));
    const diffMonths = Math.floor(diffDays / 30);

    if (diffMonths >= 1) {
        return {
            text: `${diffMonths} aydır ödeme yok`,
            status: diffMonths >= 3 ? 'danger' : 'warning',
            icon: 'clock'
        };
    } else {
        if (diffDays === 0) {
            return { text: 'Bugün ödeme yapıldı', status: 'success', icon: 'check' };
        } else if (diffDays === 1) {
            return { text: 'Dün ödeme yapıldı', status: 'success', icon: 'check' };
        } else {
            return { text: `${diffDays} gün önce ödendi`, status: 'success', icon: 'check' };
        }
    }
}

// --- YEDEKLEME, İÇE/DIŞA AKTARMA VE GÜVENLİK SNAPSHOT'I --- //

async function exportData() {
    const musteriler = await getMusteriler();
    const hareketler = await getHareketler();

    const data = {
        app: 'LedgerDB_Yedek',
        versiyon: 2,
        tarih: new Date().toISOString(),
        musteriler,
        hareketler
    };

    const json = JSON.stringify(data, null, 2);
    const fileName = `ledger_yedek_${new Date().toISOString().split('T')[0]}.json`;

    // iOS Web Share API desteği varsa doğrudan paylaş menüsünü aç
    if (navigator.canShare && navigator.canShare({ files: [new File([json], fileName, { type: 'application/json' })] })) {
        try {
            const file = new File([json], fileName, { type: 'application/json' });
            await navigator.share({
                title: 'Ledger Yedek Dosyası',
                text: `${fileName} yedeği`,
                files: [file]
            });
            return json;
        } catch (shareErr) {
            if (shareErr.name !== 'AbortError') {
                console.warn('Paylaşım penceresi açılamadı, indirmeye geçiliyor:', shareErr);
            } else {
                return json;
            }
        }
    }

    // Geleneksel dosya indirme tetikle
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);

    return json;
}

/**
 * İçe aktarma öncesinde mevcut veritabanının otomatik emniyet yedeğini alır.
 * Eğer içe aktarma sonrasında pişman olunursa veya dosya bozuksa tek tıkla geri dönülür!
 */
async function takeSafetySnapshot() {
    try {
        const musteriler = await getMusteriler();
        const hareketler = await getHareketler();
        const snapshot = {
            tarih: new Date().toISOString(),
            musteriler,
            hareketler
        };
        localStorage.setItem('ledger_safety_snapshot', JSON.stringify(snapshot));
        return true;
    } catch (e) {
        console.warn('Emniyet snapshotu alınamadı:', e);
        return false;
    }
}

async function restoreSafetySnapshot() {
    const raw = localStorage.getItem('ledger_safety_snapshot');
    if (!raw) throw new Error('Kayıtlı emniyet snapshotu bulunamadı.');
    const data = JSON.parse(raw);
    return importData(data, false); // Tekrar snapshot almadan geri yükle
}

async function importData(jsonData, takeSnapshot = true) {
    let parsed;
    try {
        parsed = typeof jsonData === 'string' ? JSON.parse(jsonData) : jsonData;
        if (!parsed || !Array.isArray(parsed.musteriler) || !Array.isArray(parsed.hareketler)) {
            throw new Error('Geçersiz dosya formatı. "musteriler" ve "hareketler" listeleri bulunamadı.');
        }
    } catch (err) {
        throw new Error('Yedek dosyası okunamadı: ' + err.message);
    }

    // 1. Veri silinmeden önce emniyet yedeği al
    if (takeSnapshot) {
        await takeSafetySnapshot();
    }

    const db = await initDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(['musteriler', 'hareketler'], 'readwrite');
        const mStore = tx.objectStore('musteriler');
        const hStore = tx.objectStore('hareketler');

        mStore.clear();
        hStore.clear();

        parsed.musteriler.forEach((m) => mStore.put(m));
        parsed.hareketler.forEach((h) => hStore.put(h));

        tx.oncomplete = () => resolve(true);
        tx.onerror = (e) => reject(e.target.error);
    });
}

async function tumVerileriTemizle() {
    await takeSafetySnapshot(); // Temizlemeden önce de güvenlik snapshot'ı sakla!
    const db = await initDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(['musteriler', 'hareketler'], 'readwrite');
        tx.objectStore('musteriler').clear();
        tx.objectStore('hareketler').clear();
        tx.oncomplete = () => resolve(true);
        tx.onerror = (e) => reject(e.target.error);
    });
}

async function loadSampleData() {
    const musteriler = await getMusteriler();
    if (musteriler.length > 0) {
        throw new Error('Veritabanında zaten kayıtlar bulunuyor.');
    }

    const m1 = await musteriEkle('Ahmet Yılmaz (Marangoz)', '0532 111 22 33');
    const m2 = await musteriEkle('Mehmet Kaya (Demirci)', '0544 222 33 44');
    const m3 = await musteriEkle('Ayşe Demir (Market)', '0555 333 44 55');

    // 10 gün önce
    const gun10 = new Date(Date.now() - 10 * 86400000).toISOString();
    const gun5 = new Date(Date.now() - 5 * 86400000).toISOString();
    const bugun = new Date().toISOString();

    await islemEkle(m1, 'hizmet', 4500, 'Ahşap Malzeme Tedariği', gun10);
    await islemEkle(m1, 'odeme', 1500, 'Kısmi Nakit Ödeme', gun5);

    await islemEkle(m2, 'hizmet', 12500, 'Profil Demir Alımı', gun10);
    await islemEkle(m2, 'hizmet', 3000, 'Kaynak ve İşçilik Bedeli', gun5);

    await islemEkle(m3, 'hizmet', 2400, 'Gıda ve İçecek Siparişi', gun5);
    await islemEkle(m3, 'odeme', 2400, 'Bakiye Kapatma (EFT)', bugun);

    return true;
}

// --- ARKA PLAN VERİ BÜTÜNLÜĞÜ (YETİM KAYIT TEMİZLEME) --- //

async function yetimHareketleriTemizle() {
    if (!dbInstance) return;
    return new Promise((resolve) => {
        try {
            const tx = dbInstance.transaction(['musteriler', 'hareketler'], 'readwrite');
            const mStore = tx.objectStore('musteriler');
            const hStore = tx.objectStore('hareketler');

            const mReq = mStore.getAll();
            mReq.onsuccess = () => {
                const musteriler = mReq.result || [];
                const musteriMap = new Map();
                musteriler.forEach((m) => {
                    if (m && m.id !== undefined) musteriMap.set(parseInt(m.id, 10), m.ad);
                });

                const hReq = hStore.openCursor();
                hReq.onsuccess = (e) => {
                    const cursor = e.target.result;
                    if (cursor) {
                        const h = cursor.value;
                        const mId = parseInt(h.musteriId, 10);
                        if (!mId || isNaN(mId) || !musteriMap.has(mId)) {
                            // Sahipsiz (yetim) hareketi sil
                            cursor.delete();
                        } else if (!h.musteriAd || h.musteriAd !== musteriMap.get(mId)) {
                            // Müşteri adını güncelle
                            h.musteriAd = musteriMap.get(mId);
                            cursor.update(h);
                        }
                        cursor.continue();
                    }
                };
            };

            tx.oncomplete = () => resolve(true);
            tx.onerror = () => resolve(false);
        } catch (err) {
            resolve(false);
        }
    });
}

// Tarih Formatlayıcı Yardımcılar
function formatRelativeDate(isoDateStr) {
    if (!isoDateStr) return '';
    const date = new Date(isoDateStr);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    if (date.toDateString() === today.toDateString()) return 'Bugün';
    if (date.toDateString() === yesterday.toDateString()) return 'Dün';

    return new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'short' }).format(date);
}

function formatFullDateTR(isoDateStr) {
    if (!isoDateStr) return '';
    return new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(isoDateStr));
}
