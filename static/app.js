/**
 * Archivebate Video Browser - Frontend Logic
 */

// Kontekst aplikacji (stan oraz elementy DOM)
const { state, dom } = (typeof window !== 'undefined' && window.ArchivebateAppContext)
  ? window.ArchivebateAppContext
  : (typeof ArchivebateAppContext !== 'undefined' ? ArchivebateAppContext : { state: {}, dom: {} });

function isFavoriteAuthor(username) {
  if (!username) return false;
  const norm = String(username).toLowerCase().trim();
  return state.favoriteAuthors && state.favoriteAuthors.has(norm);
}

// Inicjalizacja
document.addEventListener('DOMContentLoaded', () => {
  initUserStatus();
  initTags();
  const filtersModule = (typeof window !== 'undefined' && window.ArchivebateFilters)
    ? window.ArchivebateFilters
    : (typeof ArchivebateFilters !== 'undefined' ? ArchivebateFilters : null);
  if (filtersModule && typeof filtersModule.init === 'function') {
    filtersModule.init({
      showToast,
      loadHomeVideos
    });
  }
  initProfileScanner();
  updateHomeStats();
  updateCheckpointUI();
  
  const urlParams = new URLSearchParams(window.location.search);
  const searchParam = urlParams.get('search');
  if (searchParam) {
    dom.searchInput.value = searchParam;
    dom.clearSearchBtn.style.display = 'flex';
    performSearch(searchParam, 1);
  } else {
    loadHomeVideos(1);
  }

  setupEvents();
  initModalPlayerControls();
});

function initProfileScanner() {
  const scannerModule = (typeof window !== 'undefined' && window.ArchivebateProfileScanner)
    ? window.ArchivebateProfileScanner
    : (typeof ArchivebateProfileScanner !== 'undefined' ? ArchivebateProfileScanner : null);
  if (scannerModule && typeof scannerModule.init === 'function') {
    scannerModule.init({
      showToast,
      updateHomeStats
    });
  }
}

// ============================================================
// STATYSTYKI STRONY GŁÓWNEJ (WIDEO I PROFILE)
// ============================================================
async function updateHomeStats() {
  try {
    const res = await fetch('/api/stats');
    if (res.ok) {
      const data = await res.json();
      if (dom.statGlobalVideos) {
        dom.statGlobalVideos.innerText = '5 500 000+';
      }
      if (dom.statCatalogVideos) {
        dom.statCatalogVideos.innerText = '70 000';
      }
      if (dom.statPageVideos) {
        dom.statPageVideos.innerText = '280';
      }
      if (dom.statGlobalProfiles && data.total_models) {
        dom.statGlobalProfiles.innerText = `${data.total_models.toLocaleString('pl-PL')}`;
        if (dom.scannedModelsCount) {
          dom.scannedModelsCount.innerText = `${data.total_models} profili`;
        }
      }
      if (dom.statUserLibrary) {
        const favs = data.favorites_count || 0;
        const hist = data.history_count || 0;
        dom.statUserLibrary.innerText = `${favs} ulub. • ${hist} hist.`;
      }
      // Licznik zablokowanych autorów i usuniętych filmów
      if (dom.statBlockedInfo) {
        const authors = data.blocked_authors_count || 0;
        dom.statBlockedInfo.innerText = `${authors} autorów`;
      }
      if (dom.statBlockedVideosLbl) {
        const vids = data.blocked_videos_total || 0;
        dom.statBlockedVideosLbl.innerText = `${vids.toLocaleString('pl-PL')} filmów usuniętych z katalogu`;
      }
    }
  } catch (e) {}
}

function setActiveNavTab(tabBtn) {
  document.querySelectorAll('.nav-link').forEach(btn => btn.classList.remove('active'));
  if (tabBtn) tabBtn.classList.add('active');
}

// ============================================================
// SYSTEM PUNKTÓW KONTROLNYCH (CHECKPOINTS)
// ============================================================
function getSavedCheckpoint() {
  try {
    const raw = localStorage.getItem('archivebate_checkpoint');
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

function setCheckpoint(v) {
  const checkpoint = {
    videoId: String(v.id),
    videoTitle: v.username || 'Film',
    videoDate: v.date || '',
    page: state.currentPage || 1,
    mode: state.mode || 'home',
    query: state.currentQuery || '',
    timestamp: Date.now()
  };
  localStorage.setItem('archivebate_checkpoint', JSON.stringify(checkpoint));
  updateCheckpointUI();
  showToast(`📍 Zapisano checkpoint: ${v.username} (Strona ${checkpoint.page})`, 'success');
}

function updateCheckpointUI() {
  const cp = getSavedCheckpoint();
  if (cp) {
    if (dom.headerCheckpointBtn) {
      dom.headerCheckpointBtn.style.display = 'inline-flex';
      if (dom.checkpointText) {
        dom.checkpointText.innerText = `(Strona ${cp.page} • ${cp.videoTitle})`;
      }
    }
    if (dom.navCheckpointBtn) {
      dom.navCheckpointBtn.style.display = 'inline-flex';
      dom.navCheckpointBtn.title = `Przejdź do: ${cp.videoTitle} (Strona ${cp.page})`;
    }
  } else {
    if (dom.headerCheckpointBtn) dom.headerCheckpointBtn.style.display = 'none';
    if (dom.navCheckpointBtn) dom.navCheckpointBtn.style.display = 'none';
  }

  // Aktualizacja oznaczeń na kafelkach
  document.querySelectorAll('.card-date-badge').forEach(badge => {
    const bVidId = badge.dataset.videoId;
    if (cp && bVidId === cp.videoId) {
      badge.classList.add('is-checkpoint');
      badge.innerHTML = `<i class="fa-solid fa-location-dot"></i> Checkpoint`;
      badge.title = `Ten film to Twój aktywny punkt kontrolny (Strona ${cp.page})`;
    } else {
      badge.classList.remove('is-checkpoint');
      if (badge.dataset.origDate) {
        badge.innerHTML = `<i class="fa-regular fa-calendar-days"></i> ${badge.dataset.origDate}`;
        badge.title = 'Kliknij na datę, aby ustawić punkt kontrolny (checkpoint)';
      }
    }
  });
}

function navigateToCheckpoint() {
  const cp = getSavedCheckpoint();
  if (!cp) {
    showToast('Brak zapisanego punktu kontrolnego', 'info');
    return;
  }

  state.targetCheckpointId = cp.videoId;

  // Przejdź do widoku tabeli filmów na odpowiedniej stronie
  if (cp.mode === 'search' && cp.query) {
    dom.searchInput.value = cp.query;
    dom.clearSearchBtn.style.display = 'flex';
    performSearch(cp.query, cp.page);
  } else if (cp.mode === 'model' && cp.query) {
    loadModelVideos(cp.query, cp.page);
  } else if (cp.mode === 'favorites') {
    setActiveNavTab(dom.navFavoritesBtn);
    loadFavorites(cp.page);
  } else if (cp.mode === 'history') {
    setActiveNavTab(dom.navHistoryBtn);
    loadHistory(cp.page);
  } else if (cp.mode === 'following') {
    setActiveNavTab(dom.navFollowingBtn);
    loadFollowing(cp.page);
  } else {
    // Strona główna
    setActiveNavTab(dom.navHomeBtn);
    loadHomeVideos(cp.page);
  }
}

function checkAndHighlightCheckpoint() {
  if (state.targetCheckpointId) {
    const targetCard = dom.videoGrid.querySelector(`[data-video-id="${state.targetCheckpointId}"]`);
    if (targetCard) {
      targetCard.classList.add('checkpoint-highlight');
      setTimeout(() => {
        targetCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 150);
      showToast('📍 Dotarto do zapisanego punktu kontrolnego!', 'success');
      state.targetCheckpointId = null;
    }
  }
}

// ============================================================
// DELEGOWANA OBSŁUGA ZDARZEŃ SIATKI WIDEO (BŁYSKAWICZNY DOM)
// ============================================================
function handleGridClick(e) {
  const card = e.target.closest('.video-card');
  if (!card) return;

  const v = card._videoData || state.videoById.get(card.dataset.videoId);
  if (!v) return;

  // 1. Dodawanie/usuwanie z ulubionych
  const favBtn = e.target.closest('.card-fav-btn');
  if (favBtn) {
    e.stopPropagation();
    toggleFavoriteVideo(v, favBtn);
    return;
  }

  // 2. Kliknięcie na datę -> punkt kontrolny (checkpoint)
  const dateBadge = e.target.closest('.card-date-badge');
  if (dateBadge) {
    e.stopPropagation();
    e.preventDefault();
    setCheckpoint(v);
    return;
  }

  // 3. Kliknięcie w tag na kafelku
  const tagBadge = e.target.closest('.card-tag-badge');
  if (tagBadge) {
    e.stopPropagation();
    e.preventDefault();
    const clickedTag = tagBadge.dataset.tag;
    if (clickedTag) {
      dom.searchInput.value = `#${clickedTag}`;
      dom.clearSearchBtn.style.display = 'flex';
      setActiveNavTab(null);
      performSearch(clickedTag, 1);
    }
    return;
  }

  // 4. Kliknięcie w profil modelki
  const profileLink = e.target.closest('.model-profile-link, .profile-btn');
  if (profileLink) {
    e.preventDefault();
    e.stopPropagation();
    const modelName = profileLink.dataset.username || v.username;
    if (modelName) loadModelVideos(modelName, 1);
    return;
  }

  // 5. Zablokowanie modelki
  const blockBtn = e.target.closest('.block-model-btn');
  if (blockBtn) {
    e.stopPropagation();
    e.preventDefault();
    blockModel(blockBtn.dataset.username || v.username);
    return;
  }

  // 6. Odtwarzanie filmu (kliknięcie w przycisk 'Odtwórz' lub w miniaturkę)
  const playBtn = e.target.closest('.play-btn');
  const thumbWrapper = e.target.closest('.thumbnail-wrapper');
  if (playBtn || thumbWrapper) {
    if (e.button === 0) {
      e.stopPropagation();
      openVideoModal(v);
    }
  }
}

function handleGridAuxClick(e) {
  if (e.button !== 1) return; // tylko środkowy przycisk myszy
  const card = e.target.closest('.video-card');
  if (!card) return;
  const v = card._videoData || state.videoById.get(card.dataset.videoId);
  if (!v || !v.id) return;

  const playBtn = e.target.closest('.play-btn');
  const thumbWrapper = e.target.closest('.thumbnail-wrapper');
  if (playBtn || thumbWrapper) {
    e.preventDefault();
    e.stopPropagation();
    try {
      sessionStorage.setItem('archivebate_bootstrap_' + v.id, JSON.stringify({
        id: v.id,
        username: v.username,
        thumbnail: v.poster_proxy || v.thumbnail_proxy || v.poster,
        date: v.date,
        duration: v.duration,
        platform: v.platform,
        url: v.url
      }));
    } catch (_) {}
    window.open(`/watch/${v.id}`, '_blank');
  }
}

function setupEvents() {
  // Checkpoint navigators
  if (dom.headerCheckpointBtn) dom.headerCheckpointBtn.addEventListener('click', navigateToCheckpoint);
  if (dom.navCheckpointBtn) dom.navCheckpointBtn.addEventListener('click', navigateToCheckpoint);

  // Delegowane zdarzenia siatki kafelków (wysoka wydajność, brak tysięcy listenerów na kartach)
  if (dom.videoGrid) {
    dom.videoGrid.addEventListener('click', handleGridClick);
    dom.videoGrid.addEventListener('auxclick', handleGridAuxClick);
  }

  // Inicjalizacja autouzupełniania wyszukiwarki
  const SearchAutocomplete = window.ArchivebateSearchAutocomplete;
  SearchAutocomplete.init({
    setActiveNavTab,
    performSearch
  });

  // Nawigacja zakładek
  dom.navHomeBtn.addEventListener('click', () => {
    setActiveNavTab(dom.navHomeBtn);
    loadHomeVideos(1);
  });

  dom.navFavoritesBtn.addEventListener('click', () => {
    setActiveNavTab(dom.navFavoritesBtn);
    loadFavorites(1);
  });

  dom.navHistoryBtn.addEventListener('click', () => {
    setActiveNavTab(dom.navHistoryBtn);
    loadHistory(1);
  });

  dom.navFollowingBtn.addEventListener('click', () => {
    setActiveNavTab(dom.navFollowingBtn);
    loadFollowing(1);
  });

  dom.navAccountBtn.addEventListener('click', () => {
    setActiveNavTab(dom.navAccountBtn);
    showAccountPanel();
  });

  // Przyciski w Panelu Konta
  dom.statBtnFavs.addEventListener('click', () => {
    setActiveNavTab(dom.navFavoritesBtn);
    loadFavorites(1);
  });

  dom.statBtnHist.addEventListener('click', () => {
    setActiveNavTab(dom.navHistoryBtn);
    loadHistory(1);
  });

  dom.statBtnFoll.addEventListener('click', () => {
    setActiveNavTab(dom.navFollowingBtn);
    loadFollowing(1);
  });

  if (dom.statBtnBlocked) {
    dom.statBtnBlocked.addEventListener('click', showBlockedModelsManager);
  }

  dom.panelSyncBtn.addEventListener('click', syncAccountWithRemote);
  dom.panelClearHistoryBtn.addEventListener('click', clearWatchHistory);

  // Wyszukiwarka z debounce i natychmiastowym klawiszem Enter
  let debounceTimeout = null;
  dom.searchInput.addEventListener('input', (e) => {
    const val = e.target.value.trim();
    dom.clearSearchBtn.style.display = val ? 'flex' : 'none';

    clearTimeout(debounceTimeout);
    debounceTimeout = setTimeout(() => {
      if (val.length >= 2) {
        setActiveNavTab(null);
        performSearch(val, 1);
      } else if (val.length === 0) {
        resetToHome();
      }
    }, 450);
  });

  dom.searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (!SearchAutocomplete.isOpen() || SearchAutocomplete.activeIdx === -1)) {
      clearTimeout(debounceTimeout);
      const val = dom.searchInput.value.trim();
      SearchAutocomplete.hide();
      if (val.length >= 2) {
        setActiveNavTab(null);
        performSearch(val, 1);
      } else if (val.length === 0) {
        resetToHome();
      }
    }
  });

  dom.clearSearchBtn.addEventListener('click', () => {
    dom.searchInput.value = '';
    dom.clearSearchBtn.style.display = 'none';
    SearchAutocomplete.hide();
    resetToHome();
  });

  dom.resetFilterBtn.addEventListener('click', resetToHome);
  dom.logoBtn.addEventListener('click', resetToHome);

  // Paginacja
  dom.prevPageBtn.addEventListener('click', () => {
    if (state.currentPage > 1) {
      changePage(state.currentPage - 1);
    }
  });

  dom.nextPageBtn.addEventListener('click', () => {
    if (state.currentPage < state.lastPage) {
      changePage(state.currentPage + 1);
    }
  });

  dom.pageJumpBtn.addEventListener('click', () => {
    const pageVal = parseInt(dom.pageJumpInput.value, 10);
    if (pageVal >= 1) {
      changePage(pageVal);
    }
  });

  dom.pageJumpInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const pageVal = parseInt(dom.pageJumpInput.value, 10);
      if (pageVal >= 1) {
        changePage(pageVal);
      }
    }
  });

  // Relogin & Sync
  dom.reloginBtn.addEventListener('click', async () => {
    showToast('Synchronizacja konta...', 'info');
    try {
      const res = await fetch('/api/relogin', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        showToast('Zsynchronizowano pomyślnie!', 'success');
        updateUserStatus(data.status);
      } else {
        showToast(data?.status?.login_error || 'Błąd logowania!', 'error');
      }
    } catch (e) {
      showToast('Błąd połączenia', 'error');
    }
  });

  // Modal events
  dom.modalCloseBtn.addEventListener('click', closeModal);
  dom.videoModal.addEventListener('click', (e) => {
    if (e.target === dom.videoModal) closeModal();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && dom.videoModal.classList.contains('active')) {
      closeModal();
    }
  });

  dom.modalFavBtn.addEventListener('click', async () => {
    if (!state.currentVideoDetails) return;
    const isFav = await toggleFavoriteVideo(state.currentVideoDetails);
    updateModalFavButton(isFav);
  });

  // Automatyczny przeskok do kolejnej strony po zjechaniu na sam dół i kolejnym scrollu
  let lastScrollJumpTime = 0;
  window.addEventListener('wheel', (e) => {
    if (e.deltaY <= 0) return;
    if (state.isLoading) return;
    if (dom.videoModal && dom.videoModal.classList.contains('active')) return;

    const scrollPos = window.innerHeight + window.scrollY;
    const maxScroll = document.documentElement.scrollHeight;
    const atBottom = scrollPos >= (maxScroll - 50);

    if (atBottom && state.currentPage < (state.lastPage || 100)) {
      const now = Date.now();
      if (now - lastScrollJumpTime > 1200) {
        lastScrollJumpTime = now;
        showToast(`Przeskakiwanie do strony ${state.currentPage + 1}...`, 'info');
        changePage(state.currentPage + 1);
      }
    }
  }, { passive: true });

  let touchStartY = 0;
  window.addEventListener('touchstart', (e) => {
    if (e.touches && e.touches[0]) {
      touchStartY = e.touches[0].clientY;
    }
  }, { passive: true });

  window.addEventListener('touchend', (e) => {
    if (e.changedTouches && e.changedTouches[0]) {
      const deltaY = touchStartY - e.changedTouches[0].clientY;
      if (deltaY > 50) {
        const atBottom = (window.innerHeight + window.scrollY) >= (document.documentElement.scrollHeight - 50);
        if (atBottom && !state.isLoading && state.currentPage < (state.lastPage || 100)) {
          const now = Date.now();
          if (now - lastScrollJumpTime > 1200) {
            lastScrollJumpTime = now;
            showToast(`Przeskakiwanie do strony ${state.currentPage + 1}...`, 'info');
            changePage(state.currentPage + 1);
          }
        }
      }
    }
  }, { passive: true });
}

function changePage(newPage) {
  state.currentPage = newPage;
  window.scrollTo({ top: 0, behavior: 'smooth' });

  if (state.mode === 'home') {
    loadHomeVideos(newPage);
  } else if (state.mode === 'search') {
    performSearch(state.currentQuery, newPage);
  } else if (state.mode === 'model') {
    loadModelVideos(state.currentModel, newPage);
  } else if (state.mode === 'favorites') {
    loadFavorites(newPage);
  } else if (state.mode === 'history') {
    loadHistory(newPage);
  } else if (state.mode === 'following') {
    loadFollowing(newPage);
  }
}

// STATUS UŻYTKOWNIKA I SYNCHRONIZACJA
let userStatusRetryCount = 0;
async function initUserStatus() {
  try {
    const data = await ArchivebateAPI.getJSON('/api/status', { timeoutMs: 5000 });
    updateUserStatus(data);

    // Serwer loguje się w tle, żeby logowanie nie blokowało pierwszego ekranu.
    // Jeżeli jeszcze trwa, odśwież status kilka razy bez wpływu na miniatury.
    if (data.account_configured && !data.logged_in && !data.login_error && userStatusRetryCount < 5) {
      userStatusRetryCount += 1;
      dom.userEmail.innerText = 'Łączenie...';
      dom.statusDot.classList.remove('error');
      setTimeout(initUserStatus, 1200 + userStatusRetryCount * 500);
    } else {
      userStatusRetryCount = 0;
    }
  } catch (e) {
    if (userStatusRetryCount < 3) {
      userStatusRetryCount += 1;
      setTimeout(initUserStatus, 1500);
      return;
    }
    dom.userEmail.innerText = 'Błąd sesji';
    dom.statusDot.classList.add('error');
  }
}

function updateUserStatus(status) {
  if (status.logged_in) {
    dom.userEmail.innerText = status.email;
    dom.statusDot.classList.remove('error');
    dom.userEmail.title = 'Zalogowano pomyślnie jako ' + status.email;
    dom.panelEmail.innerText = status.email;
  } else if (!status.account_configured) {
    dom.userEmail.innerText = 'Tryb anonimowy';
    dom.userEmail.title = 'Dodaj dane konta w .env.local, aby włączyć synchronizację konta.';
    dom.panelEmail.innerText = 'Konto nieskonfigurowane';
    dom.statusDot.classList.add('error');
  } else {
    dom.userEmail.innerText = `${status.email || 'Konto'} (offline)`;
    dom.userEmail.title = status.login_error || 'Nie udało się zalogować do Archivebate.';
    dom.statusDot.classList.add('error');
  }

  state.favoritesCount = status.favorites_count || 0;
  state.historyCount = status.history_count || 0;
  state.followingCount = status.following_count || 0;

  dom.navFavCount.innerText = state.favoritesCount;
  dom.navHistCount.innerText = state.historyCount;
  dom.statFavCount.innerText = state.favoritesCount;
  dom.statHistCount.innerText = state.historyCount;
  dom.statFollCount.innerText = state.followingCount;

  if (status.favorite_authors) {
    state.favoriteAuthors = new Set(status.favorite_authors.map(a => String(a).toLowerCase().trim()));
    updateAllAuthorNameColors();
  }

  if (status.last_synced) {
    dom.panelLastSync.innerHTML = `<i class="fa-solid fa-clock"></i> Ostatnia synchronizacja: ${status.last_synced}`;
  }
  updateBlockedModelsCount();
}

function updateAllAuthorNameColors() {
  document.querySelectorAll('.video-card').forEach(card => {
    const link = card.querySelector('.model-profile-link');
    const u = String(link?.dataset.username || card.dataset.username || '').toLowerCase().trim();
    const vidId = card.dataset.videoId;
    const isModelFav = state.favoriteAuthors && state.favoriteAuthors.has(u);
    const vid = state.videos.find(v => String(v.id) === String(vidId));
    const isVidFav = vid ? !!vid.is_favorite : (card.querySelector('.card-fav-btn.active') !== null);
    const shouldHighlight = isModelFav || isVidFav;

    if (link) {
      if (isModelFav) {
        link.classList.add('is-favorite-author');
        if (!link.querySelector('.fav-author-star')) {
          const star = document.createElement('i');
          star.className = 'fa-solid fa-star fav-author-star';
          star.title = 'Masz film tej modelki w ulubionych';
          link.appendChild(star);
        }
      } else {
        link.classList.remove('is-favorite-author');
        const star = link.querySelector('.fav-author-star');
        if (star) star.remove();
      }
    }

    if (shouldHighlight) {
      card.classList.add('is-favorite-card');
    } else {
      card.classList.remove('is-favorite-card');
    }
  });

  if (state.currentVideoDetails && dom.modalModelName) {
    const currU = String(state.currentVideoDetails.username || '').toLowerCase().trim();
    const isModelFav = state.favoriteAuthors && state.favoriteAuthors.has(currU);
    const isVidFav = !!state.currentVideoDetails.is_favorite;
    const isFav = isModelFav || isVidFav;
    if (isFav) {
      dom.modalModelName.classList.add('is-favorite-author');
    } else {
      dom.modalModelName.classList.remove('is-favorite-author');
    }
    const modalContent = dom.videoModal?.querySelector('.modal-content');
    if (modalContent) {
      if (isFav) modalContent.classList.add('is-favorite-modal');
      else modalContent.classList.remove('is-favorite-modal');
    }
  }
}

// SYNCHRONIZACJA Z SERWISEM
async function syncAccountWithRemote() {
  showToast('Pobieranie wszystkich stron z konta Archivebate...', 'info');
  dom.panelSyncBtn.disabled = true;
  try {
    const res = await fetch('/api/account/sync', { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      showToast(`Pobrano: ${data.favorites_count} ulubionych, ${data.history_count} historii, ${data.following_count} obserwowanych!`, 'success');
      updateUserStatus(data);
      if (state.mode === 'favorites') loadFavorites(1);
      if (state.mode === 'history') loadHistory(1);
      if (state.mode === 'following') loadFollowing(1);
    }
  } catch (e) {
    showToast('Błąd synchronizacji', 'error');
  } finally {
    dom.panelSyncBtn.disabled = false;
  }
}

// CZYSZCZENIE HISTORII
async function clearWatchHistory() {
  if (!confirm('Czy na pewno chcesz wyczyścić historię oglądania?')) return;
  try {
    await fetch('/api/account/history/clear', { method: 'POST' });
    state.historyCount = 0;
    dom.navHistCount.innerText = '0';
    dom.statHistCount.innerText = '0';
    showToast('Historia została wyczyszczona', 'info');
    if (state.mode === 'history') loadHistory(1);
  } catch (e) {
    showToast('Błąd czyszczenia historii', 'error');
  }
}

// TOGGLE ULUBIONE
async function toggleFavoriteVideo(video, buttonEl = null) {
  try {
    const res = await fetch('/api/account/favorites/toggle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(video)
    });
    const data = await res.json();
    const isFav = data.is_favorite;

    state.favoritesCount = data.total_favorites;
    dom.navFavCount.innerText = state.favoritesCount;
    dom.statFavCount.innerText = state.favoritesCount;

    if (buttonEl) {
      if (isFav) {
        buttonEl.classList.add('active');
        buttonEl.innerHTML = '<i class="fa-solid fa-heart"></i>';
      } else {
        buttonEl.classList.remove('active');
        buttonEl.innerHTML = '<i class="fa-regular fa-heart"></i>';
      }
    }

    const vid = state.videos.find(v => v.id === video.id);
    if (vid) vid.is_favorite = isFav;
    if (state.currentVideoDetails && String(state.currentVideoDetails.id) === String(video.id)) {
      state.currentVideoDetails.is_favorite = isFav;
    }

    if (data.favorite_authors) {
      state.favoriteAuthors = new Set(data.favorite_authors.map(a => String(a).toLowerCase().trim()));
    }
    updateAllAuthorNameColors();

    showToast(isFav ? 'Dodano do ulubionych ❤️' : 'Usunięto z ulubionych', isFav ? 'success' : 'info');
    return isFav;
  } catch (e) {
    showToast('Błąd aktualizacji ulubionych', 'error');
    return false;
  }
}

// ============================================================
// BLOKOWANIE I USUNIĘCIE PROFILU Z PROGRAMU
// ============================================================
async function blockModel(username) {
  if (!username || username.toLowerCase() === 'model') return;

  const norm = username.toLowerCase().replace(/[^a-z0-9]/g, '');

  // 1. Natychmiastowe zniknięcie kafelków z widoku (0 ms dla użytkownika)
  let visibleCount = 0;
  document.querySelectorAll('.video-card').forEach(c => {
    const link = c.querySelector('.model-profile-link');
    if (link) {
      const u = (link.dataset.username || '').toLowerCase().replace(/[^a-z0-9]/g, '');
      if (u === norm) {
        visibleCount++;
        c.style.transition = 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)';
        c.style.opacity = '0';
        c.style.transform = 'scale(0.85)';
        setTimeout(() => c.remove(), 250);
      }
    }
  });

  // 2. Jeśli odtwarzacz wideo jest otwarty z tą modelką, natychmiast go zamknij
  if (state.currentVideoDetails && (state.currentVideoDetails.username || '').toLowerCase().replace(/[^a-z0-9]/g, '') === norm) {
    closeModal();
  }

  // 3. Wstępny toast informujący o usuwaniu
  const progressToast = showToast(`Usuwanie profilu "${username}"...`, 'info');

  // 4. Wywołanie API (serwer zlicza usunięte filmy i odpowiada w ułamku sekundy)
  try {
    const url = `/api/model/${encodeURIComponent(username)}/block?count=${visibleCount}`;
    const res = await fetch(url, { method: 'POST' });
    const data = await res.json();
    if (data && data.success) {
      const removedVids = data.removed_videos || visibleCount || 0;
      const msg = removedVids > 0
        ? `Profil "${username}" zablokowany. Usunięto ${removedVids.toLocaleString('pl-PL')} filmów z katalogu.`
        : `Profil "${username}" został usunięty i zablokowany w całym programie.`;
      
      showToast(msg, 'success', progressToast);

      // Zaktualizuj liczniki w statystykach konta i strony głównej
      updateBlockedModelsCount();
      updateHomeStats();

      // Jeśli jesteśmy na stronie głównej, płynnie uzupełnij brakujące kafelki w tle do pełnych 280
      if (state.mode === 'home') {
        setTimeout(async () => {
          try {
            const src = encodeURIComponent(state.sourceFilter || 'all');
            const af = encodeURIComponent(state.authorFilter || 'all');
            const refreshUrl = `/api/videos?page=${state.currentPage}&source=${src}&author_filter=${af}&force_refresh=true`;
            const freshData = await ArchivebateAPI.getJSON(refreshUrl, { timeoutMs: 20000 });
            if (freshData && Array.isArray(freshData.videos)) {
              state.videos = deduplicateVideos(freshData.videos);
              renderVideoGrid(state.videos);
              dom.videoCount.innerText = `${state.videos.length} na stronie • 70 000 w katalogu (strona ${state.currentPage} z ${state.lastPage}) • 5.5M+ w serwisach`;
              if (dom.statPageVideos) dom.statPageVideos.innerText = `${state.videos.length}`;
            }
          } catch (e) {}
        }, 350);
      }
    } else {
      showToast(`Nie udało się zablokować profilu "${username}".`, 'error', progressToast);
    }
  } catch (err) {
    console.error('Błąd blokowania modelki:', err);
    showToast('Błąd sieciowy podczas blokowania profilu.', 'error', progressToast);
  }
}

async function unblockModel(username) {
  try {
    const res = await fetch(`/api/model/${encodeURIComponent(username)}/unblock`, { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      showToast(`Odblokowano profil "${username}". Będzie teraz ponownie widoczny w programie.`, 'success');
      updateBlockedModelsCount();
    }
  } catch (e) {
    showToast('Błąd odblokowywania profilu', 'error');
  }
}

async function updateBlockedModelsCount() {
  try {
    const res = await fetch('/api/blocked_models');
    const data = await res.json();
    const count = (data.blocked_models || []).length;
    const totalVids = data.blocked_videos_total || 0;
    if (dom.statBlockedCount) dom.statBlockedCount.innerText = count;
    const subEl = document.getElementById('statBlockedVideosSub');
    if (subEl) {
      subEl.innerText = `usunięto ${totalVids.toLocaleString('pl-PL')} filmów`;
    }
  } catch (e) {}
}

async function showBlockedModelsManager() {
  try {
    const res = await fetch('/api/blocked_models');
    const data = await res.json();
    const blocked = data.blocked_models || [];
    if (blocked.length === 0) {
      alert('Nie masz obecnie żadnych zablokowanych profili.');
      return;
    }
    const totalVids = data.blocked_videos_total || 0;
    const counts = data.blocked_model_video_counts || {};

    const formattedList = blocked.map(b => {
      const norm = b.toLowerCase().replace(/[^a-z0-9]/g, '');
      const cnt = counts[norm] || 0;
      return cnt > 0 ? `${b} (${cnt.toLocaleString('pl-PL')} filmów)` : b;
    }).join('\n• ');

    const unblockTarget = prompt(
      `Aktualnie zablokowane profile (${blocked.length} autorów, łącznie usunięto ${totalVids.toLocaleString('pl-PL')} filmów):\n\n• ` +
      formattedList +
      `\n\nWpisz nazwę profilu, który chcesz ODBLOKOWAĆ (lub zostaw puste i Anuluj):`
    );
    if (unblockTarget && unblockTarget.trim()) {
      await unblockModel(unblockTarget.trim());
    }
  } catch (e) {
    showToast('Błąd pobierania listy zablokowanych profili', 'error');
  }
}

function updateModalFavButton(isFav) {
  if (isFav) {
    dom.modalFavBtn.classList.add('active');
    dom.modalFavBtn.innerHTML = '<i class="fa-solid fa-heart" style="color:#ef4444;"></i> Usuń z ulubionych';
  } else {
    dom.modalFavBtn.classList.remove('active');
    dom.modalFavBtn.innerHTML = '<i class="fa-regular fa-heart"></i> Dodaj do ulubionych';
  }
  const currU = String(state.currentVideoDetails?.username || '').toLowerCase().trim();
  const isModelFav = state.favoriteAuthors && state.favoriteAuthors.has(currU);
  const shouldHighlight = isFav || isModelFav;
  const modalContent = dom.videoModal?.querySelector('.modal-content');
  if (modalContent) {
    if (shouldHighlight) modalContent.classList.add('is-favorite-modal');
    else modalContent.classList.remove('is-favorite-modal');
  }
}

// TAGI
async function initTags() {
  try {
    const res = await fetch('/api/tags');
    const data = await res.json();
    const tags = data.tags || [];

    tags.forEach(t => {
      const pill = document.createElement('div');
      pill.className = 'tag-pill';
      pill.innerText = `#${t.name}`;
      pill.dataset.tag = t.tag;

      // Inteligentne podgrzanie w tle po najechaniu kursorem (błyskawiczne otwarcie po kliknięciu)
      pill.addEventListener('mouseenter', () => {
        fetch(`/api/search?q=${encodeURIComponent(t.tag)}&page=1`).catch(() => {});
      });

      pill.addEventListener('click', () => {
        document.querySelectorAll('.tag-pill').forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        dom.searchInput.value = `#${t.tag}`;
        dom.clearSearchBtn.style.display = 'flex';
        setActiveNavTab(null);
        performSearch(t.tag, 1);
      });
      dom.tagsContainer.appendChild(pill);
    });
  } catch (e) {
    console.error('Błąd pobierania tagów:', e);
  }
}

// INTELIGENTNE POBIERANIE W TLE KOLEJNEJ STRONY (PREFETCH)
function prefetchNextPage() {
  setTimeout(() => {
    const nextPage = state.currentPage + 1;
    if (nextPage > (state.lastPage || 100)) return;
    let url = '';
    if (state.mode === 'home') {
      const src = encodeURIComponent(state.sourceFilter || 'all');
      const af = encodeURIComponent(state.authorFilter || 'all');
      url = `/api/videos?page=${nextPage}&source=${src}&author_filter=${af}`;
    }
    else if (state.mode === 'search' && state.currentSearchQuery) url = `/api/search?q=${encodeURIComponent(state.currentSearchQuery)}&page=${nextPage}`;
    else if (state.mode === 'favorites') url = `/api/account/favorites?page=${nextPage}&per_page=280`;
    else if (state.mode === 'history') url = `/api/account/history?page=${nextPage}&per_page=280`;
    else if (state.mode === 'model' && state.currentModel) url = `/api/model/${encodeURIComponent(state.currentModel)}?page=${nextPage}`;

    if (url) {
      // Prefetch kolejnej strony + pierwszych miniaturek. Dzięki temu przejście dalej
      // zwykle trafia już w cache SSD/RAM zamiast czekać na zewnętrzne CDN-y.
      ArchivebateAPI.getJSON(url, { timeoutMs: 15000 })
        .then(data => {
          const upcoming = Array.isArray(data?.videos) ? data.videos : [];
          const urls = upcoming.slice(0, 32).map(thumbnailUrlForVideo).filter(Boolean);
          return ArchivebatePerf.prefetchUrls(urls, { concurrency: 3 });
        })
        .catch(() => {});
    }
  }, 1200);
}

// ŁADOWANIE FILMÓW ZE STRONY GŁÓWNEJ (STAŁE 280 FILMÓW NA STRONĘ BEZ DUPLIKATÓW)
async function loadHomeVideos(page = 1) {
  if (state.isLoading) return;
  state.isLoading = true;
  state.mode = 'home';
  if (page > 250) page = 250;
  state.currentPage = page;
  state.lastPage = 250;

  showSkeletons();
  dom.accountPanelView.style.display = 'none';
  dom.tagsSection.style.display = 'block';
  if (dom.homeStatsBar) dom.homeStatsBar.style.display = 'grid';
  dom.contentHeader.style.display = 'flex';

  let filterTitle = 'Najnowsze wideo';
  if (state.sourceFilter === 'only-camwhores') filterTitle += ' • Tylko Camwhores';
  else if (state.sourceFilter === 'only-archivebate') filterTitle += ' • Tylko Archivebate';
  if (state.authorFilter === 'only_fav') filterTitle += ' • Tylko polubieni';
  else if (state.authorFilter === 'exclude_fav') filterTitle += ' • Bez polubionych';

  dom.viewTitle.innerText = filterTitle;
  dom.resetFilterBtn.style.display = 'none';
  dom.matchedProfiles.style.display = 'none';
  dom.pageJumpInput.value = page;
  updateHomeStats();

  try {
    const src = encodeURIComponent(state.sourceFilter || 'all');
    const af = encodeURIComponent(state.authorFilter || 'all');
    const data = await ArchivebateAPI.getJSON(`/api/videos?page=${page}&source=${src}&author_filter=${af}`, { timeoutMs: 25000 });
    state.videos = deduplicateVideos(data.videos || []);
    state.lastPage = data.last_page || 250;

    renderVideoGrid(state.videos);
    scheduleThumbnailWarmup(state.videos);
    dom.videoCount.innerText = `${state.videos.length} na stronie • 70 000 w katalogu (strona ${page} z ${state.lastPage}) • 5.5M+ w serwisach`;
    if (dom.statPageVideos) {
      dom.statPageVideos.innerText = `${state.videos.length}`;
    }
    renderPagination();
    prefetchNextPage();
  } catch (e) {
    showToast(e?.message || 'Błąd podczas pobierania filmów', 'error');
  } finally {
    state.isLoading = false;
  }
}

// ZAKŁADKA: ULUBIONE Z PAGINACJĄ (280 FILMÓW)
async function loadFavorites(page = 1) {
  state.mode = 'favorites';
  state.currentPage = page;

  showSkeletons();
  dom.accountPanelView.style.display = 'none';
  dom.tagsSection.style.display = 'none';
  if (dom.homeStatsBar) dom.homeStatsBar.style.display = 'none';
  dom.contentHeader.style.display = 'flex';
  dom.resetFilterBtn.style.display = 'flex';
  dom.matchedProfiles.style.display = 'none';
  dom.pageJumpInput.value = page;

  try {
    const data = await ArchivebateAPI.getJSON(`/api/account/favorites?page=${page}&per_page=280`, { timeoutMs: 12000 });
    state.videos = data.videos || [];
    state.lastPage = data.last_page || 1;

    dom.viewTitle.innerText = `❤️ Moje Ulubione Filmy (Strona ${page} z ${state.lastPage})`;
    renderVideoGrid(state.videos);
    scheduleThumbnailWarmup(state.videos);
    dom.videoCount.innerText = `${state.videos.length} na stronie • Łącznie: ${data.total || state.videos.length} w ulubionych`;

    if (state.lastPage > 1 || state.videos.length > 0) {
      dom.paginationSection.style.display = 'flex';
      renderPagination();
      prefetchNextPage();
    } else {
      dom.paginationSection.style.display = 'none';
    }

    if (state.videos.length === 0) {
      dom.videoGrid.innerHTML = `
        <div class="empty-state" style="grid-column: 1 / -1;">
          <div class="empty-state-icon"><i class="fa-regular fa-heart"></i></div>
          <h3>Brak ulubionych filmów</h3>
          <p>Kliknij serduszko na dowolnym wideo lub kliknij "Synchronizuj z Archivebate" w Panelu Konta.</p>
        </div>
      `;
    }
  } catch (e) {
    showToast(e?.message || 'Błąd ładowania ulubionych', 'error');
  }
}

// ZAKŁADKA: HISTORIA Z PAGINACJĄ
async function loadHistory(page = 1) {
  state.mode = 'history';
  state.currentPage = page;

  showSkeletons();
  dom.accountPanelView.style.display = 'none';
  dom.tagsSection.style.display = 'none';
  if (dom.homeStatsBar) dom.homeStatsBar.style.display = 'none';
  dom.contentHeader.style.display = 'flex';
  dom.resetFilterBtn.style.display = 'flex';
  dom.matchedProfiles.style.display = 'none';
  dom.pageJumpInput.value = page;

  try {
    const data = await ArchivebateAPI.getJSON(`/api/account/history?page=${page}&per_page=280`, { timeoutMs: 12000 });
    state.videos = data.videos || [];
    state.lastPage = data.last_page || 1;

    dom.viewTitle.innerText = `🕒 Historia Oglądania (Strona ${page} z ${state.lastPage})`;
    renderVideoGrid(state.videos);
    scheduleThumbnailWarmup(state.videos);
    dom.videoCount.innerText = `${state.videos.length} na stronie • Łącznie: ${data.total || state.videos.length} w historii`;

    if (state.lastPage > 1 || state.videos.length > 0) {
      dom.paginationSection.style.display = 'flex';
      renderPagination();
      prefetchNextPage();
    } else {
      dom.paginationSection.style.display = 'none';
    }

    if (state.videos.length === 0) {
      dom.videoGrid.innerHTML = `
        <div class="empty-state" style="grid-column: 1 / -1;">
          <div class="empty-state-icon"><i class="fa-solid fa-clock-rotate-left"></i></div>
          <h3>Brak historii oglądania</h3>
          <p>Obejrzane filmy będą automatycznie zapisywać się w tym miejscu.</p>
        </div>
      `;
    }
  } catch (e) {
    showToast(e?.message || 'Błąd ładowania historii', 'error');
  }
}

// ZAKŁADKA: OBSERWOWANE Z PAGINACJĄ (280 FILMÓW)
async function loadFollowing(page = 1) {
  state.mode = 'following';
  state.currentPage = page;

  showSkeletons();
  dom.accountPanelView.style.display = 'none';
  dom.tagsSection.style.display = 'none';
  if (dom.homeStatsBar) dom.homeStatsBar.style.display = 'none';
  dom.contentHeader.style.display = 'flex';
  dom.resetFilterBtn.style.display = 'flex';
  dom.matchedProfiles.style.display = 'none';
  dom.pageJumpInput.value = page;

  try {
    const data = await ArchivebateAPI.getJSON(`/api/account/following?page=${page}&per_page=280`, { timeoutMs: 12000 });
    state.videos = data.videos || [];
    state.lastPage = data.last_page || 1;

    dom.viewTitle.innerText = `👥 Filmy z Obserwowanych (Strona ${page} z ${state.lastPage})`;
    renderVideoGrid(state.videos);
    scheduleThumbnailWarmup(state.videos);
    dom.videoCount.innerText = `${data.total || state.videos.length} wideo`;

    if (state.lastPage > 1 || state.videos.length > 0) {
      dom.paginationSection.style.display = 'flex';
      renderPagination();
    } else {
      dom.paginationSection.style.display = 'none';
    }

    if (state.videos.length === 0) {
      dom.videoGrid.innerHTML = `
        <div class="empty-state" style="grid-column: 1 / -1;">
          <div class="empty-state-icon"><i class="fa-solid fa-user-group"></i></div>
          <h3>Brak filmów z obserwowanych</h3>
          <p>Użyj przycisku 'Synchronizuj z Archivebate' w Panelu Konta, aby pobrać listę z serwisu.</p>
        </div>
      `;
    }
  } catch (e) {
    showToast(e?.message || 'Błąd ładowania obserwowanych', 'error');
  }
}

// ZAKŁADKA: PANEL KONTA
function showAccountPanel() {
  state.mode = 'account';
  dom.accountPanelView.style.display = 'block';
  dom.tagsSection.style.display = 'none';
  if (dom.homeStatsBar) dom.homeStatsBar.style.display = 'none';
  dom.contentHeader.style.display = 'none';
  dom.matchedProfiles.style.display = 'none';
  dom.videoGrid.innerHTML = '';
  dom.paginationSection.style.display = 'none';
  initUserStatus();
}

// WYSZUKIWANIE PO TAGU / FRAZIE ZE STRUMIENIOWANIEM W CZASIE RZECZYWISTYM ("PO KOLEI")
async function performSearch(query, page = 1) {
  if (state.activeSearchSource) {
    state.activeSearchSource.close();
    state.activeSearchSource = null;
  }

  state.mode = 'search';
  state.currentQuery = query;
  state.currentPage = page;

  const isTag = query.startsWith('#') || document.querySelector(`.tag-pill[data-tag="${query.replace('#','').toLowerCase()}"]`) !== null;
  const cleanTagName = query.replace('#', '').trim();

  dom.accountPanelView.style.display = 'none';
  dom.tagsSection.style.display = 'block';
  if (dom.homeStatsBar) dom.homeStatsBar.style.display = 'none';
  dom.contentHeader.style.display = 'flex';
  dom.viewTitle.innerText = isTag ? `🏷️ Tag: #${cleanTagName} — Najnowsze wideo (Strona ${page})` : `Wyniki dla: "${query}" (Strona ${page})`;
  dom.resetFilterBtn.style.display = 'flex';
  dom.pageJumpInput.value = page;

  // Dla kolejnych stron (page > 1) pobieramy błyskawicznie z pamięci RAM (cache)
  if (page > 1) {
    showSkeletons();
    state.isLoading = true;
    if (dom.paginationSection) dom.paginationSection.style.display = 'flex';
    try {
      const data = await ArchivebateAPI.getJSON(`/api/search?q=${encodeURIComponent(query)}&page=${page}`, { timeoutMs: 15000 });
      state.lastPage = data.last_page || 1;
      state.videos = data.videos || [];
      renderVideoGrid(state.videos);
      scheduleThumbnailWarmup(state.videos);
      renderPagination();
      dom.videoCount.innerText = `${state.videos.length} na stronie • Strona ${page} z ${state.lastPage} • Łącznie: ${data.total_videos} filmów • 5.5M+ w serwisach`;
    } catch (e) {
      showToast(e?.message || 'Błąd ładowania strony wyników', 'error');
    } finally {
      state.isLoading = false;
    }
    return;
  }

  // DLA STRONY 1: STRUMIENIOWANIE "PO KOLEI" W CZASIE RZECZYWISTYM (ZERO CZEKANIA!)
  dom.videoGrid.innerHTML = '';
  showSkeletons();
  dom.matchedProfiles.style.display = 'none';
  dom.profilesList.innerHTML = '';
  dom.videoCount.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Pobieranie najnowszych wideo...`;

  let accumulatedVideos = [];
  let isFirstBatch = true;

  const evtSource = new EventSource(`/api/search/stream?q=${encodeURIComponent(query)}`);
  state.activeSearchSource = evtSource;

  evtSource.onmessage = (event) => {
    try {
      const payload = JSON.parse(event.data);

      if (payload.type === 'profiles') {
        const profiles = payload.profiles || [];
        if (profiles.length > 0 && !isTag) {
          dom.matchedProfiles.style.display = 'block';
          dom.profilesList.innerHTML = '';
          profiles.forEach(p => {
            const chip = document.createElement('div');
            chip.className = 'profile-chip';
            chip.innerHTML = `
              <div class="profile-chip-avatar">${(p.username || 'M').substring(0, 2).toUpperCase()}</div>
              <div>
                <div class="profile-chip-name">${p.username}</div>
                <div class="profile-chip-meta">${p.platform || 'Cam'} ${p.gender ? '• ' + p.gender : ''}</div>
              </div>
            `;
            chip.addEventListener('click', () => loadModelVideos(p.username, 1));
            dom.profilesList.appendChild(chip);
          });
        }
        dom.videoCount.innerText = `Znaleziono ${payload.total_profiles || profiles.length} profili. Pobieranie nagrań...`;
      } else if (payload.type === 'videos') {
        const newVids = payload.videos || [];
        if (newVids.length > 0) {
          if (isFirstBatch) {
            dom.videoGrid.innerHTML = '';
            isFirstBatch = false;
          }
          accumulatedVideos = accumulatedVideos.concat(newVids);
          state.videos = accumulatedVideos;

          appendVideoBatch(newVids);
          state.lastPage = Math.max(state.lastPage || 1, Math.ceil(accumulatedVideos.length / 360));
          renderPagination();
          dom.videoCount.innerText = `Znaleziono ${accumulatedVideos.length} filmów (wyszukiwanie trwa...)`;
        }
      } else if (payload.type === 'done') {
        evtSource.close();
        state.activeSearchSource = null;

        if (accumulatedVideos.length === 0) {
          dom.videoGrid.innerHTML = `
            <div class="empty-state" style="grid-column: 1 / -1;">
              <div class="empty-state-icon"><i class="fa-solid fa-film"></i></div>
              <h3>Nie znaleziono filmów dla "${query}"</h3>
              <p>Spróbuj użyć innego tagu, nazwy modelki lub platformy.</p>
            </div>
          `;
          dom.videoCount.innerText = '0 filmów';
        } else {
          if (payload.all_sorted_videos && payload.all_sorted_videos.length > 0) {
            accumulatedVideos = payload.all_sorted_videos;
            state.videos = accumulatedVideos;
            renderVideoGrid(state.videos);
            scheduleThumbnailWarmup(state.videos);
          }
          const totalCount = payload.total_videos || accumulatedVideos.length;
          state.lastPage = payload.last_page || Math.ceil(totalCount / 360) || 1;
          dom.videoCount.innerText = `${accumulatedVideos.length} na stronie • Łącznie: ${totalCount} filmów • 5.5M+ w serwisach`;
          renderPagination();
        }
      }
    } catch (err) {
      console.error('Błąd SSE:', err);
    }
  };

  evtSource.onerror = () => {
    evtSource.close();
    state.activeSearchSource = null;
    renderPagination();
  };
}

// FILMY DANEJ MODELKI
async function loadModelVideos(username, page = 1) {
  if (state.isLoading) return;
  state.isLoading = true;
  state.mode = 'model';
  state.currentModel = username;
  state.currentPage = page;

  showSkeletons();
  dom.accountPanelView.style.display = 'none';
  dom.tagsSection.style.display = 'block';
  if (dom.homeStatsBar) dom.homeStatsBar.style.display = 'none';
  dom.contentHeader.style.display = 'flex';
  dom.viewTitle.innerText = `Filmy modelki: ${username} (Strona ${page})`;
  dom.resetFilterBtn.style.display = 'flex';
  dom.matchedProfiles.style.display = 'none';
  dom.paginationSection.style.display = 'flex';
  dom.pageJumpInput.value = page;

  try {
    const data = await ArchivebateAPI.getJSON(`/api/model/${encodeURIComponent(username)}?page=${page}`, { timeoutMs: 15000 });
    state.videos = data.videos || [];

    if (data.last_page) {
      state.lastPage = Math.max(1, Number(data.last_page) || 1);
    } else if (state.videos.length === 0 && page > 1) {
      state.lastPage = page - 1;
    } else if (!state.lastPage) {
      state.lastPage = 1;
    }

    renderVideoGrid(state.videos);
    scheduleThumbnailWarmup(state.videos);
    const totalCount = Number(data.total_videos) || state.videos.length;
    const totalStr = totalCount > 0 ? ` • Łącznie: ${totalCount.toLocaleString('pl-PL')} filmów` : '';
    dom.videoCount.innerText = `${state.videos.length} na stronie${totalStr} • Modelka: ${username} • 5.5M+ w serwisach`;
    
    renderPagination();
    prefetchNextPage();
  } catch (e) {
    showToast(e?.message || `Błąd ładowania filmów dla ${username}`, 'error');
  } finally {
    state.isLoading = false;
  }
}

function resetToHome() {
  document.querySelectorAll('.tag-pill').forEach(p => p.classList.remove('active'));
  setActiveNavTab(dom.navHomeBtn);
  loadHomeVideos(1);
}

// RENDEROWANIE PAGINACJI
function renderPagination() {
  const current = state.currentPage;
  const maxP = state.lastPage || 1;

  if (dom.paginationSection) {
    dom.paginationSection.style.display = 'flex';
  }

  dom.prevPageBtn.disabled = current <= 1;
  dom.nextPageBtn.disabled = current >= maxP;
  dom.pageNumbersList.innerHTML = '';

  // Obsługa przycisku "Ostatnia (liczba stron)"
  if (dom.lastPageBtn && dom.lastPageNumber) {
    dom.lastPageNumber.innerText = maxP.toLocaleString('pl-PL');
    dom.lastPageBtn.disabled = current >= maxP;
    dom.lastPageBtn.onclick = () => changePage(maxP);
  }

  if (dom.pageJumpInput) {
    dom.pageJumpInput.max = maxP;
  }

  const startPage = Math.max(1, current - 2);
  const endPage = Math.min(maxP, startPage + 4);

  if (startPage > 1) {
    addPageButton(1);
    if (startPage > 2) {
      const dots = document.createElement('span');
      dots.className = 'page-num-dots';
      dots.innerText = '...';
      dom.pageNumbersList.appendChild(dots);
    }
  }

  for (let p = startPage; p <= endPage; p++) {
    addPageButton(p);
  }

  if (endPage < maxP) {
    const dotsEnd = document.createElement('span');
    dotsEnd.className = 'page-num-dots';
    dotsEnd.innerText = '...';
    dom.pageNumbersList.appendChild(dotsEnd);
    addPageButton(maxP);
  }

  function addPageButton(pageNumber) {
    const btn = document.createElement('button');
    btn.className = 'page-num-btn';
    if (pageNumber === current) btn.classList.add('active');
    btn.innerText = pageNumber.toLocaleString('pl-PL');
    btn.addEventListener('click', () => changePage(pageNumber));
    dom.pageNumbersList.appendChild(btn);
  }
}

// Pamięć podręczna detali wideo dla natychmiastowego startu po kliknięciu
const videoDetailsCache = new ArchivebatePerf.LRUCache(180);

// Miniatury poza viewportem nie powinny konkurować o łącze z tymi, które użytkownik
// widzi. Ładujemy je dopiero gdy zbliżą się do ekranu.
const lazyThumbObserver = ('IntersectionObserver' in window)
  ? new IntersectionObserver((entries, observer) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const img = entry.target;
        if (img.dataset.src && !img.hasAttribute('src')) {
          img.src = img.dataset.src;
          delete img.dataset.src;
        }
        observer.unobserve(img);
      }
    }, { rootMargin: '1000px 0px', threshold: 0.01 })
  : null;

function armLazyThumbnail(img) {
  if (!img || !img.dataset.src) return;
  if (lazyThumbObserver) {
    lazyThumbObserver.observe(img);
  } else {
    img.src = img.dataset.src;
    delete img.dataset.src;
  }
}

const videoDetailsInflight = new Map();
const MAX_CONCURRENT_PREFETCH = 2;
function prefetchVideoDetails(videoId) {
  if (!videoId) return Promise.resolve(null);
  const cached = videoDetailsCache.get(videoId);
  if (cached) return Promise.resolve(cached);
  if (videoDetailsInflight.has(videoId)) return videoDetailsInflight.get(videoId);
  if (videoDetailsInflight.size >= MAX_CONCURRENT_PREFETCH) return Promise.resolve(null);
  const promise = ArchivebateAPI.getJSON(`/api/video/details?id=${encodeURIComponent(videoId)}`, { timeoutMs: 9000 })
    .then(details => {
      videoDetailsCache.set(videoId, details);
      return details;
    })
    .catch(() => null)
    .finally(() => videoDetailsInflight.delete(videoId));
  videoDetailsInflight.set(videoId, promise);
  return promise;
}

function thumbnailUrlForVideo(v) {
  if (!v) return '';
  return v.poster_proxy || v.thumbnail_proxy || (v.poster ? `/api/thumb?url=${encodeURIComponent(v.poster)}` : '');
}

let thumbnailWarmupController = null;
function scheduleThumbnailWarmup(videos, start = 12, count = 60) {
  if (!Array.isArray(videos) || videos.length <= start) return;
  if (thumbnailWarmupController) thumbnailWarmupController.abort();
  thumbnailWarmupController = new AbortController();
  const urls = videos.slice(start, start + count).map(thumbnailUrlForVideo).filter(Boolean);
  ArchivebatePerf.idle(() => {
    ArchivebatePerf.prefetchUrls(urls, { concurrency: 4, signal: thumbnailWarmupController.signal }).catch(() => {});
  }, 700);
}

function createVideoCard(v, idx) {
  const isCamwhores = v.source === 'camwhores' || String(v.id).startsWith('cw_') || (v.platform && v.platform.toLowerCase().includes('camwhores'));
  const isFav = !!v.is_favorite;
  const isFavAuthor = isFavoriteAuthor(v.username) || v.has_favorite_video;
  const isFavCard = isFav || isFavAuthor;

  const card = document.createElement('div');
  card.className = `video-card ${isFavCard ? 'is-favorite-card' : ''}`;
  card.dataset.videoId = String(v.id);
  card.dataset.username = String(v.username || '').toLowerCase().trim();
  card.dataset.source = isCamwhores ? 'camwhores' : 'archivebate';
  card._videoData = v;
  if (v.id) state.videoById.set(String(v.id), v);

  // Do wyświetlania preferujemy lokalne proxy: po pierwszym pobraniu trafia ono do
  // RAM/dysku i kolejne wejścia są praktycznie natychmiastowe. Oryginalny CDN
  // zostaje jako awaryjny fallback i do wyliczania ścieżek storyboardu.
  const directPoster = v.poster_direct || (v.poster ? v.poster.replace(/\.mp4$/, '.jpg') : '');
  const fallbackPoster = v.poster_proxy || v.thumbnail_proxy || (v.poster ? `/api/thumb?url=${encodeURIComponent(v.poster)}` : '');
  const posterUrl = directPoster || fallbackPoster;
  const displayPoster = directPoster || fallbackPoster;
  const backupPoster = fallbackPoster;

  // Tylko pierwsze widoczne kafelki są pobierane natychmiast. Nadanie HIGH 24 obrazom
  // naraz powodowało, że wszystkie walczyły o transfer i pierwszy ekran pojawiał się wolniej.
  const eagerThumb = idx < 12;
  const thumbLoadAttrs = eagerThumb
    ? `src="${displayPoster}" loading="eager" fetchpriority="${idx < 6 ? 'high' : 'auto'}"`
    : `data-src="${displayPoster}" loading="lazy" fetchpriority="low"`;

  card.innerHTML = `
    <div class="thumbnail-wrapper">
      <img class="thumbnail-img" ${thumbLoadAttrs} data-fallback="${backupPoster || ''}" alt="${v.username}" decoding="async">
      ${isCamwhores ? `<img class="hover-preview-frame" style="display: none; position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; z-index: 2; pointer-events: none;" alt="Preview">` : ''}
      <video class="hover-preview-video" muted playsinline preload="none"></video>
      
      <!-- Oś czasu do przeglądania klatek w miniaturce kursorem (zawsze rzeczywista sekunda filmu) -->
      <div class="card-scrub-bar">
        <div class="card-scrub-tooltip">00:00</div>
        <div class="card-scrub-progress"></div>
        <div class="card-scrub-thumb"></div>
      </div>

      <span class="badge-platform ${isCamwhores ? 'badge-camwhores' : ''}">${isCamwhores ? '<i class="fa-solid fa-tv"></i> Camwhores' : (v.platform || 'Archive')}</span>
      ${v.views ? `<span class="badge-views"><i class="fa-solid fa-eye"></i> ${v.views}</span>` : ''}
      ${v.duration && v.duration !== 'N/A' ? `<span class="badge-duration">${v.duration}</span>` : ''}
      
      <!-- Szybki przycisk ulubione -->
      <button class="card-fav-btn ${isFav ? 'active' : ''}" title="${isFav ? 'Usuń z ulubionych' : 'Dodaj do ulubionych'}">
        <i class="${isFav ? 'fa-solid' : 'fa-regular'} fa-heart"></i>
      </button>
    </div>

    <div class="card-details">
      <div class="card-header-info">
        <a href="#" class="model-profile-link ${(isFavoriteAuthor(v.username) || v.has_favorite_video) ? 'is-favorite-author' : ''}" data-username="${v.username}">
          <i class="fa-solid fa-circle-user"></i> ${v.username}${(isFavoriteAuthor(v.username) || v.has_favorite_video) ? '<i class="fa-solid fa-star fav-author-star" title="Masz film tej modelki w ulubionych"></i>' : ''}
        </a>
        <span class="card-date-badge" data-video-id="${v.id}" title="Kliknij na datę, aby ustawić punkt kontrolny (checkpoint)"><i class="fa-regular fa-calendar-days"></i> ${v.date || 'Niedawno'}</span>
      </div>

      <div class="card-tags-row">
        ${(v.tags || []).slice(0, 3).map(t => `<span class="card-tag-badge" data-tag="${t.toLowerCase()}">#${t}</span>`).join('')}
      </div>

      <div class="card-actions-row">
        <button class="btn-card primary play-btn">
          <i class="fa-solid fa-play"></i> Odtwórz
        </button>
        <button class="btn-card profile-btn" data-username="${v.username}" title="Zobacz nagrania modelki">
          <i class="fa-solid fa-folder"></i> Filmy
        </button>
        <button class="btn-card danger block-model-btn" data-username="${v.username}" title="Zablokuj modelkę: usuń ten profil z katalogu programu i ukryj wszystkie jej nagrania">
          <i class="fa-solid fa-ban"></i>
        </button>
      </div>
    </div>
  `;

  // Punkt kontrolny (checkpoint) - zachowaj oryginalną datę
  const dateBadge = card.querySelector('.card-date-badge');
  if (dateBadge) {
    dateBadge.dataset.origDate = v.date || 'Niedawno';
  }

  // Płynny podgląd wideo po najechaniu myszką + natychmiastowe przeglądanie osią czasu kursorem
  const cardThumbImg = card.querySelector('.thumbnail-img');
  if (cardThumbImg) {
    cardThumbImg.addEventListener('error', () => {
      const backup = cardThumbImg.dataset.fallback;
      if (!cardThumbImg.dataset.retried && backup) {
        cardThumbImg.dataset.retried = '1';
        cardThumbImg.src = backup;
      }
    });
    if (!eagerThumb) armLazyThumbnail(cardThumbImg);
  }

  const thumbWrapper = card.querySelector('.thumbnail-wrapper');
  const hoverVideo = card.querySelector('.hover-preview-video');
  const hoverFrame = card.querySelector('.hover-preview-frame');
  const scrubProgress = card.querySelector('.card-scrub-progress');
  const scrubThumb = card.querySelector('.card-scrub-thumb');
  const scrubTooltip = card.querySelector('.card-scrub-tooltip');

  const timelinePrefix = v.timeline_prefix || (posterUrl && posterUrl.includes('/180x135/') ? posterUrl.substring(0, posterUrl.indexOf('/180x135/') + 9) : null);
  const timelineCount = v.timeline_count || 15;
  const durationSec = parseDurationToSeconds(v.duration);

  let isHovered = false;
  let pendingPos = null;
  let preloadedFrames = false;
  let isSeekingHover = false;
  let hoverSeekTimer = null;
  let storyboardWarmTimer = null;
  let cardStoryboard = null;
  let cardStoryboardLookupDone = !!timelinePrefix;
  let cardStoryboardLookupPending = false;

  function loadCachedCardStoryboard() {
    if (timelinePrefix || cardStoryboardLookupDone || cardStoryboardLookupPending || !v.id) return;
    cardStoryboardLookupPending = true;
    ArchivebateStoryboard.get(`video:${v.id}`).then(board => {
      cardStoryboard = board?.frames?.length ? board.frames : null;
    }).catch(() => {}).finally(() => {
      cardStoryboardLookupPending = false;
      cardStoryboardLookupDone = true;
      if (isHovered && pendingPos !== null) {
        const latest = pendingPos;
        pendingPos = null;
        doSeek(latest);
      }
    });
  }

  function preloadFrames() {
    if (preloadedFrames || !timelinePrefix) return;
    preloadedFrames = true;
    for (let i = 1; i <= Math.min(timelineCount, 40); i++) {
      const pImg = new Image();
      pImg.src = `${timelinePrefix}${i}.jpg`;
    }
  }

  function showCwFrame(pos) {
    if (!hoverFrame || !timelinePrefix) return;
    const frameIdx = Math.min(timelineCount, Math.max(1, Math.round(pos * (timelineCount - 1)) + 1));
    hoverFrame.src = `${timelinePrefix}${frameIdx}.jpg`;
    hoverFrame.style.display = 'block';
  }

  function showLocalStoryboardFrame(pos) {
    if (!hoverFrame || !Array.isArray(cardStoryboard) || !cardStoryboard.length) return false;
    const frameIdx = Math.min(cardStoryboard.length - 1, Math.max(0, Math.round(pos * (cardStoryboard.length - 1))));
    hoverFrame.src = cardStoryboard[frameIdx];
    hoverFrame.style.display = 'block';
    if (hoverVideo) hoverVideo.style.opacity = '0';
    return true;
  }

  function startVideoPreview() {
    if (!hoverVideo) return;
    if (hoverVideo.src) return;

    // Błyskawiczny lekki podgląd dla kafelka: v.preview_video (190 KB z CDN w 100ms)
    const previewSrc = v.preview_video || (v.id ? `/api/video/stream?id=${encodeURIComponent(v.id)}` : null);

    if (previewSrc) {
      hoverVideo.src = previewSrc;
      hoverVideo.preload = 'auto';
      hoverVideo.muted = true;
      hoverVideo.playsInline = true;
      hoverVideo.load();
    }
  }

  function doSeek(pos) {
    const totalDuration = durationSec || 0;
    const targetTime = pos * totalDuration;

    // RZECZYWISTE ODNIESIENIE DO SEKUNDY Z VIDEO (np. 14:20 z 24:47)
    if (scrubTooltip && totalDuration > 0) {
      scrubTooltip.innerText = formatPlayerTime(targetTime);
      scrubTooltip.style.left = `${pos * 100}%`;
      scrubTooltip.style.display = 'block';
    }

    // 1. Dla Camwhores - natychmiastowa klatka ze storyboardu z rzeczywistą sekundą (0 ms)
    if (timelinePrefix) {
      showCwFrame(pos);
      return;
    }

    // 2. Dla Archivebate - natychmiastowe przewijanie preview wideo (190 KB z CDN, 0 ms lag)
    startVideoPreview();
    if (!hoverVideo) return;

    try {
      const pDur = hoverVideo.duration || 3;
      hoverVideo.currentTime = Math.max(0, Math.min(pDur, pos * pDur));
      hoverVideo.style.opacity = '1';
      hoverVideo.style.display = 'block';
    } catch (e) {}
  }

  if (hoverVideo) {
    hoverVideo.addEventListener('error', () => {
      hoverVideo.style.display = 'none';
    });
  }

  let hoverPreviewTimer = null;
  let warmStreamTimer = null;

  function scheduleVideoPreview() {
    if (timelinePrefix) return; // Camwhores korzysta ze storyboardu klatek, nie potrzebuje streamu wideo!
    clearTimeout(hoverPreviewTimer);
    // B5: Opóźniamy start pobierania wideo preview do 600 ms stabilnego hovera,
    // aby przelotny ruch kursora nie obciążał łącza.
    hoverPreviewTimer = setTimeout(() => {
      if (isHovered) {
        startVideoPreview();
      }
    }, 600);
  }

  thumbWrapper.addEventListener('mouseenter', (e) => {
    isHovered = true;
    const detailsWarmPromise = prefetchVideoDetails(v.id);
    if (timelinePrefix) preloadFrames();
    else {
      loadCachedCardStoryboard();
      if (window.ArchivebateYouTubeStoryboard && v.id) {
        const durSec = parseDurationToSeconds(v.duration);
        if (durSec > 0) {
          clearTimeout(storyboardWarmTimer);
          storyboardWarmTimer = setTimeout(() => {
            if (isHovered) {
              ArchivebateYouTubeStoryboard.warm({ videoId: v.id, duration: durSec });
            }
          }, 1500);
        }
      }
      // B7: Connection prewarm po 250 ms stabilnego hover
      clearTimeout(warmStreamTimer);
      warmStreamTimer = setTimeout(() => {
        if (isHovered && v.id) {
          fetch(`/api/video/warm?id=${encodeURIComponent(v.id)}`, { method: 'POST' }).catch(() => {});
        }
      }, 250);
    }
    scheduleVideoPreview();

    const rect = thumbWrapper.getBoundingClientRect();
    const pos = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    if (scrubProgress) scrubProgress.style.width = `${pos * 100}%`;
    if (scrubThumb) scrubThumb.style.left = `${pos * 100}%`;
    doSeek(pos);
  });

  thumbWrapper.addEventListener('mousemove', (e) => {
    isHovered = true;
    const rect = thumbWrapper.getBoundingClientRect();
    const pos = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    if (scrubProgress) scrubProgress.style.width = `${pos * 100}%`;
    if (scrubThumb) scrubThumb.style.left = `${pos * 100}%`;
    doSeek(pos);
  });

  const abortHoverMedia = () => {
    isHovered = false;
    pendingPos = null;
    clearTimeout(hoverPreviewTimer);
    clearTimeout(hoverSeekTimer);
    clearTimeout(storyboardWarmTimer);
    clearTimeout(warmStreamTimer);
    isSeekingHover = false;
    if (hoverVideo) {
      try {
        hoverVideo.pause();
        hoverVideo.currentTime = 0;
        hoverVideo.style.opacity = '0';
        hoverVideo.removeAttribute('src');
        hoverVideo.load();
      } catch (_) {}
    }
    if (hoverFrame) hoverFrame.style.display = 'none';
  };

  thumbWrapper.addEventListener('mouseleave', () => {
    abortHoverMedia();
    if (scrubProgress) scrubProgress.style.width = '0%';
    if (scrubThumb) scrubThumb.style.left = '0%';
    if (scrubTooltip) scrubTooltip.style.display = 'none';
  });

  // B4: Na kliknięcie (pointerdown) natychmiast anuluj media preview dla tego card,
  // aby pełny film miał priorytet i nie konkurował o pasmo z podglądem hovera.
  thumbWrapper.addEventListener('pointerdown', (e) => {
    abortHoverMedia();
  }, { passive: true });

  let cardPrefetchTimer = null;
  card.addEventListener('pointerenter', () => {
    if (cardPrefetchTimer) clearTimeout(cardPrefetchTimer);
    cardPrefetchTimer = setTimeout(() => {
      prefetchVideoDetails(v.id);
    }, 120);
  }, { passive: true });

  card.addEventListener('pointerleave', () => {
    if (cardPrefetchTimer) {
      clearTimeout(cardPrefetchTimer);
      cardPrefetchTimer = null;
    }
  }, { passive: true });

  card.addEventListener('pointerdown', () => {
    if (cardPrefetchTimer) {
      clearTimeout(cardPrefetchTimer);
      cardPrefetchTimer = null;
    }
    abortHoverMedia();
    prefetchVideoDetails(v.id);
  }, { passive: true });

  return card;
}

// Pre-Render Gate: neutralny skeleton card bez atrybutu img src
function renderSkeletonCard(v, idx) {
  const card = document.createElement('div');
  card.className = 'skeleton-card';
  card.dataset.videoId = String(v.id);
  card._videoData = v;
  card.innerHTML = `
    <div class="skeleton-thumb"></div>
    <div class="skeleton-details">
      <div class="skeleton-line title"></div>
      <div class="skeleton-line tags"></div>
      <div class="skeleton-line actions"></div>
    </div>
  `;
  return card;
}

// Bounded Dynamic Backfill: uzupełnia brakujące kafelki w siatce po usunięciu martwych
let isBackfilling = false;
async function requestBackfill(neededCount) {
  if (isBackfilling || neededCount <= 0) return;
  if (state.mode !== 'home') return;
  isBackfilling = true;
  try {
    const visibleCards = Array.from(dom.videoGrid.querySelectorAll('.video-card, .skeleton-card'));
    const currentExcludeIds = visibleCards.map(c => c.dataset.videoId).filter(Boolean);
    const res = await fetch('/api/videos/backfill', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        page: state.currentPage,
        source: state.sourceFilter || 'all',
        author_filter: state.authorFilter || 'all',
        exclude_ids: currentExcludeIds,
        needed: Math.min(neededCount, 30)
      })
    });
    if (!res.ok) return;
    const data = await res.json();
    const newItems = data.videos || [];
    if (!newItems.length) return;

    const fragment = document.createDocumentFragment();
    const existingDomIds = new Set(
      Array.from(dom.videoGrid.querySelectorAll('.video-card, .skeleton-card'))
        .map(el => el.dataset.videoId)
        .filter(Boolean)
    );
    const unknownNew = [];
    let startIdx = dom.videoGrid.children.length;

    newItems.forEach((v) => {
      if (!v || !v.id) return;
      const vid = String(v.id);
      if (existingDomIds.has(vid) || (window._knownDeletedVideos && window._knownDeletedVideos.has(vid))) return;
      existingDomIds.add(vid);

      if (window._knownPlayableVideos && window._knownPlayableVideos.has(vid)) {
        fragment.appendChild(createVideoCard(v, startIdx++));
      } else {
        fragment.appendChild(renderSkeletonCard(v, startIdx++));
        unknownNew.push(v);
      }
    });

    if (fragment.childNodes.length > 0) {
      dom.videoGrid.appendChild(fragment);
    }

    // Waliduj nowe skeletony
    if (unknownNew.length && typeof window._validatePlayabilityBatchGlobal === 'function') {
      window._validatePlayabilityBatchGlobal(unknownNew);
    }
  } catch (err) {
    console.error('Błąd dynamicznego backfillu:', err);
  } finally {
    isBackfilling = false;
  }
}

// ELIMINACJA DUPLIKATÓW
function deduplicateVideos(videos) {
  if (!videos || !Array.isArray(videos)) return [];
  const seenIds = new Set();
  const seenUrls = new Set();
  const seenSignatures = new Set();
  const result = [];

  for (const v of videos) {
    if (!v || typeof v !== 'object') continue;
    const id = String(v.id || '').trim().toLowerCase();
    const url = String(v.url || '').trim().toLowerCase();
    const username = String(v.username || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const duration = String(v.duration || '').trim();

    if (id && seenIds.has(id)) continue;
    if (url && seenUrls.has(url)) continue;
    if (username && username !== 'model' && duration && duration !== 'N/A' && duration !== '00:00' && duration !== '0:00') {
      const sig = `${username}|${duration}`;
      if (seenSignatures.has(sig)) continue;
      seenSignatures.add(sig);
    }

    if (id) seenIds.add(id);
    if (url) seenUrls.add(url);
    result.push(v);
  }
  return result;
}

// RENDEROWANIE KAFELKÓW Z PRE-RENDER GATE
function renderVideoGrid(videos) {
  dom.videoGrid.innerHTML = '';
  state.videoById.clear();
  if (!videos || videos.length === 0) return;

  videos = deduplicateVideos(videos);

  // Filtrujemy filmy znane z pamięci podręcznej jako usunięte
  if (window._knownDeletedVideos && window._knownDeletedVideos.size > 0) {
    videos = videos.filter(v => v && v.id && !window._knownDeletedVideos.has(String(v.id)));
  }

  if (!window._knownDeletedVideos) window._knownDeletedVideos = new Set();
  if (!window._knownPlayableVideos) window._knownPlayableVideos = new Set();

  const isUserPersonalSection = (state.mode === 'favorites' || state.mode === 'history' || state.mode === 'following');

  // Pre-Render Gate:
  // Dla filmów ze znanym statusem playable renderujemy od razu createVideoCard.
  // Dla nieznanych Archivebate renderujemy neutralny skeleton-card (ZERO-FLASH miniatury!).
  const renderItemCard = (v, idx) => {
    const vid = String(v.id);
    const isCw = v.source === 'camwhores' || vid.startsWith('cw_');
    if (isUserPersonalSection || isCw || window._knownPlayableVideos.has(vid)) {
      return createVideoCard(v, idx);
    }
    return renderSkeletonCard(v, idx);
  };

  const validatePlayabilityBatch = (items) => {
    if (!items || !items.length) return;
    const ids = items
      .map(v => String(v.id))
      .filter(id => id && !id.startsWith('cw_') && !window._knownDeletedVideos.has(id) && !window._knownPlayableVideos.has(id));
    if (!ids.length) return;

    fetch('/api/video/playability/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: ids.slice(0, 50) })
    }).then(r => r.json()).then(data => {
      if (data && data.results) {
        let deletedCount = 0;
        Object.entries(data.results).forEach(([id, status]) => {
          const skeletonEl = dom.videoGrid.querySelector(`.skeleton-card[data-video-id="${id}"]`);
          if (status === 'deleted' || status === 'unavailable') {
            window._knownDeletedVideos.add(String(id));
            if (skeletonEl) {
              skeletonEl.remove();
              deletedCount++;
            }
            const realCard = dom.videoGrid.querySelector(`.video-card[data-video-id="${id}"]`);
            if (realCard) realCard.remove();
          } else {
            // Playable lub transient error (timeout) -> dopuszczamy bezpiecznie do wyświetlenia
            window._knownPlayableVideos.add(String(id));
            if (skeletonEl) {
              const vData = skeletonEl._videoData || items.find(it => String(it.id) === String(id));
              if (vData) {
                const cardIdx = Array.from(dom.videoGrid.children).indexOf(skeletonEl);
                const realCard = createVideoCard(vData, cardIdx >= 0 ? cardIdx : 0);
                dom.videoGrid.replaceChild(realCard, skeletonEl);
              }
            }
          }
        });

        // Dynamic Backfill: jeśli usunięto jakiekolwiek karty z siatki, uzupełniamy brakujące
        if (deletedCount > 0 && state.mode === 'home') {
          requestBackfill(deletedCount);
        }
      }
    }).catch(() => {});
  };

  window._validatePlayabilityBatchGlobal = validatePlayabilityBatch;

  const INITIAL_BATCH = 32;
  const CHUNK_SIZE = 32;
  const initial = videos.slice(0, INITIAL_BATCH);
  const firstFragment = document.createDocumentFragment();

  initial.forEach((v, idx) => firstFragment.appendChild(renderItemCard(v, idx)));
  dom.videoGrid.appendChild(firstFragment);
  updateCheckpointUI();

  validatePlayabilityBatch(initial);
  checkAndHighlightCheckpoint();

  let cursor = INITIAL_BATCH;
  const appendNextChunk = () => {
    if (cursor >= videos.length) return;
    const end = Math.min(cursor + CHUNK_SIZE, videos.length);
    const fragment = document.createDocumentFragment();
    const currentItems = videos.slice(cursor, end);
    for (let i = cursor; i < end; i += 1) {
      fragment.appendChild(renderItemCard(videos[i], i));
    }
    dom.videoGrid.appendChild(fragment);
    cursor = end;
    validatePlayabilityBatch(currentItems);

    if (cursor < videos.length) {
      if ('requestIdleCallback' in window) {
        requestIdleCallback(appendNextChunk, { timeout: 250 });
      } else {
        setTimeout(appendNextChunk, 16);
      }
    } else {
      updateCheckpointUI();
      checkAndHighlightCheckpoint();
    }
  };

  if (cursor < videos.length) {
    if ('requestIdleCallback' in window) {
      requestIdleCallback(appendNextChunk, { timeout: 200 });
    } else {
      setTimeout(appendNextChunk, 16);
    }
  }
}


// STOPNIOWE DOKŁADANIE KAFELKÓW W CZASIE RZECZYWISTYM ("PO KOLEI") Z ZERO-FLASH GATE
function appendVideoBatch(videos) {
  if (!videos || videos.length === 0) return;
  if (!window._knownDeletedVideos) window._knownDeletedVideos = new Set();
  if (!window._knownPlayableVideos) window._knownPlayableVideos = new Set();

  const isUserPersonalSection = (state.mode === 'favorites' || state.mode === 'history' || state.mode === 'following');
  const existingDomIds = new Set(
    Array.from(dom.videoGrid.querySelectorAll('.video-card, .skeleton-card'))
      .map(el => el.dataset.videoId)
      .filter(Boolean)
  );

  const fragment = document.createDocumentFragment();
  const unknownNew = [];
  let currentCount = dom.videoGrid.children.length;

  videos.forEach((v) => {
    if (!v || !v.id) return;
    const vid = String(v.id);
    if (existingDomIds.has(vid) || window._knownDeletedVideos.has(vid)) return;
    existingDomIds.add(vid);

    const isCw = v.source === 'camwhores' || vid.startsWith('cw_');
    let card;
    if (isUserPersonalSection || isCw || window._knownPlayableVideos.has(vid)) {
      card = createVideoCard(v, currentCount++);
    } else {
      card = renderSkeletonCard(v, currentCount++);
      unknownNew.push(v);
    }
    card.classList.add('stream-appear');
    fragment.appendChild(card);
  });

  if (fragment.childNodes.length > 0) {
    dom.videoGrid.appendChild(fragment);
  }

  if (unknownNew.length > 0 && typeof window._validatePlayabilityBatchGlobal === 'function') {
    window._validatePlayabilityBatchGlobal(unknownNew);
  }

  updateCheckpointUI();
  checkAndHighlightCheckpoint();
}

// MODAL ODTWARZACZA WIDEO (BEZPOŚREDNI STRUMIEŃ BEZ REKLAM)
async function openVideoModal(video) {
  state.isIframeMode = false;
  if (state.storyboardBuildController) state.storyboardBuildController.abort();
  state.storyboardBuildController = null;
  state.localStoryboard = null;
  if (state.timelineSpriteAbort) state.timelineSpriteAbort.abort();
  state.timelineSpriteAbort = null;
  state.timelineSpriteBoard = null;
  state.currentStoryboardKey = video?.id ? `video:${video.id}` : null;
  state.currentVideoDetails = { ...video };



  dom.modalVideo.style.display = 'block';
  dom.modalIframe.style.display = 'none';
  dom.modalVideo.pause();
  dom.modalIframe.src = '';
  if (dom.videoLoader) {
    dom.videoLoader.innerHTML = `
      <div class="video-loader-badge">
        <div class="spinner"></div>
        <span>Ładowanie wideo...</span>
      </div>
    `;
    dom.videoLoader.style.opacity = '1';
    dom.videoLoader.style.display = 'flex';
  }

  // GRAFIKA PODGLĄDOWA PODCZAS ŁADOWANIA FILMU (NIGDY CZARNY EKRAN I NIGDY ROZMYCIE!)
  let posterSrc = (video.thumbnail || video.poster || '').replace('.mp4', '.jpg');
  if (posterSrc.includes('/180x135/')) {
    posterSrc = posterSrc.replace(/\/180x135\/\d+\.jpg/, '/preview.jpg');
  }
  if (dom.modalLoadingPoster) {
    dom.modalLoadingPoster.src = posterSrc || '';
    dom.modalLoadingPoster.style.display = posterSrc ? 'block' : 'none';
    dom.modalLoadingPoster.style.opacity = '1';
  }
  if (dom.modalVideo) {
    dom.modalVideo.poster = posterSrc || '';
  }

  dom.modalPlatform.innerText = video.platform || 'Chaturbate';
  dom.modalModelName.innerText = `${video.username} • ${video.date || ''}`;
  const isFavAuthor = isFavoriteAuthor(video.username) || video.has_favorite_video;
  const isFav = isFavAuthor || !!video.is_favorite;
  if (isFav) {
    dom.modalModelName.classList.add('is-favorite-author');
  } else {
    dom.modalModelName.classList.remove('is-favorite-author');
  }
  const modalContent = dom.videoModal?.querySelector('.modal-content');
  if (modalContent) {
    if (isFav) modalContent.classList.add('is-favorite-modal');
    else modalContent.classList.remove('is-favorite-modal');
  }
  dom.modalOriginalBtn.href = video.url;
  if (dom.modalPopoutBtn) {
    const popDur = parseDurationToSeconds(video?.duration);
    dom.modalPopoutBtn.href = `/watch/${video.id}${popDur > 0 ? `?duration=${popDur}` : ''}`;
    dom.modalPopoutBtn.onclick = () => {
      try {
        sessionStorage.setItem('archivebate_bootstrap_' + video.id, JSON.stringify({
          id: video.id,
          username: video.username,
          thumbnail: video.poster_proxy || video.thumbnail_proxy || video.poster,
          date: video.date,
          duration: video.duration,
          platform: video.platform,
          url: video.url
        }));
      } catch (_) {}
    };
  }
  dom.modalDownloadBtn.href = '#';
  dom.modalDownloadBtn.style.display = 'none';
  dom.modalKeywords.innerHTML = '<span style="color: var(--text-dim); font-size: 12px;">Pobieranie bezpośredniego strumienia wideo...</span>';

  // Automatyczny zapis w historii oglądania
  fetch('/api/account/history/record', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(video)
  }).then(r => r.json()).then(d => {
    state.historyCount = d.total_history || (state.historyCount + 1);
    dom.navHistCount.innerText = state.historyCount;
    dom.statHistCount.innerText = state.historyCount;
  }).catch(() => {});

  dom.modalViewModelVideosBtn.onclick = () => {
    closeModal();
    loadModelVideos(video.username, 1);
  };

  if (dom.modalBlockModelBtn) {
    dom.modalBlockModelBtn.onclick = (e) => {
      e.stopPropagation();
      blockModel(video.username);
    };
  }

  dom.videoModal.classList.add('active');
  document.body.style.overflow = 'hidden';

  // 1. Zapis bootstrap do sessionStorage
  if (video?.id) {
    try {
      sessionStorage.setItem('archivebate_bootstrap_' + video.id, JSON.stringify({
        id: video.id,
        username: video.username,
        thumbnail: video.poster_proxy || video.thumbnail_proxy || video.poster,
        date: video.date,
        duration: video.duration,
        platform: video.platform,
        url: video.url
      }));
    } catch (_) {}
  }

  let modalPerfTracker = null;
  if (window.ArchivebatePlayerCore?.VideoPerfTracker && video?.id) {
    modalPerfTracker = new ArchivebatePlayerCore.VideoPerfTracker(video.id, 'modal');
    const isWarm = videoDetailsCache.has(video.id);
    const isPrefetched = !!(video._prefetched || video.direct_url || (video.id && videoDetailsInflight.has(video.id)));
    modalPerfTracker.setCacheType(isWarm ? 'warm' : (isPrefetched ? 'prefetch' : 'cold'));
  }

  let modalLoaderDismissed = false;
  const hideLoadingPoster = (reason = 'unknown') => {
    if (modalLoaderDismissed) return;
    modalLoaderDismissed = true;
    modalPerfTracker?.markLoaderHidden(reason);
    if (dom.videoLoader) {
      dom.videoLoader.style.opacity = '0';
      setTimeout(() => {
        if (dom.videoLoader && dom.videoLoader.style.opacity === '0') {
          dom.videoLoader.style.display = 'none';
        }
      }, 200);
    }
    if (dom.modalLoadingPoster) {
      dom.modalLoadingPoster.style.opacity = '0';
      setTimeout(() => {
        if (dom.modalLoadingPoster && dom.modalLoadingPoster.style.opacity === '0') {
          dom.modalLoadingPoster.style.display = 'none';
        }
      }, 350);
    }
  };

  const showModalVideoError = (message = 'Błąd ładowania strumienia. Spróbuj odświeżyć.') => {
    modalLoaderDismissed = true;
    modalPerfTracker?.markLoaderHidden('video-error');
    if (dom.videoLoader) {
      dom.videoLoader.style.opacity = '1';
      dom.videoLoader.style.display = 'flex';
      dom.videoLoader.innerHTML = `
        <div class="video-loader-badge" style="border-color: rgba(239, 68, 68, 0.4); background: rgba(15, 23, 42, 0.92);">
          <i class="fa-solid fa-circle-exclamation" style="color: #ef4444; font-size: 20px;"></i>
          <span style="color: #fca5a5; font-weight: 600;">${message}</span>
        </div>
      `;
    }
    if (dom.modalLoadingPoster) {
      dom.modalLoadingPoster.style.opacity = '0.35';
    }
    showToast(message, 'error');
  };

  // Precyzyjne wykrywanie pierwszej wyrenderowanej klatki
  if (modalPerfTracker) {
    modalPerfTracker.attachToPlayer(dom.modalVideo, (result) => {
      hideLoadingPoster(result?.reason || 'requestVideoFrameCallback');
    });
  } else if (window.ArchivebatePlayerCore && typeof ArchivebatePlayerCore.waitForPresentedFrame === 'function') {
    ArchivebatePlayerCore.waitForPresentedFrame(dom.modalVideo).then(res => {
      if (res && res.presented) hideLoadingPoster(res.reason || 'waitForPresentedFrame');
    });
  }

  // 2. NATYCHMIASTOWE PRZYPISANIE STRUMIENIA MP4 W PLAYERZE (0ms oczekiwania na metadane)
  const streamSource = (video && video.id)
    ? `/api/video/stream?id=${encodeURIComponent(video.id)}`
    : (video?.proxy_stream_url || video?.direct_url || '');

  if (streamSource) {
    dom.modalVideo.src = streamSource;
    modalPerfTracker?.mark('stream_src_set');
  }

  if (dom.modalTimelineProgress) dom.modalTimelineProgress.style.width = '0%';
  if (dom.modalTimelineThumb) dom.modalTimelineThumb.style.left = '0%';
  if (dom.modalTimelineBuffer) dom.modalTimelineBuffer.style.width = '0%';

  const prepareYoutubeStoryboard = (dur) => {
    const isCamwhores = !!state.currentTimelinePrefix;
    if (isCamwhores || !video?.id || !window.ArchivebateYouTubeStoryboard) return;
    const duration = Number(dur) > 0 ? Number(dur) : ((Number.isFinite(dom.modalVideo.duration) && dom.modalVideo.duration > 0) ? dom.modalVideo.duration : parseDurationToSeconds(video?.duration || state.currentVideoDetails?.duration));
    if (!duration || duration <= 0) return;
    if (state.timelineSpriteBoard || state.timelineSpriteAbort) return;

    modalPerfTracker?.mark('storyboard_start');
    const controller = new AbortController();
    state.timelineSpriteAbort = controller;
    const expectedId = String(video.id);

    ArchivebateYouTubeStoryboard.prepare({
      videoId: expectedId,
      duration: duration,
      signal: controller.signal,
      onStatus: (status) => {
        if (controller.signal.aborted || String(state.currentVideoDetails?.id || '') !== expectedId) return;
        if (dom.modalTimelinePreviewStatus && status !== 'ready') {
          dom.modalTimelinePreviewStatus.textContent = 'Przygotowywanie podglądu…';
          dom.modalTimelinePreviewStatus.style.display = 'flex';
        }
      },
      onUpgrade: (upgradedBoard) => {
        if (controller.signal.aborted || String(state.currentVideoDetails?.id || '') !== expectedId) return;
        state.timelineSpriteBoard = upgradedBoard;
      }
    }).then(board => {
      if (controller.signal.aborted || String(state.currentVideoDetails?.id || '') !== expectedId) return;
      state.timelineSpriteBoard = board;
      modalPerfTracker?.mark('storyboard_quick_ready');
      if (dom.modalTimelinePreviewStatus) dom.modalTimelinePreviewStatus.style.display = 'none';
    }).catch(err => {
      if (err?.name === 'AbortError') return;
      if (dom.modalTimelinePreviewStatus) {
        dom.modalTimelinePreviewStatus.textContent = 'Podgląd niedostępny';
        dom.modalTimelinePreviewStatus.style.display = 'flex';
      }
    }).finally(() => {
      if (state.timelineSpriteAbort === controller) state.timelineSpriteAbort = null;
    });
  };

  let modalStoryboardPrepared = false;
  const triggerModalStoryboardOnce = () => {
    if (modalStoryboardPrepared) return;
    modalStoryboardPrepared = true;
    const durSec = parseDurationToSeconds(video.duration || state.currentVideoDetails?.duration);
    if (durSec > 0) prepareYoutubeStoryboard(durSec);
  };

  if (dom.modalTimelineContainer) {
    dom.modalTimelineContainer.addEventListener('pointerenter', triggerModalStoryboardOnce, { passive: true, once: true });
  }

  dom.modalVideo.onloadeddata = () => {
    modalPerfTracker?.mark('loadeddata');
  };
  dom.modalVideo.onplaying = () => {
    // Awaryjny UX failsafe dopiero po kilku sekundach ciągłego grania bez RVFC:
    setTimeout(() => {
      if (!modalLoaderDismissed && dom.modalVideo && dom.modalVideo.readyState >= 2) {
        hideLoadingPoster('loader_failsafe');
      }
    }, 3500);

    setTimeout(() => {
      if (!modalStoryboardPrepared) {
        if ('requestIdleCallback' in window) {
          requestIdleCallback(() => triggerModalStoryboardOnce(), { timeout: 3000 });
        } else {
          setTimeout(triggerModalStoryboardOnce, 1500);
        }
      }
    }, 1800);
  };
  dom.modalVideo.onerror = () => {
    showModalVideoError('Błąd ładowania strumienia. Spróbuj odświeżyć.');
  };
  dom.modalVideo.play().catch(() => {});

  // 3. RÓWNOLEGŁE POBIERANIE METADANYCH W TLE
  modalPerfTracker?.mark('details_request_start');
  try {
    let details = (video && video.id) ? videoDetailsCache.get(video.id) : null;
    if (!details || (!details.proxy_stream_url && !details.direct_url)) {
      details = await ArchivebateAPI.getJSON(`/api/video/details?id=${encodeURIComponent(video.id || video.url)}`, { timeoutMs: 12000 });
      if (video && video.id && (details.proxy_stream_url || details.direct_url)) {
        videoDetailsCache.set(video.id, details);
      }
    }
    modalPerfTracker?.mark('details_request_end');
    state.currentVideoDetails = { ...video, ...details };

    updateModalFavButton(!!details.is_favorite);

    if (details.is_deleted || details.playability_status === 'deleted') {
      dom.modalVideo.pause();
      dom.modalVideo.removeAttribute('src');
      dom.modalVideo.load();
      showModalVideoError('Ten film został usunięty z serwisu.');
      // Usuń kafelek z bieżącej siatki (A12)
      if (video?.id) {
        const cardEl = dom.videoGrid.querySelector(`[data-video-id="${video.id}"]`);
        if (cardEl) cardEl.remove();
      }
      dom.modalKeywords.innerHTML = '<div style="color: #f87171; font-weight: 600; padding: 6px 0;"><i class="fa-solid fa-trash-can"></i> Ten film został trwale usunięty ze źródła.</div>';
      return;
    }

    if (details.is_private) {
      dom.modalVideo.pause();
      dom.modalVideo.removeAttribute('src');
      dom.modalVideo.load();
      showModalVideoError('Ten film jest oznaczony jako prywatny na Camwhores (dostępny tylko dla członków serwisu)');
      dom.modalKeywords.innerHTML = '<div style="color: #f87171; font-weight: 600; padding: 6px 0;"><i class="fa-solid fa-lock"></i> Film prywatny na Camwhores (dostępny wyłącznie dla zalogowanych autorów serwisu).</div>';
      return;
    }

    // Konfiguracja podglądu osi czasu (timeline)
    const posterUrl = details.thumbnail || video.poster || '';
    state.preloadedStoryboard = [];
    if (video.source === 'camwhores' || String(video.id).startsWith('cw_') || (details.url && details.url.includes('camwhores'))) {
      if (posterUrl && (posterUrl.includes('/180x135/') || posterUrl.includes('/contents/videos_screenshots/'))) {
        let prefix = null;
        if (posterUrl.includes('/180x135/')) {
          prefix = posterUrl.substring(0, posterUrl.indexOf('/180x135/') + 9);
        } else {
          const baseFolder = posterUrl.substring(0, posterUrl.lastIndexOf('/') + 1);
          prefix = `${baseFolder}180x135/`;
        }
        state.currentTimelinePrefix = prefix;
        state.currentTimelineCount = 15;
        if (dom.modalTimelinePreviewImg) {
          dom.modalTimelinePreviewImg.src = `${state.currentTimelinePrefix}1.jpg`;
          dom.modalTimelinePreviewImg.style.display = 'block';
        }
        if (dom.modalTimelinePreviewVideo) {
          dom.modalTimelinePreviewVideo.style.display = 'none';
        }
        if (dom.modalTimelineSprite && window.ArchivebateYouTubeStoryboard) ArchivebateYouTubeStoryboard.clearFrame(dom.modalTimelineSprite);
        if (dom.modalTimelinePreviewStatus) dom.modalTimelinePreviewStatus.style.display = 'none';
        // BŁYSKAWICZNE PRELOADOWANIE WSZYSTKICH 15 KLATEK W PAMIĘCI PRZEGLĄDARKI (0ms opóźnienia)
        for (let i = 1; i <= 15; i++) {
          const preImg = new Image();
          preImg.src = `${state.currentTimelinePrefix}${i}.jpg`;
          state.preloadedStoryboard.push(preImg);
        }
      } else {
        state.currentTimelinePrefix = null;
        state.currentTimelineCount = 0;
        if (dom.modalTimelinePreviewImg) dom.modalTimelinePreviewImg.style.display = 'none';
      }
    } else {
      // Archivebate: YouTube-style storyboard (generowany w tle i cache'owany na dysku)
      state.currentTimelinePrefix = null;
      state.currentTimelineCount = 0;
      state.timelineSpriteBoard = null;
      if (dom.modalTimelinePreviewImg) dom.modalTimelinePreviewImg.style.display = 'none';
      if (dom.modalTimelinePreviewVideo) {
        dom.modalTimelinePreviewVideo.style.display = 'none';
        dom.modalTimelinePreviewVideo.pause();
        dom.modalTimelinePreviewVideo.removeAttribute('src');
      }
      if (dom.modalTimelineSprite && window.ArchivebateYouTubeStoryboard) {
        ArchivebateYouTubeStoryboard.clearFrame(dom.modalTimelineSprite);
      }
      if (dom.modalTimelinePreviewStatus) {
        dom.modalTimelinePreviewStatus.style.display = 'none';
      }
    }

    if (details.direct_url || details.download_url) {
      dom.modalDownloadBtn.href = details.direct_url || details.download_url;
      dom.modalDownloadBtn.style.display = 'inline-flex';
    }

    if (details.keywords && details.keywords.length > 0) {
      dom.modalKeywords.innerHTML = '';
      details.keywords.forEach(kw => {
        if (kw.trim()) {
          const tagSpan = document.createElement('span');
          tagSpan.className = 'modal-kw-tag';
          tagSpan.innerText = kw.trim();
          tagSpan.style.cursor = 'pointer';
          tagSpan.title = `Szukaj filmów z tagiem #${kw.trim()}`;
          tagSpan.addEventListener('click', () => {
            closeModal();
            dom.searchInput.value = kw.trim();
            dom.clearSearchBtn.style.display = 'flex';
            performSearch(kw.trim(), 1);
          });
          dom.modalKeywords.appendChild(tagSpan);
        }
      });
    } else {
      dom.modalKeywords.innerHTML = '';
    }
  } catch (e) {
    if (!dom.modalVideo.src) {
      dom.videoLoader.style.display = 'none';
      showToast('Błąd pobierania wideo', 'error');
    }
  }
}

function togglePlayerMode() {
  if (state.isIframeMode) {
    state.isIframeMode = false;
    dom.modalIframe.style.display = 'none';
    dom.modalIframe.src = '';
    dom.modalVideo.style.display = 'block';
    if (state.currentVideoDetails && (state.currentVideoDetails.direct_url || state.currentVideoDetails.proxy_stream_url)) {
      dom.modalVideo.src = state.currentVideoDetails.proxy_stream_url || state.currentVideoDetails.direct_url;
      dom.modalVideo.play().catch(() => {});
    }
    showToast('Włączono bezpośredni odtwarzacz wideo', 'info');
  } else {
    enableIframeMode();
    showToast('Włączono tryb awaryjny Iframe', 'info');
  }
}

function enableIframeMode() {
  state.isIframeMode = true;
  dom.modalVideo.pause();
  dom.modalVideo.removeAttribute('src');
  dom.modalVideo.load();
  dom.modalVideo.style.display = 'none';
  dom.videoLoader.style.display = 'none';
  dom.modalIframe.style.display = 'block';
  if (state.currentVideoDetails && state.currentVideoDetails.embed_url) {
    dom.modalIframe.src = state.currentVideoDetails.embed_url;
  }
}

// LISTA WIDOCZNYCH FILMÓW (Z UWZGLĘDNIENIEM FILTRA ARCHIVEBATE / CAMWHORES I ZABLOKOWANYCH AUTORÓW)
function getActiveFilteredVideos() {
  if (!state.videos || state.videos.length === 0) return [];
  const mode = state.sourceFilter || 'all';
  return state.videos.filter(v => {
    const authorNorm = (v.username || '').toLowerCase().trim();
    if (state.blockedModels && (state.blockedModels.includes(authorNorm) || state.blockedModels.includes((v.username || '').trim()))) {
      return false;
    }
    const isCamwhores = v.source === 'camwhores' || String(v.id).startsWith('cw_') || (v.platform && v.platform.toLowerCase().includes('camwhores'));
    if (mode === 'only-camwhores') {
      return isCamwhores;
    } else if (mode === 'only-archivebate') {
      return !isCamwhores;
    }
    return true;
  });
}

// NAWIGACJA POPRZEDNI / NASTĘPNY FILM
function getCurrentVideoIndex() {
  const list = getActiveFilteredVideos();
  if (!state.currentVideoDetails || list.length === 0) return -1;
  const currId = String(state.currentVideoDetails.id || '');
  let idx = list.findIndex(v => String(v.id || '') === currId);
  if (idx !== -1) return idx;
  const currUrl = state.currentVideoDetails.url;
  if (currUrl) {
    idx = list.findIndex(v => v.url === currUrl);
    if (idx !== -1) return idx;
  }
  return -1;
}

async function playNextVideo() {
  const list = getActiveFilteredVideos();
  if (list.length === 0) {
    showToast('Brak filmów do odtworzenia', 'info');
    return;
  }
  let idx = getCurrentVideoIndex();
  if (idx === -1) idx = 0;

  if (idx < list.length - 1) {
    const nextVideo = list[idx + 1];
    showToast(`Następny film (${idx + 2}/${list.length}): ${nextVideo.username}`, 'info', 1200);
    openVideoModal(nextVideo);
    return;
  }
  // Jeśli jesteśmy na ostatnim filmie i są kolejne strony:
  if (idx === list.length - 1 && state.currentPage < state.lastPage) {
    showToast('Ładowanie następnej strony filmów...', 'info', 1500);
    const nextPage = state.currentPage + 1;
    await loadVideos(nextPage);
    const updatedList = getActiveFilteredVideos();
    if (updatedList.length > 0) {
      openVideoModal(updatedList[0]);
    }
    return;
  }
  showToast('To jest ostatni film na tej stronie', 'info', 1500);
}

async function playPrevVideo() {
  const list = getActiveFilteredVideos();
  if (list.length === 0) {
    showToast('Brak filmów do odtworzenia', 'info');
    return;
  }
  let idx = getCurrentVideoIndex();
  if (idx > 0) {
    const prevVideo = list[idx - 1];
    showToast(`Poprzedni film (${idx}/${list.length}): ${prevVideo.username}`, 'info', 1200);
    openVideoModal(prevVideo);
    return;
  }
  // Jeśli jesteśmy na pierwszym filmie strony > 1:
  if (idx <= 0 && state.currentPage > 1) {
    showToast('Ładowanie poprzedniej strony filmów...', 'info', 1500);
    const prevPage = state.currentPage - 1;
    await loadVideos(prevPage);
    const updatedList = getActiveFilteredVideos();
    if (updatedList.length > 0) {
      openVideoModal(updatedList[updatedList.length - 1]);
    }
    return;
  }
  showToast('To jest pierwszy film na tej stronie', 'info', 1500);
}

function closeModal() {
  if (state.timelineSpriteAbort) state.timelineSpriteAbort.abort();
  state.timelineSpriteAbort = null;
  state.timelineSpriteBoard = null;
  if (dom.modalTimelineSprite && window.ArchivebateYouTubeStoryboard) ArchivebateYouTubeStoryboard.clearFrame(dom.modalTimelineSprite);
  if (dom.modalTimelinePreviewStatus) dom.modalTimelinePreviewStatus.style.display = 'none';
  if (state.storyboardBuildController) state.storyboardBuildController.abort();
  state.storyboardBuildController = null;
  state.localStoryboard = null;
  state.currentStoryboardKey = null;
  dom.videoModal.classList.remove('active');
  dom.modalVideo.pause();
  dom.modalVideo.removeAttribute('src');
  dom.modalVideo.load();
  if (dom.modalLoadingPoster) {
    dom.modalLoadingPoster.style.display = 'none';
    dom.modalLoadingPoster.src = '';
  }
  if (dom.modalTimelinePreviewVideo) {
    dom.modalTimelinePreviewVideo.pause();
    dom.modalTimelinePreviewVideo.removeAttribute('src');
    dom.modalTimelinePreviewVideo.load();
  }
  dom.modalIframe.src = '';
  document.body.style.overflow = '';
}

// SKELETONY
function showSkeletons() {
  dom.videoGrid.innerHTML = '';
  for (let i = 0; i < 12; i++) {
    const sk = document.createElement('div');
    sk.className = 'skeleton-card';
    dom.videoGrid.appendChild(sk);
  }
}

// TOAST
function showToast(message, type = 'info', existingToast = null) {
  return window.ArchivebateToast.show(message, type, existingToast);
}

// FORMATOWANIE CZASU DLA ODTWARZACZA
const formatPlayerTime = (seconds) => ArchivebatePlayerCore.formatTime(seconds);
const parseDurationToSeconds = (durStr) => ArchivebatePlayerCore.parseDurationToSeconds(durStr);

let isDraggingModalTimeline = false;
let modalIdleTimeout = null;

function initModalPlayerControls() {
  const vid = dom.modalVideo;
  if (!vid) return;

  function toggleModalPlay() {
    if (vid.paused || vid.ended) {
      vid.play().catch(() => {});
    } else {
      vid.pause();
    }
  }

  vid.addEventListener('play', () => {
    if (dom.modalCtrlPlayBtn) dom.modalCtrlPlayBtn.innerHTML = '<i class="fa-solid fa-pause"></i>';
    if (dom.modalCenterPlay) dom.modalCenterPlay.style.display = 'none';
    resetModalIdleTimer();
  });

  vid.addEventListener('pause', () => {
    if (dom.modalCtrlPlayBtn) dom.modalCtrlPlayBtn.innerHTML = '<i class="fa-solid fa-play"></i>';
    if (dom.modalCenterPlay) dom.modalCenterPlay.style.display = 'flex';
    if (dom.modalControlsBar) dom.modalControlsBar.classList.remove('idle');
    clearTimeout(modalIdleTimeout);
  });

  if (dom.modalCenterPlay) dom.modalCenterPlay.addEventListener('click', toggleModalPlay);
  vid.addEventListener('click', toggleModalPlay);
  if (dom.modalCtrlPlayBtn) dom.modalCtrlPlayBtn.addEventListener('click', toggleModalPlay);

  if (dom.modalCtrlPrevVideoBtn) {
    dom.modalCtrlPrevVideoBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      playPrevVideo();
    });
  }
  if (dom.modalCtrlNextVideoBtn) {
    dom.modalCtrlNextVideoBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      playNextVideo();
    });
  }
  if (dom.modalNavPrevArrow) {
    dom.modalNavPrevArrow.addEventListener('click', (e) => {
      e.stopPropagation();
      playPrevVideo();
    });
  }
  if (dom.modalNavNextArrow) {
    dom.modalNavNextArrow.addEventListener('click', (e) => {
      e.stopPropagation();
      playNextVideo();
    });
  }

  if (dom.modalCtrlRewindBtn) {
    dom.modalCtrlRewindBtn.addEventListener('click', () => {
      vid.currentTime = Math.max(0, vid.currentTime - 10);
    });
  }
  if (dom.modalCtrlForwardBtn) {
    dom.modalCtrlForwardBtn.addEventListener('click', () => {
      vid.currentTime = Math.min(vid.duration || 0, vid.currentTime + 10);
    });
  }

  vid.addEventListener('timeupdate', () => {
    if (!isDraggingModalTimeline && vid.duration) {
      const percent = (vid.currentTime / vid.duration) * 100;
      if (dom.modalTimelineProgress) dom.modalTimelineProgress.style.width = `${percent}%`;
      if (dom.modalTimelineThumb) dom.modalTimelineThumb.style.left = `${percent}%`;
      if (dom.modalCtrlTimeDisplay) {
        dom.modalCtrlTimeDisplay.innerText = `${formatPlayerTime(vid.currentTime)} / ${formatPlayerTime(vid.duration)}`;
      }
    }
  });

  vid.addEventListener('progress', () => {
    if (vid.duration && vid.buffered.length > 0) {
      const bufferedEnd = vid.buffered.end(vid.buffered.length - 1);
      const bufferPercent = (bufferedEnd / vid.duration) * 100;
      if (dom.modalTimelineBuffer) dom.modalTimelineBuffer.style.width = `${bufferPercent}%`;
    }
  });

  // TIMELINE HOVER FRAME PREVIEW — compositor/GPU path, max 1 update per ekran frame.
  let updateTimelinePreview = () => {};
  let modalPreviewRaf = 0;
  let modalPreviewClientX = 0;

  if (dom.modalTimelineContainer) {
    let modalSeekDebounce = null;
    let modalLastSeekTime = 0;

    const renderTimelinePreview = (clientX) => {
      const rect = dom.modalTimelineContainer.getBoundingClientRect();
      if (!rect.width) return;
      const rawX = clientX - rect.left;
      const pos = Math.max(0, Math.min(1, rawX / rect.width));
      const tooltipX = rect.width <= 168 ? rect.width / 2 : Math.max(84, Math.min(rect.width - 84, rawX));
      const totalDur = (Number.isFinite(vid.duration) && vid.duration > 0) ? vid.duration : (parseDurationToSeconds(state.currentVideoDetails?.duration) || 0);
      const targetTime = pos * totalDur;

      if (dom.modalTimelineTooltip) {
        dom.modalTimelineTooltip.style.setProperty('--timeline-preview-x', `${tooltipX}px`);
        dom.modalTimelineTooltip.style.display = 'flex';
      }
      if (dom.modalTimelineTimeText) {
        const text = formatPlayerTime(targetTime);
        if (dom.modalTimelineTimeText.innerText !== text) dom.modalTimelineTimeText.innerText = text;
      }

      // 1. Camwhores: 15 klatek ze storyboardu CDN (0ms)
      if (state.currentTimelinePrefix) {
        const count = state.currentTimelineCount || 15;
        const frameIdx = Math.min(count, Math.max(1, Math.round(pos * (count - 1)) + 1));
        if (dom.modalTimelinePreviewImg) {
          const src = `${state.currentTimelinePrefix}${frameIdx}.jpg`;
          if (dom.modalTimelinePreviewImg.src !== new URL(src, location.href).href) dom.modalTimelinePreviewImg.src = src;
          dom.modalTimelinePreviewImg.style.display = 'block';
        }
        if (dom.modalTimelinePreviewVideo) dom.modalTimelinePreviewVideo.style.display = 'none';
        if (dom.modalTimelineSprite && window.ArchivebateYouTubeStoryboard) ArchivebateYouTubeStoryboard.clearFrame(dom.modalTimelineSprite);
        return;
      }

      // 2. Archivebate: jeden gotowy sprite, identyczna technika jak storyboard YouTube (GPU translate3d, 0ms, 0 zapytań wideo)
      if (state.timelineSpriteBoard && dom.modalTimelineSprite && window.ArchivebateYouTubeStoryboard) {
        if (dom.modalTimelinePreviewImg) dom.modalTimelinePreviewImg.style.display = 'none';
        if (dom.modalTimelinePreviewVideo) dom.modalTimelinePreviewVideo.style.display = 'none';
        if (dom.modalTimelinePreviewStatus) dom.modalTimelinePreviewStatus.style.display = 'none';
        ArchivebateYouTubeStoryboard.applyFrame(dom.modalTimelineSprite, state.timelineSpriteBoard, pos);
        return;
      }

      // 3. Fallback podczas przygotowywania: plakat wideo + precyzyjny znacznik czasu (0ms lag, zero obciążenia sieci)
      if (dom.modalTimelineSprite && window.ArchivebateYouTubeStoryboard) ArchivebateYouTubeStoryboard.clearFrame(dom.modalTimelineSprite);
      if (dom.modalTimelinePreviewVideo) dom.modalTimelinePreviewVideo.style.display = 'none';
      const posterSrc = (state.currentVideoDetails?.thumbnail || state.currentVideoDetails?.poster || '').replace('.mp4', '.jpg');
      if (posterSrc && dom.modalTimelinePreviewImg) {
        if (dom.modalTimelinePreviewImg.src !== new URL(posterSrc, location.href).href) dom.modalTimelinePreviewImg.src = posterSrc;
        dom.modalTimelinePreviewImg.style.display = 'block';
      }
    };

    updateTimelinePreview = (e) => {
      modalPreviewClientX = e.clientX;
      if (modalPreviewRaf) return;
      modalPreviewRaf = requestAnimationFrame(() => {
        modalPreviewRaf = 0;
        renderTimelinePreview(modalPreviewClientX);
      });
    };

    dom.modalTimelineContainer.addEventListener('pointerenter', updateTimelinePreview, { passive: true });
    dom.modalTimelineContainer.addEventListener('pointermove', (e) => {
      if (isDraggingModalTimeline) seekModalFromEvent(e);
      else updateTimelinePreview(e);
    }, { passive: true });
    dom.modalTimelineContainer.addEventListener('pointerleave', () => {
      if (dom.modalTimelineTooltip) dom.modalTimelineTooltip.style.display = 'none';
      if (dom.modalTimelineSprite && window.ArchivebateYouTubeStoryboard) {
        ArchivebateYouTubeStoryboard.clearFrame(dom.modalTimelineSprite);
      }
      if (dom.modalTimelinePreviewVideo) {
        dom.modalTimelinePreviewVideo.style.display = 'none';
      }
      if (dom.modalTimelinePreviewImg) {
        dom.modalTimelinePreviewImg.style.display = 'none';
      }
    });
    dom.modalTimelineContainer.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      isDraggingModalTimeline = true;
      try { dom.modalTimelineContainer.setPointerCapture(e.pointerId); } catch (_) {}
      seekModalFromEvent(e);
    });
  }

  window.addEventListener('pointerup', () => {
    if (isDraggingModalTimeline) isDraggingModalTimeline = false;
  });
  window.addEventListener('pointercancel', () => {
    isDraggingModalTimeline = false;
  });

  function seekModalFromEvent(e) {
    if (!dom.modalTimelineContainer) return;
    const rect = dom.modalTimelineContainer.getBoundingClientRect();
    const pos = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    if (vid.duration) {
      vid.currentTime = pos * vid.duration;
      if (dom.modalTimelineProgress) dom.modalTimelineProgress.style.width = `${pos * 100}%`;
      if (dom.modalTimelineThumb) dom.modalTimelineThumb.style.left = `${pos * 100}%`;
    }
    updateTimelinePreview(e);
  }

  // Głośność
  ArchivebatePlayerCore.setupVolumeControls(vid, dom.modalCtrlVolumeSlider, dom.modalCtrlVolumeBtn);

  // Prędkość
  ArchivebatePlayerCore.setupSpeedToggle(vid, dom.modalCtrlSpeedBtn);

  // PiP
  if (dom.modalCtrlPipBtn) {
    dom.modalCtrlPipBtn.addEventListener('click', async () => {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else if (document.pictureInPictureEnabled) {
        await vid.requestPictureInPicture();
      }
    });
  }

  // Fullscreen
  ArchivebatePlayerCore.setupFullscreenToggle(dom.modalPlayerWrapper, dom.modalCtrlFullscreenBtn);

  // Auto-hide controls
  const resetModalIdleTimer = ArchivebatePlayerCore.setupIdleTimer(dom.modalPlayerWrapper, dom.modalControlsBar, vid);

  // Skróty klawiszowe w modalu
  window.addEventListener('keydown', (e) => {
    if (!dom.videoModal.classList.contains('active')) return;

    // Ignoruj tylko gdy użytkownik pisze w polach tekstowych
    if (['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)) {
      if (document.activeElement.type === 'text' || document.activeElement.type === 'search') {
        return;
      }
    }

    const code = e.code;
    const key = e.key;

    if (code === 'Space' || key === ' ') {
      e.preventDefault();
      toggleModalPlay();
    } else if (code === 'ArrowUp' || key === 'ArrowUp' || key === 'Up') {
      e.preventDefault();
      playNextVideo();
    } else if (code === 'ArrowDown' || key === 'ArrowDown' || key === 'Down') {
      e.preventDefault();
      playPrevVideo();
    } else if (code === 'ArrowRight' || key === 'ArrowRight' || key === 'Right') {
      e.preventDefault();
      if (e.shiftKey || e.ctrlKey) {
        vid.currentTime = Math.min(vid.duration || 0, vid.currentTime + 10);
      } else {
        playNextVideo();
      }
    } else if (code === 'ArrowLeft' || key === 'ArrowLeft' || key === 'Left') {
      e.preventDefault();
      if (e.shiftKey || e.ctrlKey) {
        vid.currentTime = Math.max(0, vid.currentTime - 10);
      } else {
        playPrevVideo();
      }
    } else if (code === 'KeyF' || key === 'f' || key === 'F') {
      e.preventDefault();
      if (dom.modalCtrlFullscreenBtn) dom.modalCtrlFullscreenBtn.click();
    } else if (code === 'KeyM' || key === 'm' || key === 'M') {
      e.preventDefault();
      vid.muted = !vid.muted;
      updateModalVolumeIcon();
    }
  }, true);
}
