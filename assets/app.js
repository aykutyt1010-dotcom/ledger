/**
 * Ledger — Mobil SPA Kontrolörü (assets/app.js)
 * Sayfa yenilemesiz, akıcı iOS geçişli, tüm fonksiyonları çalışan ana UI mantığı.
 */

// Global Uygulama Durumu (State)
const state = {
    currentTab: 'dashboard', // 'dashboard' | 'customers' | 'reports'
    bakiyeGizli: false,
    selectedMusteriId: null,
    customerFilter: 'all', // 'all' | 'borclu' | 'alacakli' | 'sifir'
    customerSort: 'debt', // 'debt' (En çok borcu olan) | 'date' (Son işlem)
    reportDateFilter: 'tumu', // 'tumu' | 'bu-ay' | 'son-30-gun' | 'bugun'
    reportMusteriId: 'all',
    searchQuery: '',
    currentTheme: 'auto', // 'auto' | 'light' | 'dark'
    cachedCustomers: [],
    cachedTransactions: []
};

// --- BAŞLATMA (INIT) --- //

document.addEventListener('DOMContentLoaded', async () => {
    try {
        initTheme();
        await initDB();
        bindEvents();
        handleUrlParams();
        await refreshAllData();
    } catch (err) {
        console.error('Uygulama başlatma hatası:', err);
        showToast('Veritabanı başlatılamadı: ' + err.message, 'error');
    }
});

// --- TEMA (DARK / LIGHT MODE) YÖNETİMİ --- //

function initTheme() {
    const saved = localStorage.getItem('ledger_theme') || 'auto';
    setTheme(saved, false);
}

function setTheme(theme, save = true) {
    state.currentTheme = theme;
    if (save) localStorage.setItem('ledger_theme', theme);

    if (theme === 'dark') {
        document.documentElement.setAttribute('data-theme', 'dark');
    } else if (theme === 'light') {
        document.documentElement.setAttribute('data-theme', 'light');
    } else {
        document.documentElement.removeAttribute('data-theme');
    }

    // Modal içindeki buton durumlarını güncelle
    document.querySelectorAll('.theme-btn').forEach((btn) => {
        if (btn.dataset.theme === theme) btn.classList.add('active');
        else btn.classList.remove('active');
    });
}

function handleUrlParams() {
    const params = new URLSearchParams(window.location.search);
    const tabParam = params.get('tab');
    const musteriIdParam = params.get('musteriId');

    if (musteriIdParam) {
        state.reportMusteriId = parseInt(musteriIdParam, 10);
        switchTab('reports');
    } else if (tabParam && ['dashboard', 'customers', 'reports'].includes(tabParam)) {
        switchTab(tabParam);
    } else {
        switchTab('dashboard');
    }
}

function bindEvents() {
    // Arama Kutusu
    const searchInput = document.getElementById('customerSearchInput');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            state.searchQuery = e.target.value;
            renderCustomers();
        });
    }

    // Modal Dışına Tıklama ile Kapatma
    document.querySelectorAll('.modal-overlay').forEach((overlay) => {
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                closeAllModals();
            }
        });
    });

    // ESC tuşu ile modal kapatma
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeAllModals();
    });

    // Mobil Geri Tuşu (popstate) Dinleyicisi — iPhone Swipe-Back ile modal kapatma
    window.addEventListener('popstate', () => {
        const openModals = document.querySelectorAll('.modal-overlay.open');
        if (openModals.length > 0) {
            closeAllModals(true);
        }
    });
}

// --- SEKME (TAB) YÖNETİMİ --- //

function switchTab(tabName) {
    state.currentTab = tabName;

    // Sekme panellerini göster/gizle ve ARIA güncelle
    document.querySelectorAll('.view-panel').forEach((panel) => {
        panel.classList.remove('active');
        panel.setAttribute('aria-hidden', 'true');
    });

    const targetPanel = document.getElementById(`view-${tabName}`);
    if (targetPanel) {
        targetPanel.classList.add('active');
        targetPanel.setAttribute('aria-hidden', 'false');
    }

    // Alt navigasyon barı butonlarını güncelle
    document.querySelectorAll('.nav-tab').forEach((tabBtn) => {
        const tab = tabBtn.dataset.tab;
        if (tab === tabName) {
            tabBtn.classList.add('active');
            tabBtn.setAttribute('aria-current', 'page');
            tabBtn.setAttribute('aria-selected', 'true');
        } else {
            tabBtn.classList.remove('active');
            tabBtn.removeAttribute('aria-current');
            tabBtn.setAttribute('aria-selected', 'false');
        }
    });

    // URL parametresini güncelle (sayfa yenilendiğinde aktif sekme korunsun)
    try {
        const url = new URL(window.location);
        url.searchParams.set('tab', tabName);
        if (tabName !== 'reports') url.searchParams.delete('musteriId');
        window.history.replaceState({ tab: tabName }, '', url);
    } catch (e) {}

    // Sayfa tepeye kaydırılsın
    window.scrollTo({ top: 0, behavior: 'instant' });

    // Sayfa içeriklerini tazele
    if (tabName === 'dashboard') renderDashboard();
    else if (tabName === 'customers') renderCustomers();
    else if (tabName === 'reports') renderReports();
}

async function refreshAllData() {
    try {
        state.cachedCustomers = await getMusteriBakiyeleri();
        state.cachedTransactions = await getHareketler();

        renderDashboard();
        renderCustomers();
        renderReports();
    } catch (err) {
        console.error('Veri yükleme hatası:', err);
    }
}

// --- 1. ÖZET (DASHBOARD) KONTROLÖRÜ --- //

async function renderDashboard() {
    const ozet = await getGenelOzet();

    // Genel Bakiye Hero Alanı
    const bakiyeEl = document.getElementById('dashGenelBakiye');
    if (bakiyeEl) {
        if (state.bakiyeGizli) {
            bakiyeEl.innerText = '₺••••••';
        } else {
            bakiyeEl.innerText = formatCurrency(ozet.genelBakiyeKurus);
        }
    }

    const alacakEl = document.getElementById('dashToplamAlacak');
    if (alacakEl) alacakEl.innerText = formatCurrency(ozet.toplamAlacakKurus);

    const tahsilatEl = document.getElementById('dashToplamTahsilat');
    if (tahsilatEl) tahsilatEl.innerText = formatCurrency(ozet.toplamTahsilatKurus);

    // Cari Özet Rozetleri
    const musteriSayisiEl = document.getElementById('dashMusteriSayisi');
    if (musteriSayisiEl) musteriSayisiEl.innerText = `${ozet.musteriSayisi} Kişi`;

    const borcluSayisiEl = document.getElementById('dashBorcluSayisi');
    if (borcluSayisiEl) borcluSayisiEl.innerText = `${ozet.borcluMusteriSayisi} Borçlu`;

    // Son 5 İşlem
    const container = document.getElementById('dashSonIslemlerList');
    if (!container) return;

    const sonIslemler = (state.cachedTransactions || []).slice(0, 5);

    if (sonIslemler.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon">${icon('chart', 28)}</div>
                <h3>Henüz İşlem Kaydı Yok</h3>
                <p>Müşterilerinize ilk veresiye kaydını veya tahsilatı ekleyerek başlayın.</p>
                <button type="button" onclick="openIslemModal({ tip: 'hizmet' })" class="btn btn-primary">
                    ${icon('plus', 18)} İlk İşlemi Ekle
                </button>
            </div>
        `;
        return;
    }

    // Müşteri isimlerini dinamik eşle
    const musteriMap = new Map((state.cachedCustomers || []).map((m) => [m.id, m.ad]));

    container.innerHTML = sonIslemler.map((tx) => {
        const musteriAd = musteriMap.get(tx.musteriId) || tx.musteriAd || 'Müşteri';
        const isOdeme = tx.tip === 'odeme';
        const iconName = isOdeme ? 'arrow-down-left' : 'arrow-up-right';
        const circleClass = isOdeme ? 'odeme' : 'hizmet';
        const amountClass = isOdeme ? 'green' : 'red';
        const sign = isOdeme ? '+' : '-';

        return `
            <div class="tx-item" onclick="openCustomerDetail(${tx.musteriId})">
                <div class="tx-left">
                    <div class="tx-icon-circle ${circleClass}">
                        ${icon(iconName, 18)}
                    </div>
                    <div class="tx-meta">
                        <div class="tx-title">${escapeHtml(musteriAd)}</div>
                        <div class="tx-subtitle">${formatRelativeDate(tx.tarih)} · ${escapeHtml(tx.aciklama || (isOdeme ? 'Tahsilat' : 'Hizmet Bedeli'))}</div>
                    </div>
                </div>
                <div class="tx-right">
                    <div class="tx-amount tabular-nums ${amountClass}">${sign}₺${formatNumberTR(tx.tutarKurus)}</div>
                    <span style="font-size: 0.6875rem; color: var(--text-muted);">${isOdeme ? 'Tahsil Edildi' : 'Veresiye'}</span>
                </div>
            </div>
        `;
    }).join('');
}

function toggleGenelBakiye() {
    state.bakiyeGizli = !state.bakiyeGizli;
    const btn = document.getElementById('dashBakiyeGizleBtn');
    if (btn) {
        btn.innerHTML = `${icon(state.bakiyeGizli ? 'eye' : 'eye-closed', 14)} <span>${state.bakiyeGizli ? 'Göster' : 'Gizle'}</span>`;
    }
    renderDashboard();
}

// --- 2. MÜŞTERİLER (CARİ HESAPLAR) KONTROLÖRÜ --- //

function setCustomerFilter(filterType) {
    state.customerFilter = filterType;
    document.querySelectorAll('.chip[data-filter]').forEach((chip) => {
        if (chip.dataset.filter === filterType) chip.classList.add('active');
        else chip.classList.remove('active');
    });
    renderCustomers();
}

function toggleCustomerSort() {
    state.customerSort = state.customerSort === 'debt' ? 'date' : 'debt';
    const sortBtn = document.getElementById('customerSortBtn');
    if (sortBtn) {
        sortBtn.innerHTML = `${icon('filter', 13)} <span>${state.customerSort === 'debt' ? 'En Çok Borç' : 'Son İşlem'}</span>`;
    }
    renderCustomers();
}

function renderCustomers() {
    const container = document.getElementById('customerListContainer');
    if (!container) return;

    let list = [...(state.cachedCustomers || [])];

    // Arama Filtresi (Türkçe Duyarlı)
    if (state.searchQuery) {
        const qNorm = turkishNormalize(state.searchQuery);
        list = list.filter((m) => {
            const adNorm = turkishNormalize(m.ad);
            const telNorm = (m.telefon || '').replace(/\s+/g, '');
            return adNorm.includes(qNorm) || telNorm.includes(qNorm);
        });
    }

    // Durum Filtresi
    if (state.customerFilter === 'borclu') {
        list = list.filter((m) => m.netBakiyeKurus > 0);
    } else if (state.customerFilter === 'alacakli') {
        list = list.filter((m) => m.netBakiyeKurus < 0);
    } else if (state.customerFilter === 'sifir') {
        list = list.filter((m) => m.netBakiyeKurus === 0);
    }

    // Sıralama (Borca Göre vs Tarihe Göre)
    if (state.customerSort === 'debt') {
        list.sort((a, b) => b.netBakiyeKurus - a.netBakiyeKurus);
    } else {
        list.sort((a, b) => new Date(b.sonIslemTarihi) - new Date(a.sonIslemTarihi));
    }

    // Başlık Sayacı
    const countEl = document.getElementById('customerCountBadge');
    if (countEl) countEl.innerText = `${list.length} Kişi`;

    if (list.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon">${icon('users', 28)}</div>
                <h3>Müşteri Bulunamadı</h3>
                <p>${state.searchQuery ? 'Arama kriterinize uyan müşteri bulunamadı.' : 'Henüz kayıtlı bir müşteri bulunmuyor.'}</p>
                <button type="button" onclick="openMusteriModal()" class="btn btn-primary">
                    ${icon('user-plus', 18)} Yeni Müşteri Ekle
                </button>
            </div>
        `;
        return;
    }

    container.innerHTML = list.map((m) => {
        const isBorclu = m.netBakiyeKurus > 0;
        const isAlacakli = m.netBakiyeKurus < 0;
        const isSifir = m.netBakiyeKurus === 0;

        let avatarClass = 'sifir';
        let amountClass = 'grey';
        let durumText = 'Hesap Dengede';

        if (isBorclu) {
            avatarClass = 'borc';
            amountClass = 'red';
            durumText = 'Borçlu';
        } else if (isAlacakli) {
            avatarClass = 'odeme';
            amountClass = 'green';
            durumText = 'Alacaklı';
        }

        const odeme = m.odemeDurumu || { text: 'Henüz ödeme yok', status: 'clean', icon: 'clock' };

        // WhatsApp Hazır Mesajı (Tam Türkçe & Profesyonel)
        const cleanTel = (m.telefon || '').replace(/[^0-9]/g, '');
        let waUrl = '';
        if (cleanTel) {
            const telWithCode = cleanTel.startsWith('0') ? '9' + cleanTel : (cleanTel.startsWith('90') ? cleanTel : '90' + cleanTel);
            const bakiyeMetni = isBorclu
                ? `Sayın ${m.ad},\n\nLedger cari kayıtlarımıza göre güncel açık bakiyeniz ${formatCurrency(m.netBakiyeKurus)} borç olarak görünmektedir.\n\nBilgilerinize sunar, iyi günler dileriz.`
                : `Sayın ${m.ad},\n\nLedger cari kayıtlarımıza göre hesabınızda borç bulunmamaktadır. İyi çalışmalar dileriz.`;
            waUrl = `https://wa.me/${telWithCode}?text=${encodeURIComponent(bakiyeMetni)}`;
        }

        const phoneDisplay = formatPhoneTR(m.telefon);

        return `
            <div class="customer-card" onclick="openCustomerDetail(${m.id})">
                <div class="customer-top">
                    <div class="customer-info">
                        <div class="avatar ${avatarClass}">
                            ${escapeHtml(getInitials(m.ad))}
                        </div>
                        <div class="customer-details">
                            <div class="customer-name">${escapeHtml(m.ad)}</div>
                            <div class="customer-subtext">
                                ${phoneDisplay ? `<span onclick="event.stopPropagation(); window.location.href='tel:${escapeHtml(m.telefon)}'" style="color: var(--primary-accent);">${icon('phone', 12)} ${escapeHtml(phoneDisplay)}</span>` : '<span>Telefon yok</span>'}
                            </div>
                            <div class="customer-status-badge ${odeme.status}">
                                ${icon(odeme.icon, 13)}
                                <span>${escapeHtml(odeme.text)}</span>
                            </div>
                        </div>
                    </div>
                    <div class="customer-balance-block">
                        <div class="customer-balance-amount tabular-nums ${amountClass}">
                            ${formatCurrency(Math.abs(m.netBakiyeKurus))}
                        </div>
                        <div class="customer-balance-label">${durumText}</div>
                    </div>
                </div>

                <!-- Hızlı Aksiyon Satırı (Butonlar) -->
                <div class="customer-actions-row" onclick="event.stopPropagation();">
                    <button type="button" class="btn-mini-action tahsilat" onclick="openIslemModal({ musteriId: ${m.id}, tip: 'odeme' })">
                        ${icon('arrow-down-left', 14)} Tahsilat Al
                    </button>
                    <button type="button" class="btn-mini-action borc" onclick="openIslemModal({ musteriId: ${m.id}, tip: 'hizmet' })">
                        ${icon('arrow-up-right', 14)} Borç Yaz
                    </button>
                    ${waUrl ? `
                    <button type="button" class="btn-circle-tool" onclick="window.open('${waUrl}', '_blank')" title="WhatsApp Hatırlatması Gönder" style="color: #16A34A;">
                        ${icon('whatsapp', 16)}
                    </button>` : ''}
                    <button type="button" class="btn-circle-tool" onclick="openMusteriModal(${m.id})" title="Kişiyi Düzenle">
                        ${icon('edit', 16)}
                    </button>
                </div>
            </div>
        `;
    }).join('');
}

// --- 3. HAREKETLER & RAPORLAR KONTROLÖRÜ --- //

function setReportDateFilter(dateFilter) {
    state.reportDateFilter = dateFilter;
    document.querySelectorAll('#reportDateChips .chip').forEach((c) => {
        if (c.dataset.date === dateFilter) c.classList.add('active');
        else c.classList.remove('active');
    });

    const bugun = new Date();
    const basInput = document.getElementById('reportBaslangic');
    const bitInput = document.getElementById('reportBitis');

    if (bitInput) bitInput.value = bugun.toISOString().split('T')[0];

    if (basInput) {
        if (dateFilter === 'tumu') {
            basInput.value = '';
            if (bitInput) bitInput.value = '';
        } else if (dateFilter === 'bugun') {
            basInput.value = bugun.toISOString().split('T')[0];
        } else if (dateFilter === 'bu-ay') {
            const ayBasi = new Date(bugun.getFullYear(), bugun.getMonth(), 1);
            basInput.value = ayBasi.toISOString().split('T')[0];
        } else if (dateFilter === 'son-30-gun') {
            const d = new Date();
            d.setDate(d.getDate() - 30);
            basInput.value = d.toISOString().split('T')[0];
        }
    }

    renderReports();
}

function handleReportMusteriChange(e) {
    const val = e.target.value;
    state.reportMusteriId = val === 'all' ? 'all' : parseInt(val, 10);
    renderReports();
}

function openCustomerDetail(musteriId) {
    state.reportMusteriId = parseInt(musteriId, 10);
    switchTab('reports');
}

function renderReports() {
    const container = document.getElementById('reportTimelineContainer');
    if (!container) return;

    // Müşteri seçici dropdown'u doldur
    const select = document.getElementById('reportMusteriSelect');
    if (select) {
        let optionsHtml = `<option value="all">🏢 Tüm Müşteriler (Genel Ekstre)</option>`;
        (state.cachedCustomers || []).forEach((m) => {
            const isSelected = state.reportMusteriId === m.id ? 'selected' : '';
            optionsHtml += `<option value="${m.id}" ${isSelected}>${escapeHtml(m.ad)} (${formatCurrency(Math.abs(m.netBakiyeKurus))})</option>`;
        });
        select.innerHTML = optionsHtml;
    }

    // Tarihleri al
    const basStr = document.getElementById('reportBaslangic') ? document.getElementById('reportBaslangic').value : '';
    const bitStr = document.getElementById('reportBitis') ? document.getElementById('reportBitis').value : '';
    const baslangic = basStr ? new Date(basStr + 'T00:00:00') : null;
    const bitis = bitStr ? new Date(bitStr + 'T23:59:59') : null;

    // Hareketleri filtrele
    let list = [...(state.cachedTransactions || [])];

    if (state.reportMusteriId !== 'all') {
        list = list.filter((tx) => parseInt(tx.musteriId, 10) === state.reportMusteriId);
    }

    if (baslangic) list = list.filter((tx) => new Date(tx.tarih) >= baslangic);
    if (bitis) list = list.filter((tx) => new Date(tx.tarih) <= bitis);

    // Dönem Metriklerini Hesapla
    let donemAlacak = 0;
    let donemTahsilat = 0;

    list.forEach((tx) => {
        if (tx.tip === 'hizmet') donemAlacak += tx.tutarKurus;
        else if (tx.tip === 'odeme') donemTahsilat += tx.tutarKurus;
    });

    const donemNet = donemAlacak - donemTahsilat;

    const elAlacak = document.getElementById('repOzetAlacak');
    const elTahsilat = document.getElementById('repOzetTahsilat');
    const elNet = document.getElementById('repOzetNet');

    if (elAlacak) elAlacak.innerText = formatCurrency(donemAlacak);
    if (elTahsilat) elTahsilat.innerText = formatCurrency(donemTahsilat);
    if (elNet) elNet.innerText = formatCurrency(donemNet);

    // Seçili müşteri kartı banner'ı
    const banner = document.getElementById('reportCustomerBanner');
    if (banner) {
        if (state.reportMusteriId !== 'all') {
            const m = (state.cachedCustomers || []).find((x) => x.id === state.reportMusteriId);
            if (m) {
                banner.style.display = 'block';
                banner.innerHTML = `
                    <div style="display: flex; align-items: center; justify-content: space-between;">
                        <div>
                            <span style="font-size: 0.7rem; font-weight: 600; color: var(--text-muted); text-transform: uppercase;">Müşteri Ekstresi</span>
                            <h3 style="font-size: 1.1rem; font-weight: 700; color: var(--text-main); margin-top: 2px;">${escapeHtml(m.ad)}</h3>
                            <p style="font-size: 0.75rem; color: var(--text-muted);">${formatPhoneTR(m.telefon) || 'Telefon belirtilmemiş'}</p>
                        </div>
                        <div style="text-align: right;">
                            <span style="font-size: 0.7rem; color: var(--text-muted);">Güncel Bakiye</span>
                            <div style="font-size: 1.2rem; font-weight: 800; color: ${m.netBakiyeKurus > 0 ? 'var(--borc-red)' : (m.netBakiyeKurus < 0 ? 'var(--odeme-green)' : 'var(--text-muted)')};">
                                ${formatCurrency(Math.abs(m.netBakiyeKurus))}
                            </div>
                            <span style="font-size: 0.7rem; font-weight: 600;">${m.netBakiyeKurus > 0 ? 'Borçlu' : (m.netBakiyeKurus < 0 ? 'Alacaklı' : 'Dengede')}</span>
                        </div>
                    </div>
                    <div style="display: flex; gap: 8px; margin-top: 12px; padding-top: 10px; border-top: 1px solid var(--border);">
                        <button type="button" class="btn btn-odeme" style="flex: 1; height: 38px;" onclick="openIslemModal({ musteriId: ${m.id}, tip: 'odeme' })">
                            ${icon('arrow-down-left', 14)} Tahsilat Al
                        </button>
                        <button type="button" class="btn btn-borc" style="flex: 1; height: 38px;" onclick="openIslemModal({ musteriId: ${m.id}, tip: 'hizmet' })">
                            ${icon('arrow-up-right', 14)} Borç Yaz
                        </button>
                    </div>
                `;
            }
        } else {
            banner.style.display = 'none';
        }
    }

    if (list.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon">${icon('calendar', 28)}</div>
                <h3>Seçilen Dönemde İşlem Yok</h3>
                <p>Belirtilen tarih veya müşteri kriterlerine uyan herhangi bir işlem kaydı bulunamadı.</p>
            </div>
        `;
        return;
    }

    // Müşteri isimlerini dinamik harita ile ilişkilendir (isim değişikliği anında yansır)
    const musteriMap = new Map((state.cachedCustomers || []).map((m) => [m.id, m.ad]));

    // Tarihe göre gruplandır (Gün gün)
    const grouped = {};
    list.forEach((tx) => {
        const dateKey = tx.tarih ? tx.tarih.split('T')[0] : 'Bilinmeyen';
        if (!grouped[dateKey]) grouped[dateKey] = [];
        grouped[dateKey].push(tx);
    });

    let html = '';
    const sortedDates = Object.keys(grouped).sort((a, b) => new Date(b) - new Date(a));

    sortedDates.forEach((dateKey) => {
        const items = grouped[dateKey];
        const dateFormatted = formatFullDateTR(dateKey + 'T12:00:00');
        const relativeText = formatRelativeDate(dateKey + 'T12:00:00');

        html += `
            <div class="date-group-header">
                ${icon('calendar', 14)}
                <span>${dateFormatted} ${relativeText ? `(${relativeText})` : ''}</span>
            </div>
        `;

        items.forEach((tx) => {
            const musteriAd = musteriMap.get(tx.musteriId) || tx.musteriAd || 'Müşteri';
            const isOdeme = tx.tip === 'odeme';
            const iconName = isOdeme ? 'arrow-down-left' : 'arrow-up-right';
            const circleClass = isOdeme ? 'odeme' : 'hizmet';
            const amountClass = isOdeme ? 'green' : 'red';
            const sign = isOdeme ? '+' : '-';

            html += `
                <div class="tx-item">
                    <div class="tx-left">
                        <div class="tx-icon-circle ${circleClass}">
                            ${icon(iconName, 18)}
                        </div>
                        <div class="tx-meta">
                            <div class="tx-title">${escapeHtml(musteriAd)}</div>
                            <div class="tx-subtitle">${escapeHtml(tx.aciklama || (isOdeme ? 'Tahsilat' : 'Hizmet Bedeli'))}</div>
                        </div>
                    </div>
                    <div class="tx-right">
                        <div class="tx-amount tabular-nums ${amountClass}">${sign}₺${formatNumberTR(tx.tutarKurus)}</div>
                        <button type="button" class="tx-del-btn" onclick="handleIslemSil(${tx.id})" title="İşlemi Sil">
                            ${icon('trash', 14)}
                        </button>
                    </div>
                </div>
            `;
        });
    });

    container.innerHTML = html;
}

async function handleIslemSil(islemId) {
    const onay = confirm('Bu işlem kaydını silmek istediğinizden emin misiniz? Bakiye yeniden hesaplanacaktır.');
    if (!onay) return;

    try {
        await islemSil(islemId);
        showToast('İşlem başarıyla silindi.', 'success');
        await refreshAllData();
    } catch (err) {
        showToast('İşlem silinemedi: ' + err.message, 'error');
    }
}

// WhatsApp Ekstre Metni Kopyalama
function copyEkstreText() {
    let list = [...(state.cachedTransactions || [])];
    let baslik = 'LEDGER HESAP EKSTRESİ';

    if (state.reportMusteriId !== 'all') {
        const m = (state.cachedCustomers || []).find((x) => x.id === state.reportMusteriId);
        if (m) {
            baslik = `*${m.ad.toUpperCase()} - HESAP DÖKÜMÜ*\nGüncel Bakiye: ${formatCurrency(Math.abs(m.netBakiyeKurus))} (${m.netBakiyeKurus > 0 ? 'Borçlu' : 'Alacaklı'})`;
        }
        list = list.filter((tx) => parseInt(tx.musteriId, 10) === state.reportMusteriId);
    }

    if (list.length === 0) {
        showToast('Kopyalanacak işlem bulunmuyor.', 'warning');
        return;
    }

    let metin = `${baslik}\nTarih: ${new Date().toLocaleDateString('tr-TR')}\n-------------------------\n`;

    list.slice(0, 30).forEach((tx) => {
        const isOdeme = tx.tip === 'odeme';
        const tarih = formatRelativeDate(tx.tarih);
        metin += `${tarih} | ${isOdeme ? '🟢 Tahsilat: ' : '🔴 Borç: '} ₺${formatNumberTR(tx.tutarKurus)} (${tx.aciklama || '-'})\n`;
    });

    navigator.clipboard.writeText(metin).then(() => {
        showToast('Ekstre metni panoya kopyalandı! WhatsApp\'a yapıştırabilirsiniz.', 'success');
    }).catch(() => {
        showToast('Panoya kopyalanamadı.', 'error');
    });
}

// --- 4. MODAL YÖNETİMİ & FORMLAR --- //

function openModalOverlay(overlayId) {
    const overlay = typeof overlayId === 'string' ? document.getElementById(overlayId) : overlayId;
    if (!overlay) return;

    // Henüz açık değilse geçmişe ekle (iOS swipe-back ile modal kapatılabilmesi için)
    if (!overlay.classList.contains('open')) {
        try {
            window.history.pushState({ ledgerModal: overlay.id || true }, '');
        } catch (e) {}
    }
    overlay.classList.add('open');
}

function closeAllModals(fromPopState = false) {
    const openModals = document.querySelectorAll('.modal-overlay.open');
    if (openModals.length === 0) return;

    openModals.forEach((m) => m.classList.remove('open'));

    // Eğer kullanıcı arayüzdeki çarpıdan veya backdrop'tan kapattıysa ve history'de modal varsa pop yap
    if (!fromPopState && window.history.state && window.history.state.ledgerModal) {
        try {
            window.history.back();
        } catch (e) {}
    }
}

// İşlem Ekle Modalı
let currentModalTip = 'odeme'; // 'odeme' | 'hizmet'

function openIslemModal(options = {}) {
    const { musteriId = null, tip = 'odeme', tutar = '' } = options;
    currentModalTip = tip;

    // Müşteri seçicisini hazırla
    const select = document.getElementById('islemModalMusteriSelect');
    if (select) {
        let html = '<option value="" disabled selected>Müşteri Seçin...</option>';
        (state.cachedCustomers || []).forEach((m) => {
            const isSelected = musteriId && parseInt(musteriId, 10) === m.id ? 'selected' : '';
            html += `<option value="${m.id}" ${isSelected}>${escapeHtml(m.ad)} (${formatCurrency(Math.abs(m.netBakiyeKurus))})</option>`;
        });
        select.innerHTML = html;
        if (musteriId) select.value = musteriId;
    }

    // Modal tipini ayarla
    setIslemModalTip(tip);

    // Tutar, tarih ve açıklama alanlarını sıfırla
    const tutarInput = document.getElementById('islemModalTutar');
    if (tutarInput) tutarInput.value = tutar;

    const tarihInput = document.getElementById('islemModalTarih');
    if (tarihInput) tarihInput.value = new Date().toISOString().split('T')[0];

    const aciklamaInput = document.getElementById('islemModalAciklama');
    if (aciklamaInput) aciklamaInput.value = tip === 'odeme' ? 'Nakit Tahsilat' : 'Hizmet Bedeli';

    // Bakiye Kapat butonunu hazırla
    updateBakiyeyiKapatButton();

    openModalOverlay('modalIslemOverlay');

    // İlk inputa odaklan
    setTimeout(() => {
        if (tutarInput) tutarInput.focus();
    }, 150);
}

function setIslemModalTip(tip) {
    currentModalTip = tip;
    const btnOdeme = document.getElementById('islemToggleBtnOdeme');
    const btnBorc = document.getElementById('islemToggleBtnBorc');
    const submitBtn = document.getElementById('islemModalSubmitBtn');
    const aciklamaInput = document.getElementById('islemModalAciklama');

    if (tip === 'odeme') {
        if (btnOdeme) btnOdeme.className = 'type-toggle-btn active odeme';
        if (btnBorc) btnBorc.className = 'type-toggle-btn';
        if (submitBtn) {
            submitBtn.className = 'btn btn-odeme';
            submitBtn.style.width = '100%';
            submitBtn.innerHTML = `${icon('arrow-down-left', 18)} Tahsilatı Kaydet`;
        }
        if (aciklamaInput && (!aciklamaInput.value || aciklamaInput.value === 'Hizmet Bedeli')) {
            aciklamaInput.value = 'Nakit Tahsilat';
        }
    } else {
        if (btnBorc) btnBorc.className = 'type-toggle-btn active borc';
        if (btnOdeme) btnOdeme.className = 'type-toggle-btn';
        if (submitBtn) {
            submitBtn.className = 'btn btn-borc';
            submitBtn.style.width = '100%';
            submitBtn.innerHTML = `${icon('arrow-up-right', 18)} Borcu Kaydet`;
        }
        if (aciklamaInput && (!aciklamaInput.value || aciklamaInput.value === 'Nakit Tahsilat')) {
            aciklamaInput.value = 'Hizmet Bedeli';
        }
    }

    updateBakiyeyiKapatButton();
}

function updateBakiyeyiKapatButton() {
    const select = document.getElementById('islemModalMusteriSelect');
    const btn = document.getElementById('btnHizliKapatBakiye');
    if (!select || !btn) return;

    const mId = parseInt(select.value, 10);
    const m = (state.cachedCustomers || []).find((x) => x.id === mId);

    if (m && m.netBakiyeKurus > 0 && currentModalTip === 'odeme') {
        btn.style.display = 'inline-block';
        btn.innerText = `Bakiyeyi Kapat (${formatCurrency(m.netBakiyeKurus)})`;
        btn.onclick = () => {
            const input = document.getElementById('islemModalTutar');
            if (input) input.value = (m.netBakiyeKurus / 100).toFixed(2);
        };
    } else {
        btn.style.display = 'none';
    }
}

function addQuickAmount(miktar) {
    const input = document.getElementById('islemModalTutar');
    if (!input) return;
    const current = parseFloat(input.value) || 0;
    input.value = (current + miktar).toFixed(2);
}

async function handleIslemSubmit(e) {
    e.preventDefault();

    const musteriId = parseInt(document.getElementById('islemModalMusteriSelect').value, 10);
    const tutarTL = document.getElementById('islemModalTutar').value;
    const aciklama = document.getElementById('islemModalAciklama').value;
    const tarih = document.getElementById('islemModalTarih').value;

    if (!musteriId || isNaN(musteriId)) {
        showToast('Lütfen bir müşteri seçin.', 'warning');
        return;
    }

    try {
        await islemEkle(musteriId, currentModalTip, tutarTL, aciklama, tarih);
        closeAllModals();
        showToast(currentModalTip === 'odeme' ? 'Tahsilat başarıyla kaydedildi!' : 'Veresiye kaydı başarıyla eklendi!', 'success');
        await refreshAllData();
    } catch (err) {
        showToast('İşlem kaydedilemedi: ' + err.message, 'error');
    }
}

// Müşteri Ekle / Düzenle Modalı
let editingMusteriId = null;

function openMusteriModal(musteriId = null) {
    editingMusteriId = musteriId ? parseInt(musteriId, 10) : null;

    const titleEl = document.getElementById('musteriModalTitle');
    const adInput = document.getElementById('musteriModalAd');
    const telInput = document.getElementById('musteriModalTel');
    const ilkBakiyeDiv = document.getElementById('musteriModalIlkBakiyeDiv');
    const ilkBakiyeInput = document.getElementById('musteriModalIlkBakiye');
    const silBtn = document.getElementById('musteriModalSilBtn');

    if (editingMusteriId) {
        const m = (state.cachedCustomers || []).find((x) => x.id === editingMusteriId);
        if (!m) return;

        if (titleEl) titleEl.innerText = 'Kişiyi Düzenle';
        if (adInput) adInput.value = m.ad;
        if (telInput) telInput.value = m.telefon || '';
        if (ilkBakiyeDiv) ilkBakiyeDiv.style.display = 'none'; // Düzenlemede devir bakiyesi gizlenir
        if (silBtn) silBtn.style.display = 'block';
    } else {
        if (titleEl) titleEl.innerText = 'Yeni Müşteri Ekle';
        if (adInput) adInput.value = '';
        if (telInput) telInput.value = '';
        if (ilkBakiyeInput) ilkBakiyeInput.value = '';
        if (ilkBakiyeDiv) ilkBakiyeDiv.style.display = 'block';
        if (silBtn) silBtn.style.display = 'none';
    }

    openModalOverlay('modalMusteriOverlay');

    setTimeout(() => {
        if (adInput) adInput.focus();
    }, 150);
}

async function handleMusteriSubmit(e) {
    e.preventDefault();

    const ad = document.getElementById('musteriModalAd').value.trim();
    const tel = document.getElementById('musteriModalTel').value.trim();
    const ilkBakiye = document.getElementById('musteriModalIlkBakiye') ? document.getElementById('musteriModalIlkBakiye').value : 0;

    if (!ad) {
        showToast('Lütfen müşteri adı girin.', 'warning');
        return;
    }

    try {
        if (editingMusteriId) {
            await musteriGuncelle(editingMusteriId, ad, tel);
            showToast('Müşteri bilgileri güncellendi.', 'success');
        } else {
            await musteriEkle(ad, tel, ilkBakiye);
            showToast('Yeni müşteri kaydedildi!', 'success');
        }
        closeAllModals();
        await refreshAllData();
    } catch (err) {
        showToast('Hata: ' + err.message, 'error');
    }
}

async function handleMusteriSil() {
    if (!editingMusteriId) return;
    const m = (state.cachedCustomers || []).find((x) => x.id === editingMusteriId);
    if (!m) return;

    const onay = confirm(`"${m.ad}" kişisini ve bu kişiye ait TÜM borç/ödeme kayıtlarını kalıcı olarak silmek istediğinizden emin misiniz?\n\nBu işlem geri alınamaz!`);
    if (!onay) return;

    try {
        await musteriSil(editingMusteriId);
        closeAllModals();
        showToast('Müşteri ve tüm hareketleri silindi.', 'success');

        if (state.reportMusteriId === editingMusteriId) {
            state.reportMusteriId = 'all';
        }
        await refreshAllData();
    } catch (err) {
        showToast('Silme hatası: ' + err.message, 'error');
    }
}

// Yedekleme ve Ayarlar Modalı
function openSettingsModal() {
    openModalOverlay('modalSettingsOverlay');
}

async function handleExportBackup() {
    try {
        await exportData();
        showToast('Yedek başarıyla dışa aktarıldı!', 'success');
    } catch (err) {
        showToast('Yedekleme başarısız: ' + err.message, 'error');
    }
}

async function handleImportBackup(e) {
    const file = e.target.files[0];
    if (!file) return;

    const onay = confirm('Yedek dosyasını içe aktarmak mevcut verilerinizin üzerine yazacaktır. Önce otomatik bir emniyet yedeği alınacaktır. Devam etmek istiyor musunuz?');
    if (!onay) {
        e.target.value = '';
        return;
    }

    try {
        const text = await file.text();
        await importData(text, true);
        closeAllModals();
        showToast('Yedek başarıyla yüklendi! (Eski veriniz emniyet snapshotuna alındı)', 'success');
        await refreshAllData();
    } catch (err) {
        showToast('İçe aktarma hatası: ' + err.message, 'error');
    }
    e.target.value = '';
}

async function handleRestoreSafetySnapshot() {
    const onay = confirm('Son otomatik emniyet snapshotuna geri dönmek istediğinizden emin misiniz?');
    if (!onay) return;

    try {
        await restoreSafetySnapshot();
        closeAllModals();
        showToast('Emniyet snapshotu başarıyla geri yüklendi!', 'success');
        await refreshAllData();
    } catch (err) {
        showToast('Emniyet snapshotu yüklenemedi: ' + err.message, 'warning');
    }
}

async function handleSampleDataLoad() {
    try {
        await loadSampleData();
        closeAllModals();
        showToast('Örnek veriler yüklendi!', 'success');
        await refreshAllData();
    } catch (err) {
        showToast('Örnek veri yüklenemedi: ' + err.message, 'warning');
    }
}

async function handleResetAllData() {
    // Parmak kaymasıyla veri kaybını önleyen çift onaylı typed prompt!
    const cevap = prompt("DİKKAT: Tüm müşteri kayıtları ve finansal hareketler kalıcı olarak silinecektir.\n\nSilme işlemini onaylamak için lütfen büyük harflerle 'SİL' yazın:");
    if (cevap !== 'SİL') {
        showToast('İşlem iptal edildi. Hiçbir veri silinmedi.', 'warning');
        return;
    }

    try {
        await tumVerileriTemizle();
        closeAllModals();
        showToast('Tüm veriler temizlendi. (Eski kayıtlar emniyet snapshotunda saklandı)', 'success');
        await refreshAllData();
    } catch (err) {
        showToast('Sıfırlama hatası: ' + err.message, 'error');
    }
}

// --- GLOBAL TOAST BİLDİRİM SİSTEMİ --- //
let toastTimer = null;

function showToast(message, type = 'success', duration = 3000) {
    let container = document.getElementById('appToastContainer');
    if (!container) {
        container = document.createElement('div');
        container.id = 'appToastContainer';
        container.className = 'toast-container';
        document.body.appendChild(container);
    }

    if (toastTimer) clearTimeout(toastTimer);
    container.innerHTML = '';

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;

    let iconName = 'check-circle';
    if (type === 'error') iconName = 'warning';
    if (type === 'warning') iconName = 'warning';

    toast.innerHTML = `
        ${icon(iconName, 20)}
        <span>${escapeHtml(message)}</span>
    `;

    container.appendChild(toast);

    toastTimer = setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(-10px)';
        toast.style.transition = 'all 0.25s ease';
        setTimeout(() => toast.remove(), 250);
    }, duration);
}

// Köprü (Bridge) fonksiyonlar
window.openIslemModalOrtak = function(arg1, arg2) {
    if (typeof arg1 === 'number' || !isNaN(parseInt(arg1, 10))) {
        openIslemModal({ musteriId: parseInt(arg1, 10), tip: arg2 || 'odeme' });
    } else {
        openIslemModal({ tip: 'odeme' });
    }
};

window.switchTab = switchTab;
window.setTheme = setTheme;
window.toggleGenelBakiye = toggleGenelBakiye;
window.setCustomerFilter = setCustomerFilter;
window.toggleCustomerSort = toggleCustomerSort;
window.setReportDateFilter = setReportDateFilter;
window.handleReportMusteriChange = handleReportMusteriChange;
window.openCustomerDetail = openCustomerDetail;
window.openIslemModal = openIslemModal;
window.setIslemModalTip = setIslemModalTip;
window.addQuickAmount = addQuickAmount;
window.handleIslemSubmit = handleIslemSubmit;
window.openMusteriModal = openMusteriModal;
window.handleMusteriSubmit = handleMusteriSubmit;
window.handleMusteriSil = handleMusteriSil;
window.openSettingsModal = openSettingsModal;
window.handleExportBackup = handleExportBackup;
window.handleImportBackup = handleImportBackup;
window.handleRestoreSafetySnapshot = handleRestoreSafetySnapshot;
window.handleSampleDataLoad = handleSampleDataLoad;
window.handleResetAllData = handleResetAllData;
window.copyEkstreText = copyEkstreText;
window.handleIslemSil = handleIslemSil;
window.closeAllModals = closeAllModals;
window.showToast = showToast;
