/**
 * Archivebate Video Browser - Frontend Logic
 */

// Stan aplikacji
const state = {
  mode: 'home', // 'home' | 'search' | 'model' | 'favorites' | 'history' | 'following' | 'account'
  currentQuery: '',
  currentModel: '',
  currentPage: 1,
  lastPage: 50,
  isLoading: false,
  videos: [],
  currentVideoDetails: null,
  isIframeMode: false,
  targetCheckpointId: null,
  showCamwhores: localStorage.getItem('archivebate_show_camwhores') !== 'false',
  sourceFilter: localStorage.getItem('archivebate_source_filter') || 'all',
  authorFilter: localStorage.getItem('archivebate_author_filter') || 'all', // 'all' | 'only_fav' | 'exclude_fav'
  groupByAuthor: localStorage.getItem('archivebate_group_by_author') === 'true',
  favoritesCount: 0,
  historyCount: 0,
  followingCount: 0,
  favoriteAuthors: new Set(),
  preloadedStoryboard: [],
  localStoryboard: null,
  currentStoryboardKey: null,
  storyboardBuildController: null,
  timelineSpriteBoard: null,
  timelineSpriteAbort: null,
  lastClickedGridVideo: null,
  lastClickedGridIndex: -1
};

function isFavoriteAuthor(username) {
  if (!username) return false;
  const norm = String(username).toLowerCase().trim();
  return state.favoriteAuthors && state.favoriteAuthors.has(norm);
}

// Elementy DOM
const dom = {
  videoGrid: document.getElementById('videoGrid'),
  searchInput: document.getElementById('searchInput'),
  clearSearchBtn: document.getElementById('clearSearchBtn'),
  tagsSection: document.getElementById('tagsSection'),
  tagsContainer: document.getElementById('tagsContainer'),
  contentHeader: document.getElementById('contentHeader'),
  viewTitle: document.getElementById('viewTitle'),
  videoCount: document.getElementById('videoCount'),
  navBackBtn: document.getElementById('navBackBtn'),
  resetFilterBtn: document.getElementById('resetFilterBtn'),
  toggleCamwhoresBtn: document.getElementById('toggleCamwhoresBtn'),
  sourceToggleIcon: document.getElementById('sourceToggleIcon'),
  camwhoresToggleLabel: document.getElementById('camwhoresToggleLabel'),
  toggleAuthorFilterBtn: document.getElementById('toggleAuthorFilterBtn'),
  authorFilterIcon: document.getElementById('authorFilterIcon'),
  authorFilterLabel: document.getElementById('authorFilterLabel'),
  toggleGroupBtn: document.getElementById('toggleGroupBtn'),
  groupToggleIcon: document.getElementById('groupToggleIcon'),
  groupToggleLabel: document.getElementById('groupToggleLabel'),
  headerCheckpointBtn: document.getElementById('headerCheckpointBtn'),
  checkpointText: document.getElementById('checkpointText'),
  navCheckpointBtn: document.getElementById('navCheckpointBtn'),
  matchedProfiles: document.getElementById('matchedProfiles'),
  profilesList: document.getElementById('profilesList'),
  // Home Stats Bar
  homeStatsBar: document.getElementById('homeStatsBar'),
  statGlobalVideos: document.getElementById('statGlobalVideos'),
  statCatalogVideos: document.getElementById('statCatalogVideos'),
  statCatalogVideosLbl: document.getElementById('statCatalogVideosLbl'),
  statGlobalProfiles: document.getElementById('statGlobalProfiles'),
  statPageVideos: document.getElementById('statPageVideos'),
  statUserLibrary: document.getElementById('statUserLibrary'),
  statBlockedInfo: document.getElementById('statBlockedInfo'),
  statBlockedVideosLbl: document.getElementById('statBlockedVideosLbl'),
  // Account Panel View
  accountPanelView: document.getElementById('accountPanelView'),
  panelEmail: document.getElementById('panelEmail'),
  panelLastSync: document.getElementById('panelLastSync'),
  panelSyncBtn: document.getElementById('panelSyncBtn'),
  panelClearHistoryBtn: document.getElementById('panelClearHistoryBtn'),
  statFavCount: document.getElementById('statFavCount'),
  statHistCount: document.getElementById('statHistCount'),
  statFollCount: document.getElementById('statFollCount'),
  statBlockedCount: document.getElementById('statBlockedCount'),
  statBtnFavs: document.getElementById('statBtnFavs'),
  statBtnHist: document.getElementById('statBtnHist'),
  statBtnFoll: document.getElementById('statBtnFoll'),
  statBtnBlocked: document.getElementById('statBtnBlocked'),
  // Nav Tabs
  navHomeBtn: document.getElementById('navHomeBtn'),
  navFavoritesBtn: document.getElementById('navFavoritesBtn'),
  navHistoryBtn: document.getElementById('navHistoryBtn'),
  navFollowingBtn: document.getElementById('navFollowingBtn'),
  navAccountBtn: document.getElementById('navAccountBtn'),
  navFavCount: document.getElementById('navFavCount'),
  navHistCount: document.getElementById('navHistCount'),
  // Pagination
  paginationSection: document.getElementById('paginationSection'),
  prevPageBtn: document.getElementById('prevPageBtn'),
  nextPageBtn: document.getElementById('nextPageBtn'),
  lastPageBtn: document.getElementById('lastPageBtn'),
  lastPageNumber: document.getElementById('lastPageNumber'),
  pageNumbersList: document.getElementById('pageNumbersList'),
  pageJumpInput: document.getElementById('pageJumpInput'),
  pageJumpBtn: document.getElementById('pageJumpBtn'),
  // User
  userEmail: document.getElementById('userEmail'),
  statusDot: document.getElementById('statusDot'),
  reloginBtn: document.getElementById('reloginBtn'),
  logoBtn: document.getElementById('logoBtn'),
  // Modal
  videoModal: document.getElementById('videoModal'),
  modalCloseBtn: document.getElementById('modalCloseBtn'),
  modalVideo: document.getElementById('modalVideo'),
  modalIframe: document.getElementById('modalIframe'),
  modalLoadingPoster: document.getElementById('modalLoadingPoster'),
  videoLoader: document.getElementById('videoLoader'),
  modalPlatform: document.getElementById('modalPlatform'),
  modalModelName: document.getElementById('modalModelName'),
  modalFavBtn: document.getElementById('modalFavBtn'),
  modalViewModelVideosBtn: document.getElementById('modalViewModelVideosBtn'),
  modalBlockModelBtn: document.getElementById('modalBlockModelBtn'),
  modalDownloadBtn: document.getElementById('modalDownloadBtn'),
  modalPopoutBtn: document.getElementById('modalPopoutBtn'),
  modalTogglePlayerBtn: document.getElementById('modalTogglePlayerBtn'),
  modalOriginalBtn: document.getElementById('modalOriginalBtn'),
  modalKeywords: document.getElementById('modalKeywords'),
  toastContainer: document.getElementById('toastContainer'),
  // Modal Custom Player Controls
  modalPlayerWrapper: document.getElementById('modalPlayerWrapper'),
  modalCenterPlay: document.getElementById('modalCenterPlay'),
  modalControlsBar: document.getElementById('modalControlsBar'),
  modalTimelineContainer: document.getElementById('modalTimelineContainer'),
  modalTimelineTooltip: document.getElementById('modalTimelineTooltip'),
  modalTimelinePreviewBox: document.getElementById('modalTimelinePreviewBox'),
  modalTimelinePreviewImg: document.getElementById('modalTimelinePreviewImg'),
  modalTimelineSprite: document.getElementById('modalTimelineSprite'),
  modalTimelinePreviewStatus: document.getElementById('modalTimelinePreviewStatus'),
  modalTimelinePreviewVideo: document.getElementById('modalTimelinePreviewVideo'),
  modalTimelineTimeText: document.getElementById('modalTimelineTimeText'),
  modalTimelineProgress: document.getElementById('modalTimelineProgress'),
  modalTimelineBuffer: document.getElementById('modalTimelineBuffer'),
  modalTimelineThumb: document.getElementById('modalTimelineThumb'),
  modalCtrlPlayBtn: document.getElementById('modalCtrlPlayBtn'),
  modalCtrlRewindBtn: document.getElementById('modalCtrlRewindBtn'),
  modalCtrlForwardBtn: document.getElementById('modalCtrlForwardBtn'),
  modalCtrlPrevVideoBtn: document.getElementById('modalCtrlPrevVideoBtn'),
  modalCtrlNextVideoBtn: document.getElementById('modalCtrlNextVideoBtn'),
  modalCtrlPrevAuthorBtn: document.getElementById('modalCtrlPrevAuthorBtn'),
  modalCtrlNextAuthorBtn: document.getElementById('modalCtrlNextAuthorBtn'),
  modalNavPrevArrow: document.getElementById('modalNavPrevArrow'),
  modalNavNextArrow: document.getElementById('modalNavNextArrow'),
  modalCtrlVolumeBtn: document.getElementById('modalCtrlVolumeBtn'),
  modalCtrlVolumeSlider: document.getElementById('modalCtrlVolumeSlider'),
  modalCtrlTimeDisplay: document.getElementById('modalCtrlTimeDisplay'),
  modalCtrlSpeedBtn: document.getElementById('modalCtrlSpeedBtn'),
  modalCtrlPipBtn: document.getElementById('modalCtrlPipBtn'),
  modalCtrlFullscreenBtn: document.getElementById('modalCtrlFullscreenBtn')
};

// ============================================================
// SYSTEM ZAKŁADEK (IN-APP MULTI-TAB SYSTEM)
// ============================================================
const tabManager = {
  tabs: [],
  activeTabId: null,

  init() {
    this.container = document.getElementById('appTabsContainer');
    this.bar = document.getElementById('appTabsBar');
    this.newBtn = document.getElementById('appTabNewBtn');

    if (this.newBtn) {
      this.newBtn.addEventListener('click', () => {
        this.openTab({
          title: 'Odkrywaj',
          icon: 'fa-solid fa-house',
          type: 'home',
          action: () => loadHomeVideos(1)
        });
      });
    }

    // Skróty klawiszowe kart (Ctrl+T, Ctrl+W, Ctrl+Tab, Ctrl+1..9)
    window.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 't') {
        e.preventDefault();
        this.openTab({ title: 'Odkrywaj', icon: 'fa-solid fa-house', type: 'home', action: () => loadHomeVideos(1) });
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'w') {
        if (!dom.videoModal.classList.contains('active') && this.tabs.length > 1) {
          e.preventDefault();
          this.closeTab(this.activeTabId);
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'Tab') {
        if (this.tabs.length > 1) {
          e.preventDefault();
          const curIdx = this.tabs.findIndex(t => t.id === this.activeTabId);
          const nextIdx = e.shiftKey
            ? (curIdx - 1 + this.tabs.length) % this.tabs.length
            : (curIdx + 1) % this.tabs.length;
          this.switchToTab(this.tabs[nextIdx].id);
        }
      } else if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key >= '1' && e.key <= '9') {
        const tabIdx = parseInt(e.key, 10) - 1;
        if (this.tabs[tabIdx]) {
          e.preventDefault();
          this.switchToTab(this.tabs[tabIdx].id);
        }
      }
    });

    // Inicjalna zakładka
    const initialTabId = 'tab_initial_home';
    const initialTab = {
      id: initialTabId,
      title: 'Odkrywaj',
      icon: 'fa-solid fa-house',
      type: 'home',
      gridFragment: null,
      scrollPosition: 0,
      stateSnapshot: null
    };
    this.tabs.push(initialTab);
    this.activeTabId = initialTabId;
    this.render();
  },

  executeTabAction(tab) {
    if (!tab) return;
    tab.isLoaded = true;
    state.navHistory = [];
    updateBackButtonUI();

    if (typeof tab.action === 'function') {
      tab.action();
    } else if (tab.type === 'model' && tab.username) {
      loadModelVideos(tab.username, 1);
    } else if (tab.type === 'search' && tab.query) {
      dom.searchInput.value = tab.query;
      dom.clearSearchBtn.style.display = 'flex';
      setActiveNavTab(null);
      performSearch(tab.query, 1);
    } else if (tab.type === 'favorites') {
      setActiveNavTab(dom.navFavoritesBtn);
      loadFavorites(1);
    } else if (tab.type === 'history') {
      setActiveNavTab(dom.navHistoryBtn);
      loadHistory(1);
    } else if (tab.type === 'following') {
      setActiveNavTab(dom.navFollowingBtn);
      loadFollowing(1);
    } else if (tab.type === 'watch' && tab.video) {
      if (tab.video.username) {
        loadModelVideos(tab.video.username, 1).then(() => {
          openVideoModal(tab.video);
        }).catch(() => {
          openVideoModal(tab.video);
        });
      } else {
        loadHomeVideos(1).then(() => {
          openVideoModal(tab.video);
        }).catch(() => {
          openVideoModal(tab.video);
        });
      }
    } else {
      setActiveNavTab(dom.navHomeBtn);
      loadHomeVideos(1);
    }
  },

  openTab({ title, icon, type, username, query, video, action, inBackground = false }) {
    const tabId = 'tab_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);

    const newTab = {
      id: tabId,
      title: title || (username ? username : (type === 'watch' ? 'Odtwarzacz' : 'Nowa karta')),
      icon: icon || (type === 'model' ? 'fa-solid fa-circle-user' : (type === 'watch' ? 'fa-solid fa-play' : 'fa-solid fa-folder')),
      type: type || 'custom',
      username: username || '',
      query: query || '',
      video: video || null,
      action: action || null,
      gridFragment: null,
      scrollPosition: 0,
      stateSnapshot: null,
      isLoaded: false
    };

    this.tabs.push(newTab);

    // Jeśli otwarto kółkiem myszy w tle: pozostajemy na bieżącej karcie bez przerywania scrolla i bez czyszczenia widoku
    if (inBackground) {
      this.render();
      if (this.container) {
        setTimeout(() => {
          const newEl = this.container.querySelector(`.app-tab[data-tab-id="${tabId}"]`);
          if (newEl) newEl.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
        }, 50);
      }
      showToast(`Otwarto w tle: ${newTab.title}`, 'info');
      return;
    }

    // 1. Zapisz stan obecnej zakładki
    this.saveCurrentTabState();

    this.activeTabId = tabId;
    this.render();

    // 3. Wyczyść widok
    dom.videoGrid.innerHTML = '';
    window.scrollTo({ top: 0, behavior: 'instant' });

    // 4. Załaduj żądaną zawartość
    this.executeTabAction(newTab);

    if (this.container) {
      setTimeout(() => {
        const activeEl = this.container.querySelector(`.app-tab[data-tab-id="${tabId}"]`);
        if (activeEl) activeEl.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
      }, 50);
    }
  },

  saveCurrentTabState() {
    const cur = this.tabs.find(t => t.id === this.activeTabId);
    if (!cur) return;

    cur.scrollPosition = window.scrollY || document.documentElement.scrollTop || 0;
    cur.stateSnapshot = {
      mode: state.mode,
      currentPage: state.currentPage,
      lastPage: state.lastPage,
      currentModel: state.currentModel,
      currentSearchQuery: state.currentSearchQuery,
      navHistory: Array.isArray(state.navHistory) ? [...state.navHistory] : [],
      videos: Array.isArray(state.videos) ? [...state.videos] : [],
      viewTitle: dom.viewTitle ? dom.viewTitle.innerText : '',
      videoCount: dom.videoCount ? dom.videoCount.innerText : '',
      totalCatalogVideos: state.totalCatalogVideos,
      homeStatsDisplay: dom.homeStatsBar ? dom.homeStatsBar.style.display : '',
      tagsSectionDisplay: dom.tagsSection ? dom.tagsSection.style.display : '',
      tagsDisplay: dom.tagsSection ? dom.tagsSection.style.display : '',
      contentHeaderDisplay: dom.contentHeader ? dom.contentHeader.style.display : '',
      resetFilterDisplay: dom.resetFilterBtn ? dom.resetFilterBtn.style.display : '',
      paginationDisplay: dom.paginationSection ? dom.paginationSection.style.display : '',
      accountPanelDisplay: dom.accountPanelView ? dom.accountPanelView.style.display : ''
    };

    const frag = document.createDocumentFragment();
    while (dom.videoGrid && dom.videoGrid.firstChild) {
      frag.appendChild(dom.videoGrid.firstChild);
    }
    cur.gridFragment = frag;
  },

  restoreTabState(tab) {
    if (!tab) return;
    this.activeTabId = tab.id;
    this.render();

    closeModal();

    // Jeśli zakładka była otwarta w tle i jeszcze nie pobrano jej zawartości
    if (!tab.isLoaded && !tab.gridFragment && !tab.stateSnapshot) {
      if (dom.videoGrid) dom.videoGrid.innerHTML = '';
      window.scrollTo({ top: 0, behavior: 'instant' });
      this.executeTabAction(tab);
      return;
    }

    if (dom.videoGrid) {
      dom.videoGrid.innerHTML = '';
      if (tab.gridFragment && tab.gridFragment.childNodes.length > 0) {
        dom.videoGrid.appendChild(tab.gridFragment);
      } else if (tab.stateSnapshot && tab.stateSnapshot.videos && tab.stateSnapshot.videos.length > 0) {
        renderVideoGrid(tab.stateSnapshot.videos);
      }
    }

    if (tab.stateSnapshot) {
      const s = tab.stateSnapshot;
      state.mode = s.mode;
      state.currentPage = s.currentPage;
      state.lastPage = s.lastPage;
      state.currentModel = s.currentModel;
      state.currentSearchQuery = s.currentSearchQuery;
      state.videos = s.videos;
      state.totalCatalogVideos = s.totalCatalogVideos;
      state.navHistory = Array.isArray(s.navHistory) ? [...s.navHistory] : [];
      updateBackButtonUI();

      if (dom.viewTitle && s.viewTitle) dom.viewTitle.innerText = s.viewTitle;
      if (dom.videoCount && s.videoCount) dom.videoCount.innerText = s.videoCount;
      if (dom.pageJumpInput) dom.pageJumpInput.value = s.currentPage;
      if (dom.homeStatsBar && s.homeStatsDisplay !== undefined) dom.homeStatsBar.style.display = s.homeStatsDisplay;
      if (dom.tagsSection && s.tagsDisplay !== undefined) dom.tagsSection.style.display = s.tagsDisplay;
      if (dom.contentHeader && s.contentHeaderDisplay !== undefined) dom.contentHeader.style.display = s.contentHeaderDisplay;
      if (dom.resetFilterBtn && s.resetFilterDisplay !== undefined) dom.resetFilterBtn.style.display = s.resetFilterDisplay;
      if (dom.paginationSection && s.paginationDisplay !== undefined) dom.paginationSection.style.display = s.paginationDisplay;
      if (dom.accountPanelView && s.accountPanelDisplay !== undefined) dom.accountPanelView.style.display = s.accountPanelDisplay;

      if (dom.searchInput) {
        dom.searchInput.value = (s.mode === 'search' && s.currentSearchQuery) ? s.currentSearchQuery : '';
        if (dom.clearSearchBtn) {
          dom.clearSearchBtn.style.display = dom.searchInput.value ? 'flex' : 'none';
        }
      }

      document.querySelectorAll('.tag-pill').forEach(p => {
        const queryNorm = (s.currentSearchQuery || '').toLowerCase().replace(/^#/, '');
        if (s.mode === 'search' && queryNorm && (p.dataset.tag === queryNorm || p.innerText.toLowerCase().replace(/^#/, '') === queryNorm)) {
          p.classList.add('active');
        } else {
          p.classList.remove('active');
        }
      });

      if (s.mode === 'favorites') setActiveNavTab(dom.navFavoritesBtn);
      else if (s.mode === 'history') setActiveNavTab(dom.navHistoryBtn);
      else if (s.mode === 'following') setActiveNavTab(dom.navFollowingBtn);
      else if (s.mode === 'home') setActiveNavTab(dom.navHomeBtn);
      else setActiveNavTab(null);

      renderPagination();
    }

    setTimeout(() => {
      window.scrollTo({ top: tab.scrollPosition || 0, behavior: 'instant' });
    }, 10);
  },

  switchToTab(tabId) {
    if (tabId === this.activeTabId) return;
    this.saveCurrentTabState();
    const target = this.tabs.find(t => t.id === tabId);
    if (target) {
      this.restoreTabState(target);
    }
  },

  closeTab(tabId) {
    if (this.tabs.length <= 1) {
      const last = this.tabs[0];
      last.title = 'Odkrywaj';
      last.icon = 'fa-solid fa-house';
      last.type = 'home';
      last.gridFragment = null;
      this.render();
      loadHomeVideos(1);
      return;
    }

    const idx = this.tabs.findIndex(t => t.id === tabId);
    if (idx === -1) return;

    const wasActive = this.activeTabId === tabId;
    this.tabs.splice(idx, 1);

    if (wasActive) {
      const newActive = this.tabs[Math.max(0, idx - 1)];
      this.activeTabId = newActive.id;
      this.restoreTabState(newActive);
    } else {
      this.render();
    }
  },

  updateActiveTabInfo(title, icon) {
    const cur = this.tabs.find(t => t.id === this.activeTabId);
    if (!cur) return;
    if (title) cur.title = title;
    if (icon) cur.icon = icon;
    this.render();
  },

  render() {
    if (!this.container) return;
    this.container.innerHTML = '';

    this.tabs.forEach((tab) => {
      const tabEl = document.createElement('div');
      tabEl.className = `app-tab ${tab.id === this.activeTabId ? 'active' : ''}`;
      tabEl.dataset.tabId = tab.id;
      tabEl.title = tab.title;

      tabEl.innerHTML = `
        <i class="app-tab-icon ${tab.icon || 'fa-solid fa-folder'}"></i>
        <span class="app-tab-title">${tab.title}</span>
        ${this.tabs.length > 1 ? `
          <button class="app-tab-close" title="Zamknij kartę (Kółko myszy)">
            <i class="fa-solid fa-xmark"></i>
          </button>
        ` : ''}
      `;

      tabEl.addEventListener('click', (e) => {
        if (e.target.closest('.app-tab-close')) return;
        this.switchToTab(tab.id);
      });

      tabEl.addEventListener('auxclick', (e) => {
        if (e.button === 1) {
          e.preventDefault();
          e.stopPropagation();
          this.closeTab(tab.id);
        }
      });
      tabEl.addEventListener('mousedown', (e) => {
        if (e.button === 1) e.preventDefault();
      });

      const closeBtn = tabEl.querySelector('.app-tab-close');
      if (closeBtn) {
        closeBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.closeTab(tab.id);
        });
      }

      this.container.appendChild(tabEl);
    });
  }
};

// Inicjalizacja
document.addEventListener('DOMContentLoaded', () => {
  initUserStatus();
  initTags();
  initCamwhoresToggle();
  initAuthorFilterToggle();
  initGroupToggle();
  initProfileScanner();
  updateHomeStats();
  updateCheckpointUI();
  tabManager.init();
  
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

  // Globalna obsługa środkowego przycisku myszy (kółko) dla dowolnych linków autorów, tagów i kart
  document.addEventListener('auxclick', (e) => {
    if (e.button === 1) {
      const authorLink = e.target.closest('.model-profile-link, .profile-btn');
      if (authorLink) {
        e.preventDefault();
        e.stopPropagation();
        const username = authorLink.dataset.username || authorLink.textContent.trim().replace(/^[@#]/, '').split(/\s+/)[0];
        if (username) {
          tabManager.openTab({
            title: username,
            icon: 'fa-solid fa-circle-user',
            type: 'model',
            username: username,
            inBackground: true
          });
        }
      }
    }
  });

  // Blokowanie domyślnego kursora autoscrolla Windows przy klikaniu kółkiem w elementy interaktywne
  document.addEventListener('mousedown', (e) => {
    if (e.button === 1) {
      if (e.target.closest('.model-profile-link, .profile-btn, .card-tag-badge, .tag-pill, .app-tab, .app-tab-close, .app-tab-new-btn, .play-btn, .thumbnail-wrapper, .nav-link, .profile-chip')) {
        e.preventDefault();
      }
    }
  });
});

// ============================================================
// PRZEŁĄCZNIK ŹRÓDEŁ (WSZYSTKIE / TYLKO CAMWHORES / TYLKO ARCHIVEBATE)
// ============================================================
function updateCamwhoresToggleUI() {
  const mode = state.sourceFilter || 'all';
  document.body.classList.remove('source-only-camwhores', 'source-only-archivebate', 'hide-camwhores');
  if (dom.toggleCamwhoresBtn) {
    dom.toggleCamwhoresBtn.classList.remove('mode-all', 'mode-only-camwhores', 'mode-only-archivebate', 'active', 'disabled');
  }

  if (mode === 'only-camwhores') {
    document.body.classList.add('source-only-camwhores');
    if (dom.toggleCamwhoresBtn) dom.toggleCamwhoresBtn.classList.add('mode-only-camwhores');
    if (dom.camwhoresToggleLabel) dom.camwhoresToggleLabel.innerText = 'Tylko Camwhores';
    if (dom.sourceToggleIcon) dom.sourceToggleIcon.className = 'fa-solid fa-tv';
  } else if (mode === 'only-archivebate') {
    document.body.classList.add('source-only-archivebate');
    if (dom.toggleCamwhoresBtn) dom.toggleCamwhoresBtn.classList.add('mode-only-archivebate');
    if (dom.camwhoresToggleLabel) dom.camwhoresToggleLabel.innerText = 'Tylko Archivebate';
    if (dom.sourceToggleIcon) dom.sourceToggleIcon.className = 'fa-solid fa-film';
  } else {
    // 'all'
    if (dom.toggleCamwhoresBtn) dom.toggleCamwhoresBtn.classList.add('mode-all');
    if (dom.camwhoresToggleLabel) dom.camwhoresToggleLabel.innerText = 'Wszystkie';
    if (dom.sourceToggleIcon) dom.sourceToggleIcon.className = 'fa-solid fa-layer-group';
  }
}

function initCamwhoresToggle() {
  updateCamwhoresToggleUI();
  if (dom.toggleCamwhoresBtn) {
    dom.toggleCamwhoresBtn.addEventListener('click', () => {
      if (state.sourceFilter === 'all') {
        state.sourceFilter = 'only-camwhores';
        showToast('Źródło: Wyświetlam TYLKO filmy z Camwhores.tv (280 filmów na stronę)', 'info');
      } else if (state.sourceFilter === 'only-camwhores') {
        state.sourceFilter = 'only-archivebate';
        showToast('Źródło: Wyświetlam TYLKO filmy z Archivebate (280 filmów na stronę)', 'info');
      } else {
        state.sourceFilter = 'all';
        showToast('Źródło: Wyświetlam WSZYSTKIE źródła (Archivebate + Camwhores, 280 filmów)', 'info');
      }
      localStorage.setItem('archivebate_source_filter', state.sourceFilter);
      updateCamwhoresToggleUI();
      if (state.mode === 'home') {
        loadHomeVideos(1);
      } else if (state.mode === 'search') {
        performSearch(state.currentQuery, 1);
      }
    });
  }
}

// ============================================================
// FILTROWANIE AUTORÓW (WSZYSCY / TYLKO POLUBIENI / BEZ POLUBIONYCH)
// ============================================================
function updateAuthorFilterUI() {
  const mode = state.authorFilter || 'all';
  document.body.classList.remove('author-filter-only-fav', 'author-filter-exclude-fav');
  if (dom.toggleAuthorFilterBtn) {
    dom.toggleAuthorFilterBtn.classList.remove('mode-all', 'mode-only-fav', 'mode-exclude-fav');
  }

  if (mode === 'only_fav') {
    document.body.classList.add('author-filter-only-fav');
    if (dom.toggleAuthorFilterBtn) dom.toggleAuthorFilterBtn.classList.add('mode-only-fav');
    if (dom.authorFilterLabel) dom.authorFilterLabel.innerText = 'Tylko polubieni';
    if (dom.authorFilterIcon) dom.authorFilterIcon.className = 'fa-solid fa-star';
  } else if (mode === 'exclude_fav') {
    document.body.classList.add('author-filter-exclude-fav');
    if (dom.toggleAuthorFilterBtn) dom.toggleAuthorFilterBtn.classList.add('mode-exclude-fav');
    if (dom.authorFilterLabel) dom.authorFilterLabel.innerText = 'Bez polubionych';
    if (dom.authorFilterIcon) dom.authorFilterIcon.className = 'fa-solid fa-user-slash';
  } else {
    // 'all'
    if (dom.toggleAuthorFilterBtn) dom.toggleAuthorFilterBtn.classList.add('mode-all');
    if (dom.authorFilterLabel) dom.authorFilterLabel.innerText = 'Wszyscy';
    if (dom.authorFilterIcon) dom.authorFilterIcon.className = 'fa-solid fa-users';
  }
}

function initAuthorFilterToggle() {
  updateAuthorFilterUI();
  if (dom.toggleAuthorFilterBtn) {
    dom.toggleAuthorFilterBtn.addEventListener('click', () => {
      if (state.authorFilter === 'all') {
        state.authorFilter = 'only_fav';
        showToast('Autorzy: Pokazuję TYLKO nagrania od polubionych autorów (280 filmów)', 'info');
      } else if (state.authorFilter === 'only_fav') {
        state.authorFilter = 'exclude_fav';
        showToast('Autorzy: Odfiltrowano polubionych — odkrywaj NOWYCH twórców! (280 filmów)', 'info');
      } else {
        state.authorFilter = 'all';
        showToast('Autorzy: Wyświetlam WSZYSTKICH autorów (280 filmów)', 'info');
      }
      localStorage.setItem('archivebate_author_filter', state.authorFilter);
      updateAuthorFilterUI();
      if (state.mode === 'home') {
        loadHomeVideos(1);
      } else if (state.mode === 'search') {
        performSearch(state.currentQuery, 1);
      }
    });
  }
}

// ============================================================
// PRZYCISK I LOGIKA GRUPOWANIA FILMÓW WEDŁUG AUTORA
// ============================================================
function updateGroupToggleUI() {
  const isGrouped = !!state.groupByAuthor;
  if (dom.toggleGroupBtn) {
    dom.toggleGroupBtn.classList.remove('mode-ungrouped', 'mode-grouped');
    if (isGrouped) {
      dom.toggleGroupBtn.classList.add('mode-grouped');
      if (dom.groupToggleLabel) dom.groupToggleLabel.innerText = 'Włączone';
      if (dom.groupToggleIcon) dom.groupToggleIcon.className = 'fa-solid fa-layer-group';
    } else {
      dom.toggleGroupBtn.classList.add('mode-ungrouped');
      if (dom.groupToggleLabel) dom.groupToggleLabel.innerText = 'Wyłączone';
      if (dom.groupToggleIcon) dom.groupToggleIcon.className = 'fa-solid fa-boxes-stacked';
    }
  }
}

function initGroupToggle() {
  updateGroupToggleUI();
  if (dom.toggleGroupBtn) {
    dom.toggleGroupBtn.addEventListener('click', () => {
      state.groupByAuthor = !state.groupByAuthor;
      localStorage.setItem('archivebate_group_by_author', state.groupByAuthor ? 'true' : 'false');
      updateGroupToggleUI();
      if (state.groupByAuthor) {
        showToast('Grupowanie filmów włączone: 1 kafelek na autora (najnowszy film + lista)', 'info');
      } else {
        showToast('Grupowanie filmów wyłączone: wszystkie filmy wyświetlane osobno', 'info');
      }
      if (state.mode === 'home') {
        loadHomeVideos(1);
      } else if (state.mode === 'search') {
        performSearch(state.currentQuery, 1);
      }
    });
  }
}

// GRUPOWANIE FILMÓW WEDŁUG AUTORA (1 KAFELEK NA AUTORA + LISTA POZOSTAŁYCH FILMÓW)
function groupVideosByAuthor(videos) {
  if (!videos || !Array.isArray(videos)) return [];
  const authorMap = new Map();
  const result = [];

  for (const v of videos) {
    if (!v) continue;
    const authorRaw = (v.username || '').trim();
    const norm = authorRaw.toLowerCase().replace(/[^a-z0-9]/g, '');

    // Jeśli wideo z serwera przyszło już jako zgrupowane (backend)
    if (v.is_grouped && Array.isArray(v.grouped_videos) && v.grouped_videos.length > 1) {
      if (!authorMap.has(norm)) {
        const leader = {
          ...v,
          _isGrouped: true,
          _groupCount: v.grouped_videos.length,
          _groupedVideos: [...v.grouped_videos]
        };
        authorMap.set(norm, leader);
        result.push(leader);
      } else {
        const leader = authorMap.get(norm);
        for (const gv of v.grouped_videos) {
          if (!leader._groupedVideos.some(item => String(item.id) === String(gv.id))) {
            leader._groupedVideos.push(gv);
          }
        }
        leader._groupCount = leader._groupedVideos.length;
        leader.group_count = leader._groupCount;
        leader.is_grouped = leader._groupCount > 1;
        leader._isGrouped = leader.is_grouped;
      }
      continue;
    }

    if (!norm || norm === 'model') {
      result.push({
        ...v,
        _isGrouped: false,
        _groupCount: 1,
        _groupedVideos: [v]
      });
      continue;
    }

    if (!authorMap.has(norm)) {
      const leader = {
        ...v,
        _isGrouped: false,
        _groupCount: 1,
        _groupedVideos: [v]
      };
      authorMap.set(norm, leader);
      result.push(leader);
    } else {
      const leader = authorMap.get(norm);
      leader._groupCount = (leader._groupCount || leader.group_count || 1) + 1;
      leader.group_count = leader._groupCount;
      leader._isGrouped = true;
      leader.is_grouped = true;
      if (!leader._groupedVideos) leader._groupedVideos = [leader];
      leader._groupedVideos.push(v);
      leader.grouped_videos = leader._groupedVideos;
    }
  }

  return result;
}

function initProfileScanner() {
  const btn = document.getElementById('quickScanBtn');
  const countSpan = document.getElementById('scannedModelsCount');

  async function updateCount() {
    try {
      const res = await fetch('/api/scan/status');
      if (res.ok) {
        const data = await res.json();
        if (countSpan && data.indexed_models_count) {
          countSpan.innerText = `${data.indexed_models_count} profili`;
        }
      }
    } catch (e) {}
  }

  updateCount();
  setInterval(updateCount, 6000);

  if (btn) {
    btn.addEventListener('click', async () => {
      btn.classList.add('scanning');
      showToast('⚡ Uruchomiono szybkie skanowanie i wzbogacanie profili w tle!', 'info');
      try {
        await fetch('/api/scan/start', { method: 'POST' });
      } catch (e) {}
      setTimeout(() => {
        btn.classList.remove('scanning');
        updateCount();
        updateHomeStats();
      }, 5000);
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
      if (dom.statCatalogVideos && data.catalog_videos !== undefined) {
        dom.statCatalogVideos.innerText = Number(data.catalog_videos).toLocaleString('pl-PL');
      }
      if (dom.statCatalogVideosLbl && data.catalog_pages !== undefined) {
        const p = data.catalog_pages;
        const pWord = p === 1 ? 'strona' : (p % 10 >= 2 && p % 10 <= 4 && (p % 100 < 10 || p % 100 >= 20) ? 'strony' : 'stron');
        dom.statCatalogVideosLbl.innerText = `W katalogu (${p.toLocaleString('pl-PL')} ${pWord})`;
      }
      if (state.mode === 'home' && data.catalog_pages !== undefined) {
        state.lastPage = data.catalog_pages;
        state.totalCatalogVideos = data.catalog_videos;
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

function setupEvents() {
  // Checkpoint navigators
  if (dom.headerCheckpointBtn) dom.headerCheckpointBtn.addEventListener('click', navigateToCheckpoint);
  if (dom.navCheckpointBtn) dom.navCheckpointBtn.addEventListener('click', navigateToCheckpoint);

  // Nawigacja zakładek
  dom.navHomeBtn.addEventListener('click', () => {
    setActiveNavTab(dom.navHomeBtn);
    loadHomeVideos(1);
  });
  dom.navHomeBtn.addEventListener('auxclick', (e) => {
    if (e.button === 1) {
      e.preventDefault();
      e.stopPropagation();
      tabManager.openTab({ title: 'Odkrywaj', icon: 'fa-solid fa-house', type: 'home', action: () => loadHomeVideos(1), inBackground: true });
    }
  });
  dom.navHomeBtn.addEventListener('mousedown', (e) => { if (e.button === 1) e.preventDefault(); });

  dom.navFavoritesBtn.addEventListener('click', () => {
    setActiveNavTab(dom.navFavoritesBtn);
    loadFavorites(1);
  });
  dom.navFavoritesBtn.addEventListener('auxclick', (e) => {
    if (e.button === 1) {
      e.preventDefault();
      e.stopPropagation();
      tabManager.openTab({ title: 'Ulubione', icon: 'fa-solid fa-heart', type: 'favorites', inBackground: true });
    }
  });
  dom.navFavoritesBtn.addEventListener('mousedown', (e) => { if (e.button === 1) e.preventDefault(); });

  dom.navHistoryBtn.addEventListener('click', () => {
    setActiveNavTab(dom.navHistoryBtn);
    loadHistory(1);
  });
  dom.navHistoryBtn.addEventListener('auxclick', (e) => {
    if (e.button === 1) {
      e.preventDefault();
      e.stopPropagation();
      tabManager.openTab({ title: 'Historia', icon: 'fa-solid fa-clock-rotate-left', type: 'history', inBackground: true });
    }
  });
  dom.navHistoryBtn.addEventListener('mousedown', (e) => { if (e.button === 1) e.preventDefault(); });

  dom.navFollowingBtn.addEventListener('click', () => {
    setActiveNavTab(dom.navFollowingBtn);
    loadFollowing(1);
  });
  dom.navFollowingBtn.addEventListener('auxclick', (e) => {
    if (e.button === 1) {
      e.preventDefault();
      e.stopPropagation();
      tabManager.openTab({ title: 'Obserwowane', icon: 'fa-solid fa-user-group', type: 'following', inBackground: true });
    }
  });
  dom.navFollowingBtn.addEventListener('mousedown', (e) => { if (e.button === 1) e.preventDefault(); });

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

  // Wyszukiwarka z debounce
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

  dom.clearSearchBtn.addEventListener('click', () => {
    dom.searchInput.value = '';
    dom.clearSearchBtn.style.display = 'none';
    resetToHome();
  });

  if (dom.navBackBtn) dom.navBackBtn.addEventListener('click', goBack);
  dom.resetFilterBtn.addEventListener('click', resetToHome);
  dom.logoBtn.addEventListener('click', resetToHome);
  dom.logoBtn.addEventListener('auxclick', (e) => {
    if (e.button === 1) {
      e.preventDefault();
      e.stopPropagation();
      tabManager.openTab({ title: 'Odkrywaj', icon: 'fa-solid fa-house', type: 'home', action: () => loadHomeVideos(1), inBackground: true });
    }
  });
  dom.logoBtn.addEventListener('mousedown', (e) => { if (e.button === 1) e.preventDefault(); });

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

// ============================================================
// PŁYNNE DOSTAWIANIE FILMÓW Z KOLEJNEJ STRONY (BEZ ODŚWIEŻANIA SIATKI)
// ============================================================
let topUpInProgress = false;
let pendingTopUp = false;

async function topUpGridVideos(neededCount = null) {
  if (state.mode !== 'home' && state.mode !== 'search') return;
  const targetTotal = 280;
  const currentCount = state.videos ? state.videos.length : 0;
  const needed = (neededCount && neededCount > 0) ? neededCount : (targetTotal - currentCount);
  if (needed <= 0) return;

  if (topUpInProgress) {
    pendingTopUp = true;
    return;
  }
  topUpInProgress = true;

  try {
    const existingIds = new Set((state.videos || []).map(v => String(v.id)));
    const existingSignatures = new Set(
      (state.videos || [])
        .filter(v => v.username && v.username !== 'model' && v.duration && v.duration !== 'N/A' && v.duration !== '00:00')
        .map(v => `${String(v.username).toLowerCase().replace(/[^a-z0-9]/g, '')}|${String(v.duration).trim()}`)
    );

    const blockedSet = new Set(
      (state.blockedModels ? Array.from(state.blockedModels) : []).map(b => String(b).toLowerCase().replace(/[^a-z0-9]/g, ''))
    );
    const favAuthors = state.favoriteAuthors || new Set();

    const isCandidateValid = (v) => {
      if (!v || !v.id) return false;
      const id = String(v.id);
      if (existingIds.has(id)) return false;
      const u = String(v.username || '').toLowerCase().replace(/[^a-z0-9]/g, '');
      if (u && blockedSet.has(u)) return false;
      if (state.authorFilter === 'exclude_fav' && u && favAuthors.has(u)) return false;
      if (state.authorFilter === 'only_fav' && u && !favAuthors.has(u) && !v.is_favorite) return false;
      const dur = String(v.duration || '').trim();
      if (u && u !== 'model' && dur && dur !== 'N/A' && dur !== '00:00') {
        const sig = `${u}|${dur}`;
        if (existingSignatures.has(sig)) return false;
      }
      return true;
    };

    const src = encodeURIComponent(state.sourceFilter || 'all');
    const af = encodeURIComponent(state.authorFilter || 'all');
    const grp = state.groupByAuthor ? '1' : '0';

    // Pobieramy kandydatów z następnej strony katalogu lub wyników wyszukiwania
    const nextPage = state.currentPage < (state.lastPage || 100) ? state.currentPage + 1 : state.currentPage;
    const url = state.mode === 'search'
      ? `/api/search?q=${encodeURIComponent(state.currentQuery)}&page=${nextPage}&source=${src}&author_filter=${af}&group_authors=${grp}`
      : `/api/videos?page=${nextPage}&source=${src}&author_filter=${af}&group_authors=${grp}`;
    const data = await ArchivebateAPI.getJSON(url, { timeoutMs: 15000 });

    let candidates = Array.isArray(data?.videos) ? data.videos : [];
    let valid = candidates.filter(isCandidateValid);

    // Jeśli na następnej stronie brakowało wystarczającej liczby unikalnych wideo, sprawdzamy kolejną stronę
    if (valid.length < needed && nextPage < (state.lastPage || 100)) {
      try {
        const url2 = state.mode === 'search'
          ? `/api/search?q=${encodeURIComponent(state.currentQuery)}&page=${nextPage + 1}&source=${src}&author_filter=${af}&group_authors=${grp}`
          : `/api/videos?page=${nextPage + 1}&source=${src}&author_filter=${af}&group_authors=${grp}`;
        const data2 = await ArchivebateAPI.getJSON(url2, { timeoutMs: 15000 });
        const c2 = Array.isArray(data2?.videos) ? data2.videos : [];
        valid = valid.concat(c2.filter(isCandidateValid));
      } catch (_) {}
    }

    const toAdd = valid.slice(0, needed);
    if (toAdd.length > 0) {
      const fragment = document.createDocumentFragment();
      toAdd.forEach((newVid) => {
        existingIds.add(String(newVid.id));
        const u = String(newVid.username || '').toLowerCase().replace(/[^a-z0-9]/g, '');
        const dur = String(newVid.duration || '').trim();
        if (u && dur) existingSignatures.add(`${u}|${dur}`);

        state.videos.push(newVid);
        const card = createVideoCard(newVid, state.videos.length - 1);
        card.style.opacity = '0';
        card.style.transform = 'translateY(12px)';
        card.style.transition = 'opacity 0.3s cubic-bezier(0.4, 0, 0.2, 1), transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)';
        fragment.appendChild(card);
        requestAnimationFrame(() => {
          card.style.opacity = '1';
          card.style.transform = 'translateY(0)';
        });
      });

      dom.videoGrid.appendChild(fragment);
      scheduleThumbnailWarmup(toAdd, 0, toAdd.length);
    }

    // Zaktualizuj liczniki bez ruszania siatki
    if (data && data.total_videos) state.totalCatalogVideos = data.total_videos;
    if (data && data.last_page) state.lastPage = data.last_page;

    const catStr = state.totalCatalogVideos ? `${state.totalCatalogVideos.toLocaleString('pl-PL')} w katalogu` : '';
    dom.videoCount.innerText = `${state.videos.length} na stronie • ${catStr} (strona ${state.currentPage} z ${state.lastPage}) • 5.5M+ w serwisach`;
    if (dom.statPageVideos) dom.statPageVideos.innerText = `${state.videos.length}`;
    if (dom.statCatalogVideos && state.totalCatalogVideos) {
      dom.statCatalogVideos.innerText = state.totalCatalogVideos.toLocaleString('pl-PL');
    }
    if (dom.statCatalogVideosLbl && state.lastPage) {
      const p = state.lastPage;
      const pWord = p === 1 ? 'strona' : (p % 10 >= 2 && p % 10 <= 4 && (p % 100 < 10 || p % 100 >= 20) ? 'strony' : 'stron');
      dom.statCatalogVideosLbl.innerText = `W katalogu (${p.toLocaleString('pl-PL')} ${pWord})`;
    }
    renderPagination();
  } catch (err) {
    console.error('Błąd dociągania wideo bez przeładowania:', err);
  } finally {
    topUpInProgress = false;
    if (pendingTopUp) {
      pendingTopUp = false;
      const curNeeded = targetTotal - (state.videos ? state.videos.length : 0);
      if (curNeeded > 0) {
        topUpGridVideos(curNeeded);
      }
    }
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

    const normU = (video.username || '').toLowerCase().replace(/[^a-z0-9]/g, '');

    // Sprawdzenie czy kafelki powinny natychmiast zniknąć z bieżącego widoku
    let shouldRemove = false;
    let removeOnlyThisVideo = false;

    if (isFav && state.authorFilter === 'exclude_fav') {
      // W trybie "Bez polubionych" polubienie twórcy natychmiast usuwa jej kafelki z ekranu
      shouldRemove = true;
      removeOnlyThisVideo = false;
    } else if (!isFav && state.mode === 'favorites') {
      // W zakładce Ulubione usunięcie filmu usuwa kafelek z listy
      shouldRemove = true;
      removeOnlyThisVideo = true;
    } else if (!isFav && state.authorFilter === 'only_fav') {
      // W trybie "Tylko polubieni" jeśli twórca nie ma już polubionych filmów, usuwamy jej kafelki
      const hasOtherFavs = normU && state.favoriteAuthors && state.favoriteAuthors.has(normU);
      shouldRemove = true;
      removeOnlyThisVideo = hasOtherFavs;
    }

    if (shouldRemove) {
      let removedCount = 0;
      document.querySelectorAll('.video-card').forEach(c => {
        const u = (c.dataset.username || '').toLowerCase().replace(/[^a-z0-9]/g, '');
        const vidId = String(c.dataset.videoId || '');
        const match = removeOnlyThisVideo
          ? vidId === String(video.id)
          : ((normU && u === normU) || vidId === String(video.id));
        if (match) {
          removedCount++;
          c.style.transition = 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)';
          c.style.opacity = '0';
          c.style.transform = 'scale(0.85)';
          setTimeout(() => c.remove(), 250);
        }
      });

      state.videos = state.videos.filter(v => {
        const u = (v.username || '').toLowerCase().replace(/[^a-z0-9]/g, '');
        const vidId = String(v.id || '');
        if (removeOnlyThisVideo) {
          return vidId !== String(video.id);
        }
        return (normU ? u !== normU : true) && vidId !== String(video.id);
      });

      // Zaktualizuj licznik na stronie
      if (dom.videoCount && (state.mode === 'home' || state.mode === 'search')) {
        const catStr = state.totalCatalogVideos ? `${state.totalCatalogVideos.toLocaleString('pl-PL')} w katalogu` : '';
        dom.videoCount.innerText = `${state.videos.length} na stronie • ${catStr} (strona ${state.currentPage} z ${state.lastPage}) • 5.5M+ w serwisach`;
      }
      if (dom.statPageVideos) dom.statPageVideos.innerText = `${state.videos.length}`;

      // Jeśli jesteśmy na stronie głównej lub wyszukiwania, płynnie dostaw brakujące wideo z kolejnej strony (BEZ ODŚWIEŻANIA SIATKI!)
      if (state.mode === 'home' || state.mode === 'search') {
        setTimeout(() => {
          topUpGridVideos(removedCount);
        }, 260);
      } else if (state.mode === 'favorites') {
        dom.videoCount.innerText = `${state.videos.length} na stronie • ${state.favoritesCount} w ulubionych`;
        if (dom.statPageVideos) dom.statPageVideos.innerText = `${state.videos.length}`;
      }
    }

    const toastMsg = isFav
      ? (state.authorFilter === 'exclude_fav'
          ? `Dodano "${video.username || 'wideo'}" do ulubionych ❤️ (ukryto z widoku "Bez polubionych")`
          : 'Dodano do ulubionych ❤️')
      : 'Usunięto z ulubionych';
    showToast(toastMsg, isFav ? 'success' : 'info');
    return isFav;
  } catch (e) {
    showToast('Błąd aktualizacji ulubionych', 'error');
    return false;
  }
}

// ============================================================
// BLOKOWANIE I USUNIĘCIE PROFILU Z PROGRAMU
// ============================================================
function getEffectiveVideoUsername(video) {
  if (!video) return '';
  const u = (video.username || '').trim();
  if (u && u.toLowerCase() !== 'model') return u;

  // 1. Próba odzyskania z tytułu (np. "lustflare1-2026.01.05-footjob-and-blowjob")
  if (video.title) {
    const t = video.title.trim();
    const token = t.split(/[-_\s]/)[0].replace(/^[^a-zA-Z0-9]+|[^a-zA-Z0-9]+$/g, '');
    if (token && token.length >= 3 && token.length <= 25 && !['the', 'hot', 'cum', 'cam', 'sex', 'live', 'show', 'video', 'best', 'new', 'real', 'watch', 'free'].includes(token.toLowerCase())) {
      return token;
    }
  }

  // 2. Próba odzyskania z adresu URL
  if (video.url) {
    const m = video.url.match(/videos\/\d+\/([a-zA-Z0-9_\-]+)/);
    if (m && m[1]) {
      const p0 = m[1].split(/[-_]/)[0].replace(/^[^a-zA-Z0-9]+|[^a-zA-Z0-9]+$/g, '');
      if (p0 && p0.length >= 3 && p0.length <= 25 && !['the', 'hot', 'cum', 'cam', 'sex', 'live', 'show', 'video', 'best', 'new', 'real', 'watch', 'free'].includes(p0.toLowerCase())) {
        return p0;
      }
    }
  }

  // 3. Próba odzyskania ze słów kluczowych
  if (Array.isArray(video.keywords) && video.keywords.length > 0) {
    for (const kw of video.keywords) {
      const clean = kw.trim();
      if (clean && clean.length >= 3 && clean.length <= 25 && /^[a-zA-Z0-9_]+$/.test(clean)) {
        if (!['chaturbate', 'stripchat', 'onlyfans', 'camwhores', 'feet', 'anal', 'blowjob', 'couple', 'milf', 'teen', 'trans', 'footjob', 'toes', 'soles', 'dildo'].includes(clean.toLowerCase())) {
          return clean;
        }
      }
    }
  }

  return u || '';
}

function isModelBlocked(username) {
  if (!username || !state.blockedModels) return false;
  const raw = String(username).trim().toLowerCase();
  const clean = raw.replace(/[^a-z0-9]/g, '');
  if (state.blockedModels instanceof Set) {
    return state.blockedModels.has(raw) || state.blockedModels.has(clean);
  }
  if (Array.isArray(state.blockedModels)) {
    return state.blockedModels.includes(raw) || state.blockedModels.includes(clean);
  }
  return false;
}

function isSameVideo(v1, v2) {
  if (!v1 || !v2) return false;
  const id1 = v1.id ? String(v1.id) : null;
  const id2 = v2.id ? String(v2.id) : null;
  if (id1 && id2 && id1 === id2) return true;
  const raw1 = v1.raw_id ? String(v1.raw_id) : (id1 ? id1.replace('cw_', '') : null);
  const raw2 = v2.raw_id ? String(v2.raw_id) : (id2 ? id2.replace('cw_', '') : null);
  if (raw1 && raw2 && raw1 === raw2) return true;
  if (v1.url && v2.url && v1.url === v2.url) return true;
  return false;
}

async function findNextAuthorVideo(blockedUsername) {
  const normBlocked = (blockedUsername || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!normBlocked) return null;

  const isCandidateValid = (vid) => {
    if (!vid) return false;
    const effectiveU = getEffectiveVideoUsername(vid);
    const norm = (effectiveU || vid.username || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!norm || norm === 'model' || norm === normBlocked) return false;
    if (isModelBlocked(norm) || isModelBlocked(vid.username)) return false;
    return true;
  };

  // 1. Jeśli jesteśmy w profilu modelki (state.mode === 'model')
  if (state.mode === 'model') {
    if (state.navHistory && state.navHistory.length > 0) {
      for (let h = state.navHistory.length - 1; h >= 0; h--) {
        const histItem = state.navHistory[h];
        if (histItem && Array.isArray(histItem.videos) && histItem.videos.length > 0) {
          const vids = histItem.videos;
          let startIdx = -1;
          if (state.lastClickedGridVideo) {
            startIdx = vids.findIndex(v => isSameVideo(v, state.lastClickedGridVideo));
          }
          if (startIdx === -1) {
            startIdx = vids.findIndex(v => {
              const u = (getEffectiveVideoUsername(v) || v.username || '').toLowerCase().replace(/[^a-z0-9]/g, '');
              return u === normBlocked;
            });
          }
          const searchStart = startIdx !== -1 ? startIdx + 1 : 0;
          for (let i = searchStart; i < vids.length; i++) {
            if (isCandidateValid(vids[i])) {
              return { video: vids[i], source: 'history', historyItem: histItem, index: i };
            }
          }
          for (let i = 0; i < searchStart && i < vids.length; i++) {
            if (isCandidateValid(vids[i])) {
              return { video: vids[i], source: 'history', historyItem: histItem, index: i };
            }
          }
        }
      }
    }

    try {
      const catData = await ArchivebateAPI.getJSON('/api/videos?page=1', { timeoutMs: 8000 });
      const catVids = catData?.videos || [];
      for (const v of catVids) {
        if (isCandidateValid(v)) {
          return { video: v, source: 'catalog' };
        }
      }
    } catch (e) {}
  }

  // 2. Widok kafelkowy (strona główna, wyszukiwarka, ulubione, tagi itp.)
  const isGrouped = Boolean(state.groupByAuthor && (state.mode === 'home' || state.mode === 'search'));
  const gridList = isGrouped ? groupVideosByAuthor(state.videos) : (state.videos || []);

  if (gridList.length > 0) {
    const targetVideo = state.lastClickedGridVideo || state.currentVideoDetails;
    let clickedIdx = -1;

    if (targetVideo) {
      clickedIdx = gridList.findIndex(v => isSameVideo(v, targetVideo));
    }

    if (clickedIdx === -1) {
      clickedIdx = gridList.findIndex(v => {
        const u = (getEffectiveVideoUsername(v) || v.username || '').toLowerCase().replace(/[^a-z0-9]/g, '');
        return u === normBlocked;
      });
    }

    // Szukamy następnego filmu licząc w przód od klikniętej miniatury (clickedIdx + 1)
    const searchStart = clickedIdx !== -1 ? clickedIdx + 1 : 0;

    // Przeszukiwanie w przód do końca bieżącej strony
    for (let i = searchStart; i < gridList.length; i++) {
      if (isCandidateValid(gridList[i])) {
        return { video: gridList[i], source: 'current_view', index: i };
      }
    }

    // Jeśli dotarliśmy do końca strony, sprawdzamy kolejną stronę katalogu
    if (state.currentPage < (state.lastPage || 100)) {
      try {
        const nextPage = state.currentPage + 1;
        let nextUrl = `/api/videos?page=${nextPage}`;
        if (state.mode === 'search' && state.currentQuery) {
          nextUrl = `/api/search?q=${encodeURIComponent(state.currentQuery)}&page=${nextPage}`;
        }
        const data = await ArchivebateAPI.getJSON(nextUrl, { timeoutMs: 8000 });
        const nextVids = data?.videos || [];
        const nextBase = isGrouped ? groupVideosByAuthor(nextVids) : nextVids;
        for (const v of nextBase) {
          if (isCandidateValid(v)) {
            return { video: v, source: 'next_page', newPage: nextPage };
          }
        }
      } catch (e) {}
    }

    // Wrap-around: dopiero jeśli na kolejnych stronach nic nie ma, szukaj od początku do klikniętego indeksu
    for (let i = 0; i < searchStart && i < gridList.length; i++) {
      if (isCandidateValid(gridList[i])) {
        return { video: gridList[i], source: 'current_view', index: i };
      }
    }
  }

  return null;
}

async function blockModel(username) {
  let effectiveUsername = username;
  if (!effectiveUsername || effectiveUsername.toLowerCase() === 'model') {
    effectiveUsername = getEffectiveVideoUsername(state.currentVideoDetails);
  }
  if (!effectiveUsername || effectiveUsername.toLowerCase() === 'model') return;
  username = effectiveUsername;

  const norm = username.toLowerCase().replace(/[^a-z0-9]/g, '');

  const isModalOpen = Boolean(dom.videoModal && dom.videoModal.classList.contains('active'));
  const currentModalAuthorNorm = (getEffectiveVideoUsername(state.currentVideoDetails) || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const isCurrentInModal = isModalOpen && (currentModalAuthorNorm === norm || !currentModalAuthorNorm);

  // 1. Znajdź następnego autora ZANIM zablokujemy modelkę w pamięci i przefiltrujemy widok
  let nextAuthorCandidate = null;
  if (isCurrentInModal) {
    try {
      nextAuthorCandidate = await findNextAuthorVideo(username);
    } catch (err) {
      console.warn('Błąd wyszukiwania następnego autora:', err);
    }
  }

  // 2. Blokujemy profil w pamięci
  if (!state.blockedModels) state.blockedModels = new Set();
  state.blockedModels.add(norm);

  // 3. Natychmiastowe zniknięcie kafelków z widoku (0 ms dla użytkownika)
  let visibleCount = 0;
  document.querySelectorAll('.video-card').forEach(c => {
    const link = c.querySelector('.model-profile-link');
    const u = (link?.dataset?.username || c.dataset.username || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    if (u === norm) {
      visibleCount++;
      c.style.transition = 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)';
      c.style.opacity = '0';
      c.style.transform = 'scale(0.85)';
      setTimeout(() => c.remove(), 250);
    }
  });

  // Usuń z tablicy wideo
  state.videos = state.videos.filter(v => {
    const u = (v.username || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    return u !== norm;
  });

  // Wyczyść również z historii nawigacji
  if (state.navHistory && Array.isArray(state.navHistory)) {
    state.navHistory.forEach(h => {
      if (Array.isArray(h.videos)) {
        h.videos = h.videos.filter(v => (v.username || '').toLowerCase().replace(/[^a-z0-9]/g, '') !== norm);
      }
    });
  }

  // 4. Jeśli odtwarzacz wideo jest otwarty z tą modelką:
  // Zamiast zamykać odtwarzacz i wracać do strony głównej, natychmiast załaduj i odtwórz kolejnego autora!
  if (isCurrentInModal) {
    if (nextAuthorCandidate && nextAuthorCandidate.video) {
      const nextVid = nextAuthorCandidate.video;
      state.lastClickedGridVideo = nextVid;
      openVideoModal(nextVid);
      showToast(`Zablokowano profil "${username}". Odtwarzanie kolejnego autora: ${nextVid.username}`, 'success');

      if (state.mode === 'model' && nextVid.username) {
        loadModelVideos(nextVid.username, 1);
      } else if (nextAuthorCandidate.source === 'next_page' && nextAuthorCandidate.newPage) {
        changePage(nextAuthorCandidate.newPage);
      }
    } else {
      closeModal();
      showToast(`Zablokowano profil "${username}". Brak kolejnych autorów do odtworzenia.`, 'info');
    }
  }

  // Zaktualizuj natychmiast licznik na stronie
  if (dom.videoCount && (state.mode === 'home' || state.mode === 'search')) {
    const catStr = state.totalCatalogVideos ? `${state.totalCatalogVideos.toLocaleString('pl-PL')} w katalogu` : '';
    dom.videoCount.innerText = `${state.videos.length} na stronie • ${catStr} (strona ${state.currentPage} z ${state.lastPage}) • 5.5M+ w serwisach`;
  }
  if (dom.statPageVideos) dom.statPageVideos.innerText = `${state.videos.length}`;

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

      // Jeśli jesteśmy na stronie głównej lub wyszukiwania, płynnie dostaw brakujące filmy z następnej strony (BEZ ODŚWIEŻANIA SIATKI!)
      if (state.mode === 'home' || state.mode === 'search') {
        setTimeout(() => {
          topUpGridVideos(visibleCount);
        }, 260);
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
      updateHomeStats();
      if (state.mode === 'home') {
        loadHomeVideos(state.currentPage);
      }
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

      pill.title = `Filtruj tag #${t.name} (LPM) lub otwórz w nowej karcie (Kółko myszy)`;
      pill.addEventListener('click', () => {
        document.querySelectorAll('.tag-pill').forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        dom.searchInput.value = `#${t.tag}`;
        dom.clearSearchBtn.style.display = 'flex';
        setActiveNavTab(null);
        performSearch(t.tag, 1);
      });
      pill.addEventListener('auxclick', (e) => {
        if (e.button === 1) {
          e.preventDefault();
          e.stopPropagation();
          tabManager.openTab({
            title: `#${t.name}`,
            icon: 'fa-solid fa-tag',
            type: 'search',
            query: `#${t.tag}`,
            inBackground: true
          });
        }
      });
      pill.addEventListener('mousedown', (e) => {
        if (e.button === 1) e.preventDefault();
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
  if (state.lastPage && page > state.lastPage) page = state.lastPage;
  state.currentPage = page;
  tabManager.updateActiveTabInfo('Odkrywaj', 'fa-solid fa-house');

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
  if (state.groupByAuthor) filterTitle += ' • Zgrupowane (1/autora)';

  dom.viewTitle.innerText = filterTitle;
  dom.resetFilterBtn.style.display = 'none';
  updateBackButtonUI();
  dom.matchedProfiles.style.display = 'none';
  dom.pageJumpInput.value = page;
  updateHomeStats();

  try {
    const src = encodeURIComponent(state.sourceFilter || 'all');
    const af = encodeURIComponent(state.authorFilter || 'all');
    const grp = state.groupByAuthor ? '1' : '0';
    const data = await ArchivebateAPI.getJSON(`/api/videos?page=${page}&source=${src}&author_filter=${af}&group_authors=${grp}`, { timeoutMs: 25000 });
    state.videos = deduplicateVideos(data.videos || []);
    state.lastPage = data.last_page || state.lastPage || 1;
    state.totalCatalogVideos = data.total_videos;

    renderVideoGrid(state.videos);
    scheduleThumbnailWarmup(state.videos);
    scheduleTopVideosDetailsWarmup(state.videos);
    const catStr = data.total_videos ? `${data.total_videos.toLocaleString('pl-PL')} w katalogu` : '';
    dom.videoCount.innerText = `${state.videos.length} na stronie • ${catStr} (strona ${page} z ${state.lastPage}) • 5.5M+ w serwisach`;
    if (dom.statPageVideos) {
      dom.statPageVideos.innerText = `${state.videos.length}`;
    }
    if (dom.statCatalogVideos && data.total_videos) {
      dom.statCatalogVideos.innerText = data.total_videos.toLocaleString('pl-PL');
    }
    if (dom.statCatalogVideosLbl && data.last_page) {
      const p = data.last_page;
      const pWord = p === 1 ? 'strona' : (p % 10 >= 2 && p % 10 <= 4 && (p % 100 < 10 || p % 100 >= 20) ? 'strony' : 'stron');
      dom.statCatalogVideosLbl.innerText = `W katalogu (${p.toLocaleString('pl-PL')} ${pWord})`;
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
  tabManager.updateActiveTabInfo('Ulubione', 'fa-solid fa-heart');

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
  tabManager.updateActiveTabInfo('Historia', 'fa-solid fa-clock-rotate-left');

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
  tabManager.updateActiveTabInfo('Obserwowane', 'fa-solid fa-user-group');

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
  tabManager.updateActiveTabInfo('Panel Konta', 'fa-solid fa-circle-user');
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
  tabManager.updateActiveTabInfo(isTag ? `#${cleanTagName}` : `Szukaj: ${query}`, isTag ? 'fa-solid fa-tag' : 'fa-solid fa-magnifying-glass');

  dom.accountPanelView.style.display = 'none';
  dom.tagsSection.style.display = 'block';
  if (dom.homeStatsBar) dom.homeStatsBar.style.display = 'none';
  dom.contentHeader.style.display = 'flex';
  let filterSuffix = '';
  if (state.sourceFilter === 'only-camwhores') filterSuffix += ' • Tylko Camwhores';
  else if (state.sourceFilter === 'only-archivebate') filterSuffix += ' • Tylko Archivebate';
  if (state.authorFilter === 'only_fav') filterSuffix += ' • Tylko polubieni';
  else if (state.authorFilter === 'exclude_fav') filterSuffix += ' • Bez polubionych';
  if (state.groupByAuthor) filterSuffix += ' • Zgrupowane (1/autora)';

  dom.viewTitle.innerText = isTag ? `🏷️ Tag: #${cleanTagName}${filterSuffix} (Strona ${page})` : `Wyniki dla: "${query}"${filterSuffix} (Strona ${page})`;
  dom.resetFilterBtn.style.display = 'flex';
  updateBackButtonUI();
  dom.pageJumpInput.value = page;

  const src = encodeURIComponent(state.sourceFilter || 'all');
  const af = encodeURIComponent(state.authorFilter || 'all');
  const grp = state.groupByAuthor ? '1' : '0';

  // Dla kolejnych stron (page > 1) pobieramy błyskawicznie z pamięci RAM (cache)
  if (page > 1) {
    showSkeletons();
    state.isLoading = true;
    if (dom.paginationSection) dom.paginationSection.style.display = 'flex';
    try {
      const data = await ArchivebateAPI.getJSON(`/api/search?q=${encodeURIComponent(query)}&page=${page}&source=${src}&author_filter=${af}&group_authors=${grp}`, { timeoutMs: 15000 });
      state.lastPage = data.last_page || 1;
      state.videos = data.videos || [];
      renderVideoGrid(state.videos);
      scheduleThumbnailWarmup(state.videos);
      renderPagination();
      dom.videoCount.innerText = `${state.videos.length} na stronie • Strona ${page} z ${state.lastPage} • Łącznie: ${Number(data.total_videos || 0).toLocaleString('pl-PL')} filmów • 5.5M+ w serwisach`;
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

  const evtSource = new EventSource(`/api/search/stream?q=${encodeURIComponent(query)}&source=${src}&author_filter=${af}&group_authors=${grp}`);
  state.activeSearchSource = evtSource;

  evtSource.onmessage = (event) => {
    try {
      const payload = JSON.parse(event.data);

      if (payload.type === 'profiles') {
        if (payload.last_page) {
          state.lastPage = payload.last_page;
          renderPagination();
        }
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
            chip.title = `Zobacz profil ${p.username} (LPM) lub otwórz w nowej karcie (Kółko myszy)`;
            chip.addEventListener('click', () => loadModelVideos(p.username, 1));
            chip.addEventListener('auxclick', (e) => {
              if (e.button === 1) {
                e.preventDefault();
                e.stopPropagation();
                tabManager.openTab({
                  title: p.username,
                  icon: 'fa-solid fa-circle-user',
                  type: 'model',
                  username: p.username,
                  inBackground: true
                });
              }
            });
            chip.addEventListener('mousedown', (e) => {
              if (e.button === 1) e.preventDefault();
            });
            dom.profilesList.appendChild(chip);
          });
        }
        const totalP = payload.total_profiles || profiles.length;
        const estTotal = payload.estimated_total_videos ? ` • szacunkowo ~${Number(payload.estimated_total_videos).toLocaleString('pl-PL')} filmów` : '';
        dom.videoCount.innerText = `Znaleziono ${totalP} profili${estTotal}. Pobieranie nagrań...`;
      } else if (payload.type === 'videos') {
        const newVids = payload.videos || [];
        if (newVids.length > 0) {
          if (isFirstBatch) {
            dom.videoGrid.innerHTML = '';
            isFirstBatch = false;
          }
          accumulatedVideos = accumulatedVideos.concat(newVids);
          state.videos = accumulatedVideos;

          if (state.groupByAuthor) {
            renderVideoGrid(state.videos);
          } else {
            appendVideoBatch(newVids);
          }
          if (!state.lastPage || state.lastPage < 2) {
            state.lastPage = Math.max(state.lastPage || 1, Math.ceil(accumulatedVideos.length / 280));
          }
          renderPagination();
          dom.videoCount.innerText = `Załadowano ${accumulatedVideos.length} filmów • Strona 1 z ${state.lastPage} (wyszukiwanie trwa...)`;
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
          state.lastPage = payload.last_page || Math.ceil(totalCount / 280) || 1;
          dom.videoCount.innerText = `${accumulatedVideos.length} na stronie • Strona 1 z ${state.lastPage} • Łącznie: ${Number(totalCount).toLocaleString('pl-PL')} filmów • 5.5M+ w serwisach`;
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

// ============================================================
// HISTORIA NAWIGACJI I OBSŁUGA PRZYCISKU "COFNIJ"
// ============================================================
state.navHistory = [];

function pushNavigationHistory() {
  // Zapisujemy stan tylko, jeśli wchodzimy do profilu modelki z innego widoku (home, search, etc.)
  if (state.mode !== 'model') {
    state.navHistory.push({
      mode: state.mode,
      currentPage: state.currentPage,
      lastPage: state.lastPage,
      currentQuery: state.currentQuery,
      currentModel: state.currentModel,
      videos: Array.isArray(state.videos) ? [...state.videos] : [],
      viewTitle: dom.viewTitle ? dom.viewTitle.innerText : '',
      videoCount: dom.videoCount ? dom.videoCount.innerText : '',
      totalCatalogVideos: state.totalCatalogVideos,
      scrollY: window.scrollY || document.documentElement.scrollTop || 0
    });
    if (state.navHistory.length > 20) state.navHistory.shift();
  }
}

function updateBackButtonUI() {
  if (!dom.navBackBtn) return;
  if (state.mode === 'model' || (state.navHistory && state.navHistory.length > 0)) {
    dom.navBackBtn.style.display = 'inline-flex';
    const last = state.navHistory && state.navHistory.length > 0 ? state.navHistory[state.navHistory.length - 1] : null;
    if (last) {
      const targetName = last.mode === 'home'
        ? `Strona główna (str. ${last.currentPage})`
        : (last.mode === 'search' ? `${last.currentQuery} (str. ${last.currentPage})` : 'poprzedni widok');
      dom.navBackBtn.title = `Cofnij do: ${targetName}`;
      dom.navBackBtn.innerHTML = `<i class="fa-solid fa-arrow-left"></i> Cofnij`;
    } else {
      dom.navBackBtn.title = 'Wróć do poprzedniego widoku';
      dom.navBackBtn.innerHTML = `<i class="fa-solid fa-arrow-left"></i> Cofnij`;
    }
  } else {
    dom.navBackBtn.style.display = 'none';
  }
}

function goBack() {
  if (!state.navHistory || state.navHistory.length === 0) {
    resetToHome();
    return;
  }
  const prev = state.navHistory.pop();

  state.mode = prev.mode;
  state.currentPage = prev.currentPage;
  state.lastPage = prev.lastPage;
  state.currentModel = prev.currentModel;
  state.currentQuery = prev.currentQuery;
  state.videos = prev.videos;
  state.totalCatalogVideos = prev.totalCatalogVideos;

  updateBackButtonUI();

  if (dom.viewTitle && prev.viewTitle) dom.viewTitle.innerText = prev.viewTitle;
  if (dom.videoCount && prev.videoCount) dom.videoCount.innerText = prev.videoCount;
  if (dom.pageJumpInput) dom.pageJumpInput.value = prev.currentPage;

  if (prev.mode === 'home') {
    dom.accountPanelView.style.display = 'none';
    dom.tagsSection.style.display = 'block';
    if (dom.homeStatsBar) dom.homeStatsBar.style.display = 'grid';
    dom.contentHeader.style.display = 'flex';
    dom.resetFilterBtn.style.display = 'none';
    dom.matchedProfiles.style.display = 'none';
    dom.searchInput.value = '';
    dom.clearSearchBtn.style.display = 'none';
    setActiveNavTab(dom.navHomeBtn);
    renderVideoGrid(prev.videos);
    renderPagination();
  } else if (prev.mode === 'search') {
    dom.accountPanelView.style.display = 'none';
    dom.tagsSection.style.display = 'block';
    if (dom.homeStatsBar) dom.homeStatsBar.style.display = 'none';
    dom.contentHeader.style.display = 'flex';
    dom.resetFilterBtn.style.display = 'flex';
    dom.searchInput.value = prev.currentQuery || '';
    dom.clearSearchBtn.style.display = dom.searchInput.value ? 'flex' : 'none';
    setActiveNavTab(null);
    renderVideoGrid(prev.videos);
    renderPagination();
  } else if (prev.mode === 'model') {
    loadModelVideos(prev.currentModel, prev.currentPage);
    return;
  } else {
    renderVideoGrid(prev.videos);
    renderPagination();
  }

  if (prev.scrollY) {
    window.scrollTo({ top: prev.scrollY, behavior: 'instant' });
  }
}

// FILMY DANEJ MODELKI
async function loadModelVideos(username, page = 1) {
  if (state.isLoading) return;
  pushNavigationHistory();
  state.isLoading = true;
  state.mode = 'model';
  state.currentModel = username;
  state.currentPage = page;
  state.lastPage = 20;
  tabManager.updateActiveTabInfo(username, 'fa-solid fa-circle-user');

  showSkeletons();
  dom.accountPanelView.style.display = 'none';
  dom.tagsSection.style.display = 'block';
  if (dom.homeStatsBar) dom.homeStatsBar.style.display = 'none';
  dom.contentHeader.style.display = 'flex';
  dom.viewTitle.innerText = `Filmy modelki: ${username} (Strona ${page})`;
  updateBackButtonUI();
  dom.resetFilterBtn.style.display = 'flex';
  dom.matchedProfiles.style.display = 'none';
  dom.paginationSection.style.display = 'flex';
  dom.pageJumpInput.value = page;

  try {
    const data = await ArchivebateAPI.getJSON(`/api/model/${encodeURIComponent(username)}?page=${page}`, { timeoutMs: 15000 });
    state.videos = data.videos || [];

    renderVideoGrid(state.videos);
    scheduleThumbnailWarmup(state.videos);
    dom.videoCount.innerText = `${state.videos.length} na stronie • Modelka: ${username} • 5.5M+ w serwisach`;
    
    if (state.videos.length === 0 && page > 1) {
      state.lastPage = page - 1;
    }
    renderPagination();
    prefetchNextPage();
  } catch (e) {
    showToast(e?.message || `Błąd ładowania filmów dla ${username}`, 'error');
  } finally {
    state.isLoading = false;
  }
}

function resetToHome() {
  state.navHistory = [];
  updateBackButtonUI();
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
function prefetchVideoDetails(videoId) {
  if (!videoId) return Promise.resolve(null);
  const cached = videoDetailsCache.get(videoId);
  if (cached) return Promise.resolve(cached);
  if (videoDetailsInflight.has(videoId)) return videoDetailsInflight.get(videoId);
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

function scheduleTopVideosDetailsWarmup(videos, count = 4) {
  if (!Array.isArray(videos) || videos.length === 0) return;
  ArchivebatePerf.idle(() => {
    const topVids = videos.slice(0, count);
    topVids.forEach((v, i) => {
      if (v && v.id) {
        setTimeout(() => prefetchVideoDetails(v.id), i * 300);
      }
    });
  }, 1000);
}

let activeHoverVideo = null;

function createVideoCard(v, idx) {
  const isCamwhores = v.source === 'camwhores' || String(v.id).startsWith('cw_') || (v.platform && v.platform.toLowerCase().includes('camwhores'));
  const isFav = !!v.is_favorite;
  const isFavAuthor = isFavoriteAuthor(v.username) || v.has_favorite_video;
  const isFavCard = isFav || isFavAuthor;

  const isGrouped = Boolean(v.is_grouped || v._isGrouped || (v.group_count && v.group_count > 1) || (v._groupCount && v._groupCount > 1));
  const groupCount = v.group_count || v._groupCount || (v.grouped_videos ? v.grouped_videos.length : (v._groupedVideos ? v._groupedVideos.length : 1));
  const groupedVideosList = v.grouped_videos || v._groupedVideos || [];

  const card = document.createElement('div');
  card.className = `video-card ${isFavCard ? 'is-favorite-card' : ''} ${isGrouped && groupCount > 1 ? 'is-grouped-card' : ''}`;
  card.dataset.videoId = String(v.id);
  card.dataset.username = String(v.username || '').toLowerCase().trim();
  card.dataset.source = isCamwhores ? 'camwhores' : 'archivebate';

  // Do wyświetlania preferujemy lokalne proxy: po pierwszym pobraniu trafia ono do
  // RAM/dysku i kolejne wejścia są natychmiastowe (0.2 ms). Współdzielimy ten sam
  // kanoniczny adres z mechanizmem warmup (scheduleThumbnailWarmup), unikając duplikowania transferu.
  const directPoster = v.poster_direct || (v.poster ? v.poster.replace(/\.mp4$/, '.jpg') : '');
  const rawPoster = directPoster || (v.poster ? v.poster.replace(/\.mp4$/, '.jpg') : '');
  const canonicalPoster = thumbnailUrlForVideo(v) || directPoster;
  const posterUrl = canonicalPoster || directPoster;
  const displayPoster = canonicalPoster;
  const backupPoster = directPoster;

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
      ${isGrouped && groupCount > 1 ? `
        <span class="badge-group-count" title="Ten autor ma ${groupCount} filmów na liście. Kliknij, aby rozwinąć listę!">
          <i class="fa-solid fa-layer-group"></i> ${groupCount} filmów
        </span>
      ` : ''}
      
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
        ${isGrouped && groupCount > 1 ? `<span class="author-group-pill" title="Zgrupowano ${groupCount} nagrań tego twórcy"><i class="fa-solid fa-clone"></i> Grupa (${groupCount})</span>` : ''}
        <span class="card-date-badge" data-video-id="${v.id}" title="Kliknij na datę, aby ustawić punkt kontrolny (checkpoint)"><i class="fa-regular fa-calendar-days"></i> ${v.date || 'Niedawno'}</span>
      </div>

      <div class="card-tags-row">
        ${(v.tags || []).slice(0, 3).map(t => `<span class="card-tag-badge" data-tag="${t.toLowerCase()}">#${t}</span>`).join('')}
      </div>

      <div class="card-actions-row">
        <button class="btn-card primary play-btn">
          <i class="fa-solid fa-play"></i> Odtwórz
        </button>
        <button class="btn-card profile-btn" data-username="${v.username}" title="Zobacz profil i nagrania modelki ${v.username}">
          <i class="fa-solid fa-folder${isGrouped && groupCount > 1 ? '-open' : ''}"></i> ${isGrouped && groupCount > 1 ? `${groupCount} filmów` : 'Filmy'}
        </button>
        ${isGrouped && groupCount > 1 ? `
          <button class="btn-card expand-group-btn" title="Rozwiń podgląd wszystkich ${groupCount} filmów tej grupy">
            <i class="fa-solid fa-chevron-down"></i>
          </button>
        ` : ''}
        <button class="btn-card danger block-model-btn" data-username="${v.username}" title="Zablokuj modelkę: usuń ten profil z katalogu programu i ukryj wszystkie jej nagrania">
          <i class="fa-solid fa-ban"></i>
        </button>
      </div>
      ${isGrouped && groupCount > 1 ? `
        <div class="grouped-videos-drawer" style="display: none;"></div>
      ` : ''}
    </div>
  `;

  // Punkt kontrolny (checkpoint) po kliknięciu na datę
  const dateBadge = card.querySelector('.card-date-badge');
  if (dateBadge) {
    dateBadge.dataset.origDate = v.date || 'Niedawno';
    dateBadge.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      setCheckpoint(v);
    });
  }

  // Kliknięcie w tag na kafelku rozpoczyna wyszukiwanie filmów z tym tagiem
  card.querySelectorAll('.card-tag-badge').forEach(tagBadge => {
    const clickedTag = tagBadge.dataset.tag;
    tagBadge.title = `Filtruj tag #${clickedTag} (LPM) lub otwórz w nowej karcie (Kółko myszy)`;
    tagBadge.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      if (clickedTag) {
        dom.searchInput.value = `#${clickedTag}`;
        dom.clearSearchBtn.style.display = 'flex';
        setActiveNavTab(null);
        performSearch(clickedTag, 1);
      }
    });
    tagBadge.addEventListener('auxclick', (e) => {
      if (e.button === 1) {
        e.preventDefault();
        e.stopPropagation();
        if (clickedTag) {
          tabManager.openTab({
            title: `#${clickedTag}`,
            icon: 'fa-solid fa-tag',
            type: 'search',
            query: `#${clickedTag}`,
            inBackground: true
          });
        }
      }
    });
    tagBadge.addEventListener('mousedown', (e) => {
      if (e.button === 1) e.preventDefault();
    });
  });


  // Szybkie dodawanie do ulubionych
  const favBtn = card.querySelector('.card-fav-btn');
  favBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleFavoriteVideo(v, favBtn);
  });

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

  const timelinePrefix = v.timeline_prefix || (rawPoster && rawPoster.includes('/180x135/') ? rawPoster.substring(0, rawPoster.indexOf('/180x135/') + 9) : null);
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
      if (activeHoverVideo && activeHoverVideo !== hoverVideo) {
        try {
          activeHoverVideo.pause();
          activeHoverVideo.removeAttribute('src');
          activeHoverVideo.load();
        } catch (_) {}
      }
      activeHoverVideo = hoverVideo;

      hoverVideo.src = previewSrc;
      hoverVideo.preload = 'auto';
      hoverVideo.muted = true;
      hoverVideo.playsInline = true;
      hoverVideo.onplaying = () => {
        if (isHovered) {
          hoverVideo.style.opacity = '1';
          hoverVideo.style.display = 'block';
        }
      };
      hoverVideo.oncanplay = () => {
        if (isHovered && pendingPos === null) {
          hoverVideo.style.opacity = '1';
          hoverVideo.style.display = 'block';
        }
      };
      hoverVideo.load();
      hoverVideo.play().catch(() => {});
    }
  }

  function seekHoverVideo(pos) {
    if (!hoverVideo || !hoverVideo.src) return;
    try {
      const pDur = hoverVideo.duration || 3;
      hoverVideo.currentTime = Math.max(0, Math.min(pDur, pos * pDur));
      hoverVideo.style.opacity = '1';
      hoverVideo.style.display = 'block';
    } catch (e) {}
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

    // 2. Klatka ze storyboardu z cache jeśli dostępna
    if (showLocalStoryboardFrame(pos)) {
      return;
    }

    // 3. Dla Archivebate - aktualizacja klatki podglądu TYLKO jeśli podgląd już wystartował po upływie debounca
    pendingPos = pos;
    if (hoverVideo && hoverVideo.src) {
      seekHoverVideo(pos);
    }
  }

  if (hoverVideo) {
    hoverVideo.addEventListener('error', () => {
      hoverVideo.style.display = 'none';
    });
  }

  let hoverPreviewTimer = null;

  function scheduleVideoPreview() {
    if (timelinePrefix) return; // Camwhores korzysta ze storyboardu klatek, nie potrzebuje streamu wideo!
    clearTimeout(hoverPreviewTimer);
    hoverPreviewTimer = setTimeout(() => {
      if (isHovered) {
        prefetchVideoDetails(v.id);
        startVideoPreview();
        if (pendingPos !== null) {
          seekHoverVideo(pendingPos);
        }
      }
    }, 250);
  }

  thumbWrapper.addEventListener('mouseenter', (e) => {
    isHovered = true;
    if (timelinePrefix) preloadFrames();
    else {
      loadCachedCardStoryboard();
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

  thumbWrapper.addEventListener('mouseleave', () => {
    isHovered = false;
    pendingPos = null;
    clearTimeout(hoverPreviewTimer);
    clearTimeout(hoverSeekTimer);
    clearTimeout(storyboardWarmTimer);
    isSeekingHover = false;
    if (activeHoverVideo === hoverVideo) {
      activeHoverVideo = null;
    }
    if (hoverVideo) {
      hoverVideo.pause();
      hoverVideo.currentTime = 0;
      hoverVideo.style.opacity = '0';
      // Natychmiastowe odcięcie połączenia w tle, aby nie blokować pasma internetu!
      hoverVideo.removeAttribute('src');
      hoverVideo.load();
    }
    if (hoverFrame) hoverFrame.style.display = 'none';
    if (scrubProgress) scrubProgress.style.width = '0%';
    if (scrubThumb) scrubThumb.style.left = '0%';
    if (scrubTooltip) scrubTooltip.style.display = 'none';
  });

  // Otwieranie lewym przyciskiem myszy w oknie modalnym
  thumbWrapper.addEventListener('pointerdown', (e) => {
    if (e.button === 0) clearTimeout(hoverPreviewTimer);
  });
  thumbWrapper.addEventListener('click', (e) => {
    if (e.button === 0) {
      state.lastClickedGridVideo = v;
      state.lastClickedGridIndex = idx;
      openVideoModal(v);
    }
  });

  // Otwieranie kółkiem myszy (middle click) w nowej karcie programu desktop
  thumbWrapper.addEventListener('auxclick', (e) => {
    if (e.button === 1) {
      e.preventDefault();
      e.stopPropagation();
      tabManager.openTab({
        title: v.username ? `${v.username} (Wideo)` : 'Odtwarzacz',
        icon: 'fa-solid fa-play',
        type: 'watch',
        video: v,
        inBackground: true
      });
    }
  });
  thumbWrapper.addEventListener('mousedown', (e) => {
    if (e.button === 1) {
      e.preventDefault();
    }
  });

  const playBtn = card.querySelector('.play-btn');
  if (playBtn) {
    playBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      state.lastClickedGridVideo = v;
      state.lastClickedGridIndex = idx;
      openVideoModal(v);
    });
    playBtn.addEventListener('auxclick', (e) => {
      if (e.button === 1) {
        e.preventDefault();
        e.stopPropagation();
        tabManager.openTab({
          title: v.username ? `${v.username} (Wideo)` : 'Odtwarzacz',
          icon: 'fa-solid fa-play',
          type: 'watch',
          video: v,
          inBackground: true
        });
      }
    });
    playBtn.addEventListener('mousedown', (e) => {
      if (e.button === 1) e.preventDefault();
    });
  }

  const modelLink = card.querySelector('.model-profile-link');
  if (modelLink) {
    modelLink.title = `Zobacz profil ${v.username} (LPM) lub otwórz w nowej karcie (Kółko myszy)`;
    modelLink.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      loadModelVideos(v.username, 1);
    });
    modelLink.addEventListener('auxclick', (e) => {
      if (e.button === 1) {
        e.preventDefault();
        e.stopPropagation();
        tabManager.openTab({
          title: v.username,
          icon: 'fa-solid fa-circle-user',
          type: 'model',
          username: v.username,
          inBackground: true
        });
      }
    });
    modelLink.addEventListener('mousedown', (e) => {
      if (e.button === 1) e.preventDefault();
    });
  }

  const profileBtn = card.querySelector('.profile-btn');
  if (profileBtn) {
    profileBtn.title = `Zobacz nagrania modelki ${v.username} (LPM) lub otwórz w nowej karcie (Kółko myszy)`;
    profileBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      loadModelVideos(v.username, 1);
    });
    profileBtn.addEventListener('auxclick', (e) => {
      if (e.button === 1) {
        e.preventDefault();
        e.stopPropagation();
        tabManager.openTab({
          title: v.username,
          icon: 'fa-solid fa-circle-user',
          type: 'model',
          username: v.username,
          inBackground: true
        });
      }
    });
    profileBtn.addEventListener('mousedown', (e) => {
      if (e.button === 1) e.preventDefault();
    });
  }

  const blockBtn = card.querySelector('.block-model-btn');
  if (blockBtn) {
    blockBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      blockModel(v.username);
    });
  }

  // Obsługa rozwijanej szuflady z filmami danej grupy (autora)
  if (isGrouped && groupCount > 1) {
    const groupBadge = card.querySelector('.badge-group-count');
    const expandBtn = card.querySelector('.expand-group-btn');
    const drawer = card.querySelector('.grouped-videos-drawer');

    const toggleDrawer = (e) => {
      if (e) {
        e.stopPropagation();
        e.preventDefault();
      }
      if (!drawer) return;
      const isVisible = drawer.style.display !== 'none';
      if (isVisible) {
        drawer.style.display = 'none';
        if (expandBtn) expandBtn.innerHTML = '<i class="fa-solid fa-chevron-down"></i>';
      } else {
        drawer.style.display = 'flex';
        if (expandBtn) expandBtn.innerHTML = '<i class="fa-solid fa-chevron-up"></i>';
        if (drawer.children.length === 0) {
          const header = document.createElement('div');
          header.className = 'grouped-drawer-header';
          header.innerHTML = `<span><i class="fa-solid fa-layer-group"></i> ${groupCount} filmów twórcy (${v.username})</span><span style="font-size: 10px; opacity: 0.7;">LPM: odtwórz | Kółko: nowa karta</span>`;
          drawer.appendChild(header);

          groupedVideosList.forEach((gv, gIdx) => {
            const row = document.createElement('div');
            row.className = 'grouped-item-row';
            row.title = `${gv.title || gv.username} (${gv.duration || 'N/A'}) - LPM: odtwórz, Kółko myszy: nowa karta`;
            const gThumb = thumbnailUrlForVideo(gv) || gv.poster_direct || '';
            const gBackup = gv.poster_direct || '';
            row.innerHTML = `
              <img class="grouped-item-thumb" src="${gThumb}" alt="${gv.username}" loading="lazy" onerror="if(this.dataset.retried){this.style.opacity=0.3;}else{this.dataset.retried='1';this.src='${gBackup}';}">
              <div class="grouped-item-info">
                <div class="grouped-item-title">${gIdx + 1}. ${gv.date || 'Wideo'} • ${gv.duration || ''}</div>
                <div class="grouped-item-meta">
                  <span>${gv.platform || (gv.source === 'camwhores' ? 'Camwhores' : 'Archive')}</span>
                  ${gv.views ? `<span>• <i class="fa-solid fa-eye"></i> ${gv.views}</span>` : ''}
                </div>
              </div>
              <div class="grouped-item-play-btn"><i class="fa-solid fa-play"></i></div>
            `;

            row.addEventListener('click', (ev) => {
              ev.stopPropagation();
              ev.preventDefault();
              state.lastClickedGridVideo = v;
              state.lastClickedGridIndex = idx;
              openVideoModal(gv);
            });

            row.addEventListener('auxclick', (ev) => {
              if (ev.button === 1) {
                ev.preventDefault();
                ev.stopPropagation();
                tabManager.openTab({
                  title: gv.username ? `${gv.username} (Wideo)` : 'Odtwarzacz',
                  icon: 'fa-solid fa-play',
                  type: 'watch',
                  video: gv,
                  inBackground: true
                });
              }
            });

            row.addEventListener('mousedown', (ev) => {
              if (ev.button === 1) ev.preventDefault();
            });

            drawer.appendChild(row);
          });
        }
      }
    };

    if (groupBadge) groupBadge.addEventListener('click', toggleDrawer);
    if (expandBtn) expandBtn.addEventListener('click', toggleDrawer);
  }

  card.addEventListener('pointerenter', () => {
    prefetchVideoDetails(v.id);
  }, { passive: true, once: true });

  return card;
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

// RENDEROWANIE KAFELKÓW: pierwszy ekran natychmiast, reszta w małych porcjach
// w czasie bezczynności. Dzięki temu setki kart nie blokują głównego wątku naraz.
function renderVideoGrid(videos) {
  dom.videoGrid.innerHTML = '';
  if (!videos || videos.length === 0) return;

  videos = deduplicateVideos(videos);

  // Jeśli włączone jest grupowanie filmów według autora na stronie głównej lub w tagach
  const shouldGroup = state.groupByAuthor && (state.mode === 'home' || state.mode === 'search');
  const displayVideos = shouldGroup ? groupVideosByAuthor(videos) : videos;

  const INITIAL_BATCH = 32;
  const CHUNK_SIZE = 32;
  const initial = displayVideos.slice(0, INITIAL_BATCH);
  const firstFragment = document.createDocumentFragment();

  initial.forEach((v, idx) => firstFragment.appendChild(createVideoCard(v, idx)));
  dom.videoGrid.appendChild(firstFragment);
  updateCheckpointUI();
  checkAndHighlightCheckpoint();

  let cursor = INITIAL_BATCH;
  const appendNextChunk = () => {
    if (cursor >= displayVideos.length) return;
    const end = Math.min(cursor + CHUNK_SIZE, displayVideos.length);
    const fragment = document.createDocumentFragment();
    for (let i = cursor; i < end; i += 1) {
      fragment.appendChild(createVideoCard(displayVideos[i], i));
    }
    dom.videoGrid.appendChild(fragment);
    cursor = end;

    if (cursor < displayVideos.length) {
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

  if (cursor < displayVideos.length) {
    if ('requestIdleCallback' in window) {
      requestIdleCallback(appendNextChunk, { timeout: 200 });
    } else {
      setTimeout(appendNextChunk, 16);
    }
  }
}

// STOPNIOWE DOKŁADANIE KAFELKÓW W CZASIE RZECZYWISTYM ("PO KOLEI")
function appendVideoBatch(videos) {
  if (!videos || videos.length === 0) return;
  const currentCount = dom.videoGrid.querySelectorAll('.video-card').length;
  videos.forEach((v, idx) => {
    const card = createVideoCard(v, currentCount + idx);
    card.classList.add('stream-appear');
    dom.videoGrid.appendChild(card);
  });
  updateCheckpointUI();
  checkAndHighlightCheckpoint();
}

function prefetchNextModalVideo() {
  try {
    const list = getActiveFilteredVideos();
    const idx = getCurrentVideoIndex();
    if (idx >= 0 && idx + 1 < list.length) {
      const nextVid = list[idx + 1];
      if (nextVid && nextVid.id) {
        prefetchVideoDetails(nextVid.id);
      }
    }
  } catch (e) {}
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

  // Jeśli film należy do grupy, natychmiast uzupełniamy playlistę autora (dla strzałek Góra/Dół)
  const groupedList = video?.grouped_videos || video?._groupedVideos;
  if (groupedList && groupedList.length > 1 && video?.username) {
    const normU = video.username.trim().toLowerCase();
    authorPlaylists.set(normU, {
      username: video.username,
      videos: [...groupedList],
      page: 1,
      hasMore: true,
      isLoading: false
    });
  }

  dom.modalVideo.style.display = 'block';
  dom.modalIframe.style.display = 'none';
  dom.modalIframe.src = '';
  dom.videoLoader.style.display = 'flex';

  const hideLoadingPoster = () => {
    if (dom.modalLoadingPoster) {
      dom.modalLoadingPoster.style.opacity = '0';
      setTimeout(() => {
        if (dom.modalLoadingPoster && dom.modalLoadingPoster.style.opacity === '0') {
          dom.modalLoadingPoster.style.display = 'none';
        }
      }, 350);
    }
    dom.videoLoader.style.display = 'none';
  };

  dom.modalVideo.onloadeddata = hideLoadingPoster;
  dom.modalVideo.oncanplay = hideLoadingPoster;
  dom.modalVideo.ontimeupdate = () => {
    if (dom.modalVideo.currentTime > 0) hideLoadingPoster();
  };
  dom.modalVideo.onplaying = () => {
    hideLoadingPoster();
    prefetchNextModalVideo();
  };
  dom.modalVideo.onerror = () => {
    hideLoadingPoster();
    showToast('Błąd ładowania strumienia. Spróbuj odświeżyć.', 'error');
  };

  // 1. NATYCHMIASTOWY START STRUMIENIA WIDEO (0 ms opóźnienia, bez czekania na pobranie metadanych JSON)
  const immediateStream = (video && video.id) ? `/api/video/stream?id=${encodeURIComponent(video.id)}` : '';
  if (immediateStream) {
    dom.modalVideo.src = immediateStream;
    dom.modalVideo.preload = 'auto';
    dom.modalVideo.load();
    const p1 = dom.modalVideo.play();
    if (p1 !== undefined) {
      p1.catch(() => {
        if (dom.modalCenterPlay) dom.modalCenterPlay.style.display = 'flex';
      });
    }
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
  dom.modalModelName.style.cursor = 'pointer';
  dom.modalModelName.title = `Zobacz profil ${video.username} (LPM) lub otwórz w nowej karcie (Kółko myszy)`;
  dom.modalModelName.onclick = (e) => {
    e.stopPropagation();
    closeModal();
    loadModelVideos(video.username, 1);
  };
  dom.modalModelName.onauxclick = (e) => {
    if (e.button === 1) {
      e.preventDefault();
      e.stopPropagation();
      tabManager.openTab({
        title: video.username,
        icon: 'fa-solid fa-circle-user',
        type: 'model',
        username: video.username,
        inBackground: true
      });
    }
  };
  dom.modalModelName.onmousedown = (e) => {
    if (e.button === 1) e.preventDefault();
  };

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

  // Pre-warming filmów w profilu autora (dla 0 ms opóźnienia przy nawigacji strzałkami góra/dół)
  if (video && video.username && video.username.toLowerCase() !== 'model') {
    getAuthorVideosList(video.username).catch(() => {});
  }

  dom.modalViewModelVideosBtn.title = `Zobacz nagrania modelki ${video.username} (LPM) lub otwórz w nowej karcie (Kółko myszy)`;
  dom.modalViewModelVideosBtn.onclick = () => {
    closeModal();
    loadModelVideos(video.username, 1);
  };
  dom.modalViewModelVideosBtn.onauxclick = (e) => {
    if (e.button === 1) {
      e.preventDefault();
      e.stopPropagation();
      tabManager.openTab({
        title: video.username,
        icon: 'fa-solid fa-circle-user',
        type: 'model',
        username: video.username,
        inBackground: true
      });
    }
  };
  dom.modalViewModelVideosBtn.onmousedown = (e) => {
    if (e.button === 1) e.preventDefault();
  };

  if (dom.modalBlockModelBtn) {
    dom.modalBlockModelBtn.onclick = (e) => {
      e.stopPropagation();
      blockModel(video.username);
    };
  }

  dom.videoModal.classList.add('active');
  document.body.style.overflow = 'hidden';

  try {
    let details = (video && video.id) ? videoDetailsCache.get(video.id) : null;
    if (!details || (!details.proxy_stream_url && !details.direct_url)) {
      details = await ArchivebateAPI.getJSON(`/api/video/details?id=${encodeURIComponent(video.id || video.url)}`, { timeoutMs: 12000 });
      if (video && video.id && (details.proxy_stream_url || details.direct_url)) {
        videoDetailsCache.set(video.id, details);
      }
    }
    const resolvedUsername = getEffectiveVideoUsername(video) || getEffectiveVideoUsername(details) || 'Model';
    state.currentVideoDetails = {
      ...video,
      ...details,
      username: resolvedUsername
    };

    if (resolvedUsername && resolvedUsername.toLowerCase() !== 'model') {
      dom.modalModelName.innerText = `${resolvedUsername} • ${video.date || details.date || ''}`;
      dom.modalViewModelVideosBtn.title = `Zobacz nagrania modelki ${resolvedUsername} (LPM) lub otwórz w nowej karcie (Kółko myszy)`;
      dom.modalViewModelVideosBtn.onclick = () => {
        closeModal();
        loadModelVideos(resolvedUsername, 1);
      };
      if (dom.modalBlockModelBtn) {
        dom.modalBlockModelBtn.onclick = (e) => {
          e.stopPropagation();
          blockModel(resolvedUsername);
        };
      }
    }

    updateModalFavButton(!!details.is_favorite);

    if (details.is_private) {
      dom.videoLoader.style.display = 'none';
      if (dom.modalLoadingPoster) dom.modalLoadingPoster.style.display = 'none';
      dom.modalVideo.pause();
      dom.modalVideo.removeAttribute('src');
      dom.modalVideo.load();
      showToast('Ten film jest oznaczony jako prywatny na Camwhores (dostępny tylko dla członków serwisu)', 'error', 6000);
      dom.modalKeywords.innerHTML = '<div style="color: #f87171; font-weight: 600; padding: 6px 0;"><i class="fa-solid fa-lock"></i> Film prywatny na Camwhores (dostępny wyłącznie dla zalogowanych autorów serwisu).</div>';
      return;
    }

    // ZAWSZE priorytet dla bezreklamowego lokalnego proxy strumienia MP4
    const streamSource = details.proxy_stream_url || details.direct_url;

    if (streamSource) {
      const currentSrc = dom.modalVideo.getAttribute('src') || dom.modalVideo.src || '';
      const normalize = (u) => {
        try { return new URL(u, window.location.href).href; } catch(e) { return u; }
      };
      if (!currentSrc || normalize(currentSrc) !== normalize(streamSource)) {
        dom.modalVideo.src = streamSource;
        dom.modalVideo.preload = 'auto';
        dom.modalVideo.load();
        const p2 = dom.modalVideo.play();
        if (p2 !== undefined) {
          p2.catch(() => {
            if (dom.modalCenterPlay) dom.modalCenterPlay.style.display = 'flex';
          });
        }
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
        // Archivebate: Rzeczywisty strumień filmu dla podglądu klatka po klatce
        state.currentTimelinePrefix = null;
        state.currentTimelineCount = 0;
        state.timelineSpriteBoard = null;
        if (dom.modalTimelinePreviewImg) dom.modalTimelinePreviewImg.style.display = 'none';
        if (dom.modalTimelinePreviewVideo) {
          dom.modalTimelinePreviewVideo.style.display = 'none';
          dom.modalTimelinePreviewVideo.pause();
          dom.modalTimelinePreviewVideo.removeAttribute('src');
          // Odroczone podpinanie - 100% pasma i gniazd należy do głównego playera przy starcie!
          let warmedTimeline = false;
          const warmTimeline = () => {
            if (warmedTimeline || !dom.modalTimelinePreviewVideo) return;
            warmedTimeline = true;
            dom.modalTimelinePreviewVideo.src = streamSource;
            dom.modalTimelinePreviewVideo.preload = 'metadata';
            dom.modalTimelinePreviewVideo.muted = true;
            dom.modalTimelinePreviewVideo.playsInline = true;
            dom.modalTimelinePreviewVideo.load();
          };
          if (dom.modalTimelineContainer) {
            dom.modalTimelineContainer.addEventListener('pointerenter', warmTimeline, { once: true });
          }
        }
        if (dom.modalTimelineSprite && window.ArchivebateYouTubeStoryboard) {
          ArchivebateYouTubeStoryboard.clearFrame(dom.modalTimelineSprite);
        }
        if (dom.modalTimelinePreviewStatus) {
          dom.modalTimelinePreviewStatus.style.display = 'none';
        }
      }

      if (dom.modalTimelineProgress) dom.modalTimelineProgress.style.width = '0%';
      if (dom.modalTimelineThumb) dom.modalTimelineThumb.style.left = '0%';
      if (dom.modalTimelineBuffer) dom.modalTimelineBuffer.style.width = '0%';
    } else {
      if (dom.modalLoadingPoster) dom.modalLoadingPoster.style.display = 'none';
      dom.videoLoader.style.display = 'none';
      showToast('Nie znaleziono bezpośredniego strumienia wideo', 'error');
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
    dom.videoLoader.style.display = 'none';
    showToast('Błąd pobierania wideo', 'error');
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

// LISTA WIDOCZNYCH FILMÓW (Z UWZGLĘDNIENIEM FILTRA ARCHIVEBATE / CAMWHORES I ZABLOKOWANYCH / POLUBIONYCH AUTORÓW)
function getActiveFilteredVideos() {
  if (!state.videos || state.videos.length === 0) return [];
  const mode = state.sourceFilter || 'all';
  const af = state.authorFilter || 'all';
  const favAuthors = state.favoriteAuthors || new Set();

  const baseList = (state.groupByAuthor && (state.mode === 'home' || state.mode === 'search'))
    ? groupVideosByAuthor(state.videos)
    : state.videos;

  return baseList.filter(v => {
    const authorNorm = (v.username || '').toLowerCase().trim();
    const authorClean = authorNorm.replace(/[^a-z0-9]/g, '');
    if (isModelBlocked(v.username)) {
      return false;
    }
    const isCamwhores = v.source === 'camwhores' || String(v.id).startsWith('cw_') || (v.platform && v.platform.toLowerCase().includes('camwhores'));
    if (mode === 'only-camwhores' && !isCamwhores) {
      return false;
    } else if (mode === 'only-archivebate' && isCamwhores) {
      return false;
    }

    const isFav = v.is_favorite || favAuthors.has(authorNorm) || favAuthors.has(authorClean);
    if (af === 'only_fav' && !isFav) {
      return false;
    } else if (af === 'exclude_fav' && isFav) {
      return false;
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

// ==========================================
// NAWIGACJA PO FILMACH W PROFILU AUTORA (STRZAŁKI GÓRA / DÓŁ)
// ==========================================
const authorPlaylists = new Map();

async function getAuthorVideosList(username) {
  if (!username || username.toLowerCase() === 'model') return null;
  const normUser = username.trim().toLowerCase();

  let playlist = authorPlaylists.get(normUser);
  if (!playlist) {
    playlist = {
      username: username,
      videos: [],
      page: 1,
      hasMore: true,
      isLoading: false
    };
    authorPlaylists.set(normUser, playlist);

    // Jeśli aktualny film należy do tej autorki, dodajemy go jako pierwszy element
    if (state.currentVideoDetails && (state.currentVideoDetails.username || '').trim().toLowerCase() === normUser) {
      playlist.videos.push(state.currentVideoDetails);
    }
  }

  // Jeśli użytkownik przegląda już profil tej modelki (state.mode === 'model')
  if (state.mode === 'model' && (state.currentModel || '').trim().toLowerCase() === normUser && Array.isArray(state.videos) && state.videos.length > 0) {
    const existingIds = new Set(playlist.videos.map(v => String(v.id || v.url)));
    for (const v of state.videos) {
      const vidKey = String(v.id || v.url);
      if (!existingIds.has(vidKey)) {
        playlist.videos.push(v);
        existingIds.add(vidKey);
      }
    }
  }

  // Dociągnij stronę 1 z API jeśli lista jest pusta lub zawiera tylko 1 film
  if (playlist.videos.length <= 1 && playlist.hasMore && !playlist.isLoading) {
    playlist.isLoading = true;
    try {
      const data = await ArchivebateAPI.getJSON(`/api/model/${encodeURIComponent(username)}?page=1`, { timeoutMs: 12000 });
      const fetched = data?.videos || [];
      if (fetched.length > 0) {
        const existingIds = new Set(playlist.videos.map(v => String(v.id || v.url)));
        for (const v of fetched) {
          const vidKey = String(v.id || v.url);
          if (!existingIds.has(vidKey)) {
            playlist.videos.push(v);
            existingIds.add(vidKey);
          }
        }
      } else {
        playlist.hasMore = false;
      }
    } catch (e) {
      console.warn('Nie udało się pobrać filmów autora:', username, e);
    } finally {
      playlist.isLoading = false;
    }
  }

  return playlist;
}

function getAuthorVideoIndex(playlist, currentVideo) {
  if (!playlist || !Array.isArray(playlist.videos) || playlist.videos.length === 0 || !currentVideo) return -1;
  const currId = String(currentVideo.id || '');
  const currUrl = currentVideo.url || '';
  return playlist.videos.findIndex(v => (currId && String(v.id || '') === currId) || (currUrl && v.url === currUrl));
}

async function playNextAuthorVideo() {
  const current = state.currentVideoDetails;
  const username = getEffectiveVideoUsername(current);
  if (!username || username.toLowerCase() === 'model') {
    showToast('Brak profilu autora dla tego filmu', 'info');
    return;
  }

  const playlist = await getAuthorVideosList(username);
  if (!playlist || playlist.videos.length === 0) {
    showToast(`Brak filmów w profilu autora ${username}`, 'info');
    return;
  }

  let idx = getAuthorVideoIndex(playlist, current);
  if (idx === -1) {
    idx = 0;
    if (String(playlist.videos[0].id || '') !== String(current.id || '')) {
      const nextVid = playlist.videos[0];
      showToast(`Profil: ${username} (1/${playlist.videos.length})`, 'info', 1400);
      openVideoModal(nextVid);
      return;
    }
  }

  if (idx < playlist.videos.length - 1) {
    const nextVid = playlist.videos[idx + 1];
    showToast(`Profil: ${username} (${idx + 2}/${playlist.videos.length}) • ${nextVid.date || ''}`, 'info', 1400);
    openVideoModal(nextVid);
    return;
  }

  // Ostatni załadowany film w pamięci - dociągamy kolejną stronę filmów modelki
  if (playlist.hasMore && !playlist.isLoading) {
    playlist.isLoading = true;
    showToast(`Dociąganie kolejnych filmów dla ${username}...`, 'info', 1200);
    try {
      const nextPage = (playlist.page || 1) + 1;
      const data = await ArchivebateAPI.getJSON(`/api/model/${encodeURIComponent(username)}?page=${nextPage}`, { timeoutMs: 12000 });
      const fetched = data?.videos || [];
      playlist.page = nextPage;
      if (fetched.length === 0) {
        playlist.hasMore = false;
        showToast(`To jest ostatni film w profilu ${username}. Naciśnij ↑ aby cofnąć.`, 'info', 2000);
      } else {
        const existingIds = new Set(playlist.videos.map(v => String(v.id || v.url)));
        let addedCount = 0;
        for (const v of fetched) {
          const vidKey = String(v.id || v.url);
          if (!existingIds.has(vidKey)) {
            playlist.videos.push(v);
            existingIds.add(vidKey);
            addedCount++;
          }
        }
        if (addedCount > 0 && idx < playlist.videos.length - 1) {
          const nextVid = playlist.videos[idx + 1];
          showToast(`Profil: ${username} (${idx + 2}/${playlist.videos.length}) • ${nextVid.date || ''}`, 'info', 1400);
          openVideoModal(nextVid);
          return;
        } else {
          playlist.hasMore = false;
          showToast(`To jest ostatni film w profilu ${username}. Naciśnij ↑ aby cofnąć.`, 'info', 2000);
        }
      }
    } catch (e) {
      showToast(`Błąd pobierania kolejnych filmów dla ${username}`, 'error');
    } finally {
      playlist.isLoading = false;
    }
    return;
  }

  showToast(`To jest ostatni film w profilu ${username}. Naciśnij ↑ aby cofnąć.`, 'info', 2000);
}

async function playPrevAuthorVideo() {
  const current = state.currentVideoDetails;
  const username = getEffectiveVideoUsername(current);
  if (!username || username.toLowerCase() === 'model') {
    showToast('Brak profilu autora dla tego filmu', 'info');
    return;
  }

  const playlist = await getAuthorVideosList(username);
  if (!playlist || playlist.videos.length === 0) {
    showToast(`Brak filmów w profilu autora ${username}`, 'info');
    return;
  }

  let idx = getAuthorVideoIndex(playlist, current);
  if (idx > 0) {
    const prevVid = playlist.videos[idx - 1];
    showToast(`Profil: ${username} (${idx}/${playlist.videos.length}) • ${prevVid.date || ''}`, 'info', 1400);
    openVideoModal(prevVid);
    return;
  }

  showToast(`To jest najnowszy (pierwszy) film w profilu ${username}. Naciśnij ↓ aby przejść do kolejnego.`, 'info', 2200);
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
  let toast = existingToast;
  let icon = 'fa-info-circle';
  if (type === 'success') icon = 'fa-circle-check';
  if (type === 'error') icon = 'fa-circle-exclamation';

  if (!toast || !toast.parentNode) {
    const last = dom.toastContainer?.lastElementChild;
    if (last && last.innerText && last.innerText.includes(message)) {
      toast = last;
    } else {
      toast = document.createElement('div');
      toast.className = 'toast';
      dom.toastContainer.appendChild(toast);
    }
  }
  toast.innerHTML = `<i class="fa-solid ${icon}" style="color: ${type === 'success' ? 'var(--success)' : type === 'error' ? 'var(--danger)' : 'var(--primary)'}"></i> <span>${message}</span>`;
  toast.style.opacity = '1';
  toast.style.transform = 'none';

  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 4000);

  return toast;
}

// FORMATOWANIE CZASU DLA ODTWARZACZA
function formatPlayerTime(seconds) {
  if (isNaN(seconds) || seconds < 0) seconds = 0;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) {
    return `${h}:${m < 10 ? '0' : ''}${m}:${s < 10 ? '0' : ''}${s}`;
  }
  return `${m < 10 ? '0' : ''}${m}:${s < 10 ? '0' : ''}${s}`;
}

function parseDurationToSeconds(durStr) {
  if (!durStr || durStr === 'N/A') return 0;
  const parts = String(durStr).trim().split(':').map(Number);
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return 0;
}

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
  if (dom.modalCtrlPrevAuthorBtn) {
    dom.modalCtrlPrevAuthorBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      playPrevAuthorVideo();
    });
  }
  if (dom.modalCtrlNextAuthorBtn) {
    dom.modalCtrlNextAuthorBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      playNextAuthorVideo();
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

    function seekModalPreviewVideo(targetTime) {
      const pVid = dom.modalTimelinePreviewVideo;
      if (!pVid || !pVid.src) return;

      clearTimeout(modalSeekDebounce);
      const now = performance.now();
      const timeSinceLast = now - modalLastSeekTime;

      const executeSeek = () => {
        modalLastSeekTime = performance.now();
        try {
          if (pVid.readyState < 1) {
            pVid.addEventListener('loadedmetadata', () => {
              seekModalPreviewVideo(targetTime);
            }, { once: true });
            return;
          }
          const maxDur = (Number.isFinite(pVid.duration) && pVid.duration > 0)
            ? pVid.duration
            : ((Number.isFinite(vid.duration) && vid.duration > 0) ? vid.duration : (parseDurationToSeconds(state.currentVideoDetails?.duration) || 99999));
          const seekPos = Math.max(0, Math.min(maxDur, targetTime));
          if (typeof pVid.fastSeek === 'function') {
            pVid.fastSeek(seekPos);
          } else {
            pVid.currentTime = seekPos;
          }
          pVid.style.opacity = '1';
          pVid.style.display = 'block';
        } catch (e) {}
      };

      if (timeSinceLast >= 50) {
        executeSeek();
      } else {
        modalSeekDebounce = setTimeout(executeSeek, 50 - timeSinceLast);
      }
    }

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

      // 2. Archivebate YouTube Sprite (jeśli wcześniej zapisany w cache)
      if (state.timelineSpriteBoard && dom.modalTimelineSprite && window.ArchivebateYouTubeStoryboard) {
        if (dom.modalTimelinePreviewImg) dom.modalTimelinePreviewImg.style.display = 'none';
        if (dom.modalTimelinePreviewVideo) dom.modalTimelinePreviewVideo.style.display = 'none';
        if (dom.modalTimelinePreviewStatus) dom.modalTimelinePreviewStatus.style.display = 'none';
        ArchivebateYouTubeStoryboard.applyFrame(dom.modalTimelineSprite, state.timelineSpriteBoard, pos);
        return;
      }

      // 3. Archivebate RZECZYWISTY PODGLĄD WIDEO (z rzeczywistego strumienia filmu)
      if (dom.modalTimelineSprite && window.ArchivebateYouTubeStoryboard) ArchivebateYouTubeStoryboard.clearFrame(dom.modalTimelineSprite);
      if (dom.modalTimelinePreviewStatus) dom.modalTimelinePreviewStatus.style.display = 'none';
      if (dom.modalTimelinePreviewVideo && dom.modalTimelinePreviewVideo.src) {
        if (dom.modalTimelinePreviewImg) dom.modalTimelinePreviewImg.style.display = 'none';
        dom.modalTimelinePreviewVideo.style.display = 'block';
        dom.modalTimelinePreviewVideo.style.opacity = '1';
        seekModalPreviewVideo(targetTime);
      } else {
        if (dom.modalTimelinePreviewVideo) dom.modalTimelinePreviewVideo.style.display = 'none';
        const posterSrc = (state.currentVideoDetails?.thumbnail || state.currentVideoDetails?.poster || '').replace('.mp4', '.jpg');
        if (posterSrc && dom.modalTimelinePreviewImg) {
          if (dom.modalTimelinePreviewImg.src !== new URL(posterSrc, location.href).href) dom.modalTimelinePreviewImg.src = posterSrc;
          dom.modalTimelinePreviewImg.style.display = 'block';
        }
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
  if (dom.modalCtrlVolumeSlider) {
    dom.modalCtrlVolumeSlider.addEventListener('input', (e) => {
      vid.volume = parseFloat(e.target.value);
      vid.muted = (vid.volume === 0);
      updateModalVolumeIcon();
    });
  }

  if (dom.modalCtrlVolumeBtn) {
    dom.modalCtrlVolumeBtn.addEventListener('click', () => {
      vid.muted = !vid.muted;
      updateModalVolumeIcon();
    });
  }

  function updateModalVolumeIcon() {
    if (!dom.modalCtrlVolumeBtn) return;
    if (vid.muted || vid.volume === 0) {
      dom.modalCtrlVolumeBtn.innerHTML = '<i class="fa-solid fa-volume-xmark"></i>';
    } else if (vid.volume < 0.5) {
      dom.modalCtrlVolumeBtn.innerHTML = '<i class="fa-solid fa-volume-low"></i>';
    } else {
      dom.modalCtrlVolumeBtn.innerHTML = '<i class="fa-solid fa-volume-high"></i>';
    }
  }

  // Prędkość
  const modalSpeeds = [1, 1.25, 1.5, 2, 0.75];
  let modalSpeedIdx = 0;
  if (dom.modalCtrlSpeedBtn) {
    dom.modalCtrlSpeedBtn.addEventListener('click', () => {
      modalSpeedIdx = (modalSpeedIdx + 1) % modalSpeeds.length;
      const s = modalSpeeds[modalSpeedIdx];
      vid.playbackRate = s;
      dom.modalCtrlSpeedBtn.innerText = `${s}x`;
    });
  }

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
  if (dom.modalCtrlFullscreenBtn && dom.modalPlayerWrapper) {
    dom.modalCtrlFullscreenBtn.addEventListener('click', () => {
      if (!document.fullscreenElement) {
        dom.modalPlayerWrapper.requestFullscreen().catch(() => {});
      } else {
        document.exitFullscreen().catch(() => {});
      }
    });
  }

  // Auto-hide controls
  function resetModalIdleTimer() {
    if (dom.modalControlsBar) dom.modalControlsBar.classList.remove('idle');
    clearTimeout(modalIdleTimeout);
    if (!vid.paused) {
      modalIdleTimeout = setTimeout(() => {
        if (dom.modalControlsBar) dom.modalControlsBar.classList.add('idle');
      }, 2500);
    }
  }

  if (dom.modalPlayerWrapper) {
    dom.modalPlayerWrapper.addEventListener('mousemove', resetModalIdleTimer);
    dom.modalPlayerWrapper.addEventListener('mouseleave', () => {
      if (!vid.paused && dom.modalControlsBar) dom.modalControlsBar.classList.add('idle');
    });
  }

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
      playPrevAuthorVideo();
    } else if (code === 'ArrowDown' || key === 'ArrowDown' || key === 'Down') {
      e.preventDefault();
      playNextAuthorVideo();
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
    } else if (code === 'Delete' || key === 'Delete') {
      e.preventDefault();
      if (state.currentVideoDetails && state.currentVideoDetails.username) {
        blockModel(state.currentVideoDetails.username);
      }
    }
  }, true);
}
