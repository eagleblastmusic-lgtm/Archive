(function (global) {
  'use strict';

  const context = global.ArchivebateAppContext || { state: {}, dom: {} };
  const state = context.state || {};
  const dom = context.dom || {};

  let loadHomeVideos;
  let performSearch;
  let loadModelVideos;
  let loadFavorites;
  let loadHistory;
  let loadFollowing;

  function init(dependencies = {}) {
    loadHomeVideos = dependencies.loadHomeVideos;
    performSearch = dependencies.performSearch;
    loadModelVideos = dependencies.loadModelVideos;
    loadFavorites = dependencies.loadFavorites;
    loadHistory = dependencies.loadHistory;
    loadFollowing = dependencies.loadFollowing;
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

  function render() {
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

  global.ArchivebatePagination = {
    init,
    changePage,
    render
  };
})(typeof window !== 'undefined' ? window : globalThis);
