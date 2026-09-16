/**
 * Ledger - Backend (IndexedDB) Motoru
 * Kanıta Dayalı, Hata Toleranssız Mimarisi
 */

const DB_NAME = 'LedgerDB';
const DB_VERSION = 1;

let dbInstance = null;
let initPromise = null;

// Veritabanını Başlatma (Init) — tek-uçuş (single-flight): aynı anda gelen
// çağrılar tek sözü paylaşır, temizlik bitmeden veri okunmaz.
async function initDB() {
    if (dbInstance) {
        return dbInstance;
    }
    if (initPromise) {
        return initPromise;
    }

    initPromise = new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onerror = (event) => {
            console.error('Veritabanı açılamadı:', event.target.error);
            initPromise = null;
            reject(event.target.error);
        };

        request.onsuccess = async (event) => {
            dbInstance = event.target.result;
            // Yetim ve tutarsız hareket verilerini temizle
            try {
                await yetimHareketleriTemizle();
            } catch (err) {
                console.warn('Yetim temizliği atlandı:', err);
            }
            resolve(dbInstance);
        };

        request.onupgradeneeded = (event) => {
            const db = event.target.result;

            // 1. Müşteriler Tablosu
            if (!db.objectStoreNames.contains('musteriler')) {
                const musteriStore = db.createObjectStore('musteriler', { keyPath: 'id', autoIncrement: true });
                musteriStore.createIndex('ad_index', 'ad', { unique: false });
            }

            // 2. Hareketler (İşlemler) Tablosu
            if (!db.objectStoreNames.contains('hareketler')) {
                const hareketStore = db.createObjectStore('hareketler', { keyPath: 'id', autoIncrement: true });
                hareketStore.createIndex('musteriId_index', 'musteriId', { unique: false });
                hareketStore.createIndex('tarih_index', 'tarih', { unique: false });
            }
        };
    });

    return initPromise;
}

const openDB = initDB;

// file:// + eski tarayıcılarda bile patlamayan güvenli bayrak yazımı
function guvenliBayrakYaz(anahtar, deger) {
    try {
        localStorage.setItem(anahtar, deger);
    } catch (err) {
        // file:// gizli mod / çerez kapalı: bayrak yazılamazsa sessiz geç.
    }
}

function guvenliBayrakOku(anahtar) {
    try {
        return localStorage.getItem(anahtar);
    } catch (err) {
        return null;
    }
}

// --- PARA FORMATLAMA (KURUŞ <-> TL) --- //
function tlToKurus(tlAmount) {
    if(typeof tlAmount === 'string') {
        tlAmount = tlAmount.replace(',', '.');
    }
    return Math.round(parseFloat(tlAmount) * 100);
}

function kurusToTl(kurusAmount) {
    return (kurusAmount / 100).toFixed(2);
}

function formatCurrency(kurusAmount) {
    return new Intl.NumberFormat('tr-TR', { 
        style: 'currency', 
        currency: 'TRY',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    }).format(kurusAmount / 100);
}

// Format without currency symbol for raw numbers display
function formatNumberTR(kurusAmount) {
    return new Intl.NumberFormat('tr-TR', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    }).format(kurusAmount / 100);
}


// --- VERİTABANI İŞLEMLERİ (CRUD) --- //
async function musteriEkle(ad, telefon = "") {
    const db = await initDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(['musteriler'], 'readwrite');
        const store = transaction.objectStore('musteriler');
        
        const yeniMusteri = {
            ad: ad.trim(),
            telefon: telefon.trim(),
            olusturmaTarihi: new Date().toISOString()
        };

        const request = store.add(yeniMusteri);
        request.onsuccess = () => resolve(request.result); 
        request.onerror = (e) => reject(e.target.error);
    });
}

async function getMusteriler() {
    const db = await initDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(['musteriler'], 'readonly');
        const store = transaction.objectStore('musteriler');
        const list = [];
        const request = store.openCursor();
        
        request.onsuccess = (e) => {
            const cursor = e.target.result;
            if (cursor) {
                const val = cursor.value || {};
                val.id = (cursor.key !== undefined && cursor.key !== null) ? cursor.key : val.id;
                list.push(val);
                cursor.continue();
            } else {
                resolve(list);
            }
        };
        request.onerror = (e) => reject(e.target.error);
    });
}

async function getMusteriById(id) {
    if (id === null || id === undefined || isNaN(parseInt(id))) return null;
    const db = await initDB();
    const targetId = parseInt(id, 10);
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(['musteriler'], 'readonly');
        const store = transaction.objectStore('musteriler');
        const request = store.get(targetId);
        
        request.onsuccess = () => {
            let res = request.result;
            if (res) {
                res.id = targetId;
                resolve(res);
            } else {
                // Anahtar eşleşmezse cursor ile ara
                const reqCursor = store.openCursor();
                reqCursor.onsuccess = (e) => {
                    const cursor = e.target.result;
                    if (cursor) {
                        if (cursor.key == targetId || (cursor.value && cursor.value.id == targetId)) {
                            const found = cursor.value || {};
                            found.id = cursor.key;
                            resolve(found);
                            return;
                        }
                        cursor.continue();
                    } else {
                        resolve(null);
                    }
                };
                reqCursor.onerror = () => resolve(null);
            }
        };
        request.onerror = (e) => reject(e.target.error);
    });
}

async function musteriGuncelle(id, yeniAd, yeniTelefon = "") {
    const db = await initDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(['musteriler'], 'readwrite');
        const store = transaction.objectStore('musteriler');
        const getReq = store.get(parseInt(id));
        getReq.onsuccess = () => {
            const m = getReq.result;
            if (!m) return reject(new Error("Müşteri bulunamadı"));
            m.ad = yeniAd.trim();
            if (yeniTelefon !== undefined) m.telefon = (yeniTelefon || "").trim();
            const putReq = store.put(m);
            putReq.onsuccess = () => resolve(putReq.result);
            putReq.onerror = (e) => reject(e.target.error);
        };
        getReq.onerror = (e) => reject(e.target.error);
    });
}

async function musteriSil(id) {
    const db = await initDB();
    const musteriId = parseInt(id);
    guvenliBayrakYaz('ledger_seeded', 'true'); // Tohumlamanın asla tekrar çalışmamasını sağla
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(['musteriler', 'hareketler'], 'readwrite');
        const mStore = transaction.objectStore('musteriler');
        const hStore = transaction.objectStore('hareketler');

        mStore.delete(musteriId);

        // Bu müşteriye ait TÜM hareket kayıtlarını sil
        const req = hStore.openCursor();
        req.onsuccess = (e) => {
            const cursor = e.target.result;
            if (cursor) {
                if (parseInt(cursor.value.musteriId) === musteriId) {
                    cursor.delete();
                }
                cursor.continue();
            }
        };

        transaction.oncomplete = () => resolve(true);
        transaction.onerror = (e) => reject(e.target.error);
    });
}

async function tumVerileriTemizle() {
    const db = await initDB();
    guvenliBayrakYaz('ledger_seeded', 'true');
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(['musteriler', 'hareketler'], 'readwrite');
        const mStore = transaction.objectStore('musteriler');
        const hStore = transaction.objectStore('hareketler');

        mStore.clear();
        hStore.clear();

        transaction.oncomplete = () => resolve(true);
        transaction.onerror = (e) => reject(e.target.error);
    });
}


async function islemSil(id) {
    const db = await initDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(['hareketler'], 'readwrite');
        const store = transaction.objectStore('hareketler');
        const req = store.delete(parseInt(id));
        req.onsuccess = () => resolve(true);
        req.onerror = (e) => reject(e.target.error);
    });
}


async function islemEkle(arg1, arg2, tutarTl, aciklama = '', tarihStr = null) {
    const db = await initDB();
    
    let musteriId, tip;
    if (typeof arg1 === 'string' && (arg1 === 'hizmet' || arg1 === 'odeme')) {
        tip = arg1;
        musteriId = parseInt(arg2, 10);
    } else {
        musteriId = parseInt(arg1, 10);
        tip = arg2;
    }

    if (!musteriId || isNaN(musteriId)) {
        throw new Error('Geçersiz müşteri ID');
    }

    // Müşteri adını doğrudan işlem kaydına iliştir
    const musteri = await getMusteriById(musteriId);
    const musteriAd = musteri ? musteri.ad : '';

    return new Promise((resolve, reject) => {
        try {
            const transaction = db.transaction(['hareketler'], 'readwrite');
            const store = transaction.objectStore('hareketler');

            let islemTarihi;
            try {
                if (tarihStr) {
                    if (/^\d{4}-\d{2}-\d{2}$/.test(tarihStr)) {
                        islemTarihi = new Date(tarihStr + 'T12:00:00').toISOString();
                    } else {
                        islemTarihi = new Date(tarihStr).toISOString();
                    }
                } else {
                    islemTarihi = new Date().toISOString();
                }
            } catch (err) {
                islemTarihi = new Date().toISOString();
            }

            const yeniIslem = {
                musteriId: musteriId,
                musteriAd: musteriAd,
                tip: tip, // 'hizmet' (borç ekleme) | 'odeme' (tahsilat)
                tutarKurus: tlToKurus(tutarTl),
                tarih: islemTarihi,
                aciklama: (aciklama || '').trim()
            };

            const request = store.add(yeniIslem);
            request.onsuccess = () => resolve(request.result);
            request.onerror = (e) => reject(e.target.error);
        } catch (err) {
            reject(err);
        }
    });
}

async function getHareketler(musteriId = null) {
    const db = await initDB();
    return new Promise((resolve, reject) => {
        try {
            const transaction = db.transaction(['hareketler'], 'readonly');
            const store = transaction.objectStore('hareketler');
            const list = [];
            const req = store.openCursor();
            
            const targetId = (musteriId !== null && musteriId !== undefined && musteriId !== '' && !isNaN(parseInt(musteriId, 10)))
                ? parseInt(musteriId, 10)
                : null;

            req.onsuccess = (e) => {
                const cursor = e.target.result;
                if (cursor) {
                    const val = cursor.value || {};
                    val.id = (cursor.key !== undefined && cursor.key !== null) ? cursor.key : val.id;
                    if (targetId === null || parseInt(val.musteriId, 10) === targetId) {
                        list.push(val);
                    }
                    cursor.continue();
                } else {
                    resolve(list);
                }
            };
            req.onerror = (e) => reject(e.target.error);
        } catch (err) {
            reject(err);
        }
    });
}

// --- HESAPLAMALAR --- //

// Tüm işletme genel bakiyesi
async function getGenelOzet() {
    const musteriler = await getMusteriler();
    const gecerliIdler = new Set(musteriler.map(m => parseInt(m.id, 10)));
    const hareketler = await getHareketler();
    
    let toplamAlacakKurus = 0; // Toplam Verilen Hizmet
    let toplamTahsilatKurus = 0; // Toplam Alınan Ödeme

    for (let islem of hareketler) {
        if (!gecerliIdler.has(parseInt(islem.musteriId, 10))) continue;
        if (islem.tip === 'hizmet') {
            toplamAlacakKurus += islem.tutarKurus;
        } else if (islem.tip === 'odeme') {
            toplamTahsilatKurus += islem.tutarKurus;
        }
    }

    return {
        toplamAlacakKurus,
        toplamTahsilatKurus,
        genelBakiyeKurus: toplamAlacakKurus - toplamTahsilatKurus
    };
}

async function getMusteriBakiyeleri() {
    const musteriler = await getMusteriler();
    const hareketler = await getHareketler(); 

    const bakiyeMap = {};
    const sonIslemMap = {};
    const sonOdemeMap = {};

    for (let islem of hareketler) {
        const mId = parseInt(islem.musteriId, 10);
        if (isNaN(mId)) continue;
        if (!bakiyeMap[mId]) {
            bakiyeMap[mId] = 0;
            sonIslemMap[mId] = islem.tarih;
        }
        
        if (islem.tarih > sonIslemMap[mId]) {
            sonIslemMap[mId] = islem.tarih;
        }

        if (islem.tip === 'hizmet') {
            bakiyeMap[mId] += islem.tutarKurus;
        } else {
            bakiyeMap[mId] -= islem.tutarKurus;
            if (!sonOdemeMap[mId] || islem.tarih > sonOdemeMap[mId]) {
                sonOdemeMap[mId] = islem.tarih;
            }
        }
    }

    return musteriler.map(m => {
        const mId = parseInt(m.id, 10);
        const netBakiyeKurus = bakiyeMap[mId] || 0;
        const sonOdemeTarihi = sonOdemeMap[mId] || null;
        return {
            ...m,
            id: mId,
            netBakiyeKurus,
            sonIslemTarihi: sonIslemMap[mId] || m.olusturmaTarihi,
            sonOdemeTarihi,
            odemeDurumu: hesaplaOdemeDurumu(sonOdemeTarihi, netBakiyeKurus, m.olusturmaTarihi)
        };
    }).sort((a, b) => new Date(b.sonIslemTarihi) - new Date(a.sonIslemTarihi)); // Son işleme göre azalan
}

function hesaplaOdemeDurumu(sonOdemeTarihi, netBakiyeKurus, olusturmaTarihi) {
    if (netBakiyeKurus === 0) {
        return { text: "Borcu yok · Hesap dengede", status: "clean", icon: "solar:check-circle-linear" };
    }
    if (netBakiyeKurus < 0) {
        return { text: "Alacaklı (Fazla ödeme)", status: "surplus", icon: "solar:wallet-2-linear" };
    }

    // Müşteri borçlu (netBakiyeKurus > 0)
    const now = Date.now();

    if (!sonOdemeTarihi) {
        const baseDate = olusturmaTarihi ? new Date(olusturmaTarihi).getTime() : now;
        const diffDays = Math.max(0, Math.floor((now - baseDate) / (1000 * 60 * 60 * 24)));
        const diffMonths = Math.floor(diffDays / 30);
        
        if (diffMonths >= 1) {
            return { text: `${diffMonths} aydır ödeme alınmadı`, status: "danger", icon: "solar:clock-circle-linear" };
        } else if (diffDays > 0) {
            return { text: `${diffDays} gündür ödeme alınmadı`, status: "warning", icon: "solar:clock-circle-linear" };
        } else {
            return { text: "Yeni kayıt · Henüz ödeme yok", status: "warning", icon: "solar:clock-circle-linear" };
        }
    }

    const diffDays = Math.max(0, Math.floor((now - new Date(sonOdemeTarihi).getTime()) / (1000 * 60 * 60 * 24)));
    const diffMonths = Math.floor(diffDays / 30);

    if (diffMonths >= 1) {
        return { 
            text: `${diffMonths} aydır ödeme alınmadı`, 
            status: diffMonths >= 3 ? "danger" : "warning", 
            icon: "solar:clock-circle-linear" 
        };
    } else {
        if (diffDays === 0) {
            return { text: "Bugün ödeme alındı", status: "success", icon: "solar:check-read-linear" };
        } else if (diffDays === 1) {
            return { text: "Dün ödeme alındı", status: "success", icon: "solar:check-read-linear" };
        } else {
            return { text: `${diffDays} gün önce ödendi`, status: "success", icon: "solar:check-read-linear" };
        }
    }
}


// --- YEDEKLEME --- //
async function exportData() {
    const musteriler = await getMusteriler();
    const hareketler = await getHareketler();
    
    const data = {
        app: "LedgerDB_Yedek",
        tarih: new Date().toISOString(),
        musteriler,
        hareketler
    };
    
    const json = JSON.stringify(data, null, 2);
    
    // Create download link
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ledger_yedek_${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    return json;
}

async function importData(jsonData) {
    let parsed;
    try {
        parsed = JSON.parse(jsonData);
        if(parsed.app !== "LedgerDB_Yedek" && !parsed.musteriler) throw new Error("Geçersiz format");
    } catch(e) {
        alert("Geçersiz yedek dosyası!");
        return false;
    }

    const db = await initDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(['musteriler', 'hareketler'], 'readwrite');
        
        transaction.oncomplete = () => {
            resolve(true);
            window.location.reload();
        };
        transaction.onerror = (e) => reject(e.target.error);

        const mStore = transaction.objectStore('musteriler');
        const hStore = transaction.objectStore('hareketler');

        // Önce temizle, sonra yükle (Atomic)
        mStore.clear().onsuccess = () => {
            parsed.musteriler.forEach(m => mStore.put(m));
        };
        hStore.clear().onsuccess = () => {
            parsed.hareketler.forEach(h => hStore.put(h));
        };
    });
}

// --- İLİŞKİSEL BÜTÜNLÜK & YETİM HAREKET TEMİZLEME MOTORU --- //
async function yetimHareketleriTemizle() {
    if (!dbInstance) return;

    return new Promise((resolve) => {
        // NOT: IndexedDB, onsuccess olayı içinde yeni transaction açmaya izin
        // vermez — transaction'ı bir mikrogörev sonrasına ertele.
        const calistir = () => {
        try {
            const tx = dbInstance.transaction(['musteriler', 'hareketler'], 'readwrite');
            const mStore = tx.objectStore('musteriler');
            const hStore = tx.objectStore('hareketler');

            const mReq = mStore.getAll();
            mReq.onsuccess = () => {
                const musteriler = mReq.result || [];
                const gecerliMusteriMap = new Map();
                musteriler.forEach(m => {
                    if (m && m.id !== undefined && m.id !== null) {
                        gecerliMusteriMap.set(parseInt(m.id, 10), m.ad || 'Müşteri');
                    }
                });

                const hReq = hStore.openCursor();
                hReq.onsuccess = (e) => {
                    const cursor = e.target.result;
                    if (cursor) {
                        const h = cursor.value || {};
                        const mId = parseInt(h.musteriId, 10);

                        // 1. Müşteri ID geçersizse VEYA veritabanında bu müşteri artık yoksa kalıcı olarak sil:
                        if (!mId || isNaN(mId) || !gecerliMusteriMap.has(mId)) {
                            cursor.delete();
                        } else {
                            // 2. Müşteri adı işlem kaydında yoksa kalıcı olarak iliştir
                            if (!h.musteriAd && gecerliMusteriMap.has(mId)) {
                                h.musteriAd = gecerliMusteriMap.get(mId);
                                cursor.update(h);
                            }
                        }
                        cursor.continue();
                    }
                };
            };

            tx.oncomplete = () => {
                guvenliBayrakYaz('ledger_seeded', 'true');
                resolve(true);
            };
            tx.onerror = () => {
                resolve(false);
            };
        } catch (err) {
            resolve(false);
        }
        };

        // initDB().onsuccess çağrı yığını içinden transaction açılamaz;
        // bir mikrogörev sonrasına ertele (await yetimHareketleriTemizle uyumlu).
        if (typeof queueMicrotask === 'function') {
            queueMicrotask(calistir);
        } else {
            setTimeout(calistir, 0);
        }
    });
}


// Yardımcı Tarih Fonksiyonu
function formatRelativeDate(isoDateStr) {
    if(!isoDateStr) return "";
    const date = new Date(isoDateStr);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    
    if (date.toDateString() === today.toDateString()) {
        return "Bugün";
    } else if (date.toDateString() === yesterday.toDateString()) {
        return "Dün";
    }
    
    return new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'short' }).format(date);
}

function getInitials(name) {
    if (!name || typeof name !== 'string') return '--';
    const parts = name.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return '--';
    if (parts.length === 1) {
        return parts[0].substring(0, 2).toUpperCase();
    }
    return (parts[0][0] + (parts[parts.length - 1][0] || '')).toUpperCase();
}
