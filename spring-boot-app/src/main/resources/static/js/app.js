/**
 * BookReader — Frontend Application
 * Single-page book library manager with rich interactions.
 */
(function () {
  'use strict';

  /* ================================================================
     State
     ================================================================ */
  const state = {
    shelves: [],
    activeShelfId: null,
    activeShelfName: '',
    books: [],
    totalBookCount: 0,
    isLoggedIn: false,
    loading: false,
    contextMenu: {
      visible: false,
      x: 0,
      y: 0,
      items: [],
      target: null,
    },
    renameTargetShelfId: null,
    selectedFile: null,
    // New: page routing
    currentPage: 'shelf',    // 'shelf' | 'browse' | 'detail' | 'reader'
    previousPage: 'shelf',
    detailBook: null,
    browseBooks: [],
    detailToc: [],
    tocCache: {}, // bookId → TocEntry[]
    detailProgress: null,
    // Download-to-shelf modal
    downloadTargetBook: null,
    selectedShelfIds: [],
    downloadTasks: [],
    downloadPollTimer: null,
    // Auth
    user: null,
    // Browse page mode
    browseMode: 'popular',  // 'popular' | 'search'
    searchQuery: '',
  };

  /* ================================================================
     DOM References
     ================================================================ */
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  const dom = {
    sidebar: $('#sidebar'),
    sidebarToggle: $('#sidebarToggle'),
    sidebarNav: $('#sidebarNav'),
    loginBtn: $('#loginBtn'),
    tabBar: $('#tabBar'),
    addShelfBtn: $('#addShelfBtn'),
    booksGrid: $('#booksGrid'),
    totalBookCount: $('#totalBookCount'),
    emptyState: $('#emptyState'),
    loadingState: $('#loadingState'),
    contextMenu: $('#contextMenu'),
    contextMenuInner: $('#contextMenuInner'),
    searchModal: $('#searchModal'),
    uploadModal: $('#uploadModal'),
    loginModal: $('#loginModal'),
    renameModal: $('#renameModal'),
    searchBtn: $('#searchBtn'),
    refreshBtn: $('#refreshBtn'),
    uploadBtn: $('#uploadBtn'),
    toastContainer: $('#toastContainer'),
    // New: page routing & detail
    headerTitle: $('#headerTitle'),
    headerBackBtn: $('#headerBackBtn'),
    tabBarWrapper: $('.tab-bar-wrapper'),
    booksContainer: $('#booksContainer'),
    detailPage: $('#detailPage'),
    detailCover: $('#detailCover'),
    detailTitle: $('#detailTitle'),
    detailAuthor: $('#detailAuthor'),
    detailStatus: $('#detailStatus'),
    detailSource: $('#detailSource'),
    detailDescText: $('#detailDescText'),
    detailDescMore: $('#detailDescMore'),
    detailDesc: $('#detailDesc'),
    detailTags: $('#detailTags'),
    detailReadOnline: $('#detailReadOnline'),
    detailDownloadToShelf: $('#detailDownloadToShelf'),
    detailFavBtn: $('#detailFavBtn'),
    detailLocalRead: $('#detailLocalRead'),
    tocCount: $('#tocCount'),
    tocList: $('#tocList'),
    tocSearch: $('#tocSearch'),
    tocSortBtn: $('#tocSortBtn'),
    continueReadingBtn: $('#continueReadingBtn'),
    // Download-to-shelf modal
    downloadShelfModal: $('#downloadShelfModal'),
    shelfCheckboxList: $('#shelfCheckboxList'),
    downloadShelfConfirmBtn: $('#downloadShelfConfirmBtn'),
    downloadShelfModalClose: $('#downloadShelfModalClose'),
    // Auth
    authPage: $('#authPage'),
    authApp: $('#authApp'),
    authTabs: $$('.auth-tab'),
    authLoginForm: $('#authLoginForm'),
    authRegisterForm: $('#authRegisterForm'),
    authLoginEmail: $('#authLoginEmail'),
    authLoginPass: $('#authLoginPass'),
    authRegEmail: $('#authRegEmail'),
    authRegPass: $('#authRegPass'),
    authError: $('#authError'),
    userEmail: $('#userEmail'),
    appLogoutBtn: $('#appLogoutBtn'),
    mainContent: $('#mainContent'),
  };

  /* ================================================================
     API Service
     ================================================================ */
  const API_BASE = '/api';

  async function api(path, options = {}) {
    const url = `${API_BASE}${path}`;
    const config = {
      headers: { 'Content-Type': 'application/json', ...options.headers },
      ...options,
    };

    // Don't set Content-Type for FormData
    if (options.body instanceof FormData) {
      delete config.headers['Content-Type'];
    }

    try {
      const res = await fetch(url, config);
      if (!res.ok) {
        const errText = await res.text().catch(() => 'Unknown error');
        throw new Error(`HTTP ${res.status}: ${errText}`);
      }
      if (res.status === 204) return null;
      const contentType = res.headers.get('content-type') || '';
      return contentType.includes('application/json') ? res.json() : res;
    } catch (err) {
      if (err.name === 'TypeError' && err.message.includes('fetch')) {
        throw new Error('无法连接到服务器，请检查后端是否运行');
      }
      throw err;
    }
  }

  /* -- Shelves -- */
  async function fetchShelves() {
    const resp = await api('/bookshelves');
    return Array.isArray(resp) ? resp : (resp?.data || []);
  }

  async function createShelf(name) {
    return api('/bookshelves', { method: 'POST', body: JSON.stringify({ name }) });
  }

  async function updateShelf(id, name) {
    return api(`/bookshelves/${id}`, { method: 'PUT', body: JSON.stringify({ name }) });
  }

  async function deleteShelf(id) {
    return api(`/bookshelves/${id}`, { method: 'DELETE' });
  }

  async function reorderShelves(shelfIds) {
    return api('/bookshelves/reorder', { method: 'POST', body: JSON.stringify({ shelfIds }) });
  }

  /* -- Books -- */
  async function fetchBooks(shelfId) {
    const resp = await api(`/books/shelf/${shelfId}`);
    return Array.isArray(resp) ? resp : (resp?.data || []);
  }

  async function addBookToShelf(shelfId, bookData) {
    return api(`/books/shelf/${shelfId}`, { method: 'POST', body: JSON.stringify(bookData) });
  }

  async function removeBookFromShelf(shelfId, bookId) {
    return api(`/books/shelf/${shelfId}/book/${bookId}`, { method: 'DELETE' });
  }

  async function transferBook(fromShelfId, toShelfId, bookId) {
    return api('/books/transfer', {
      method: 'POST',
      body: JSON.stringify({ fromShelfId, toShelfId, bookId }),
    });
  }

  async function deleteBook(bookId) {
    return api(`/books/${bookId}`, { method: 'DELETE' });
  }

  async function getBookProgress(bookId) {
    try {
      return await api(`/books/${bookId}/progress`);
    } catch {
      return null;
    }
  }

  async function updateBookProgress(bookId, currentPage, totalPages, finished) {
    return api(`/books/${bookId}/progress`, {
      method: 'PUT',
      body: JSON.stringify({ currentPage, totalPages, finished }),
    });
  }

  async function uploadBook(file, title, author, shelfId) {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('title', title);
    formData.append('author', author);
    formData.append('shelfId', shelfId);
    return api('/books/upload', { method: 'POST', body: formData });
  }

  /* -- Z-Library -- */
  async function zlibLogin(email, password, domain) {
    return api('/zlibrary/login', { method: 'POST', body: JSON.stringify({ email, password, domain }) });
  }

  async function zlibSearch(params) {
    return api('/zlibrary/search', { method: 'POST', body: JSON.stringify(params) });
  }

  async function zlibStatus() {
    try {
      return await api('/zlibrary/status');
    } catch {
      return { data: { loggedIn: false } };
    }
  }

  async function zlibLogout() {
    return api('/zlibrary/logout');
  }

  /* -- Auth (app-level) -- */
  async function authRegister(email, password) {
    return api('/auth/register', { method: 'POST', body: JSON.stringify({ email, password }) });
  }

  async function authLogin(email, password) {
    return api('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
  }

  async function authLogout() {
    return api('/auth/logout', { method: 'POST' });
  }

  async function authMe() {
    try {
      return await api('/auth/me');
    } catch {
      return { success: false };
    }
  }

  async function fetchMostPopular() {
    return api('/zlibrary/most-popular');
  }

  async function fetchZlibBookDetail(zlibId, hash) {
    return api(`/zlibrary/book/${zlibId}/${hash}`);
  }

  async function downloadZlibBook(bookId, hash) {
    return api(`/zlibrary/book/${bookId}/${hash}/download/file`);
  }

  /* -- Background Download -- */
  async function startBackgroundDownload(params) {
    return api('/zlibrary/download/start', { method: 'POST', body: JSON.stringify(params) });
  }

  async function fetchDownloadList() {
    const resp = await api('/zlibrary/download/list');
    return resp && resp.data ? resp.data : [];
  }

  /* -- Book TOC -- */
  async function fetchBookToc(bookId) {
    try {
      return await api(`/books/${bookId}/toc`);
    } catch {
      return null;
    }
  }

  /* ================================================================
     Toast Notifications
     ================================================================ */
  function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    dom.toastContainer.appendChild(toast);

    setTimeout(() => {
      toast.classList.add('removing');
      toast.addEventListener('animationend', () => toast.remove());
    }, 3000);
  }

  /* ================================================================
     Loading & Empty States
     ================================================================ */
  function showLoading() {
    state.loading = true;
    dom.booksGrid.style.display = 'none';
    dom.emptyState.style.display = 'none';
    dom.loadingState.style.display = 'flex';

    // Render skeleton cards
    const skeletonsHtml = Array.from({ length: 8 }, () =>
      `<div class="book-card skeleton"><div class="cover-wrapper"></div><div class="book-title"></div><div class="book-author"></div></div>`
    ).join('');
    dom.booksGrid.innerHTML = skeletonsHtml;
    dom.booksGrid.style.display = 'grid';
  }

  function hideLoading() {
    state.loading = false;
    dom.loadingState.style.display = 'none';
    dom.booksGrid.style.display = 'grid';
    toggleEmptyState();
  }

  function toggleEmptyState() {
    if (state.loading) return;
    const hasBooks = state.books.length > 0;
    dom.booksGrid.style.display = hasBooks ? 'grid' : 'none';
    dom.emptyState.style.display = hasBooks ? 'none' : 'flex';
  }

  /* ================================================================
      Render: Sidebar Login Status
      ================================================================ */
  function renderLoginStatus() {
    if (state.user) {
      dom.userEmail.textContent = state.user.email;
      dom.appLogoutBtn.style.display = 'flex';
    } else {
      dom.userEmail.textContent = '';
      dom.appLogoutBtn.style.display = 'none';
    }

    const span = dom.loginBtn.querySelector('span');
    if (state.isLoggedIn) {
      dom.loginBtn.classList.add('logged-in');
      span.textContent = 'Z-Library · 剩余--次';
      dom.loginBtn.title = '已绑定 Z-Library\n点击重新绑定';
      dom.loginBtn.onclick = handleLogout;
    } else {
      dom.loginBtn.classList.remove('logged-in');
      span.textContent = '绑定 Z-Library';
      dom.loginBtn.title = '绑定 Z-Library 账号';
      dom.loginBtn.onclick = handleLoginOpen;
    }
  }

  async function checkLoginStatus() {
    try {
      const resp = await zlibStatus();
      state.isLoggedIn = !!(resp?.data?.loggedIn);
    } catch {
      state.isLoggedIn = false;
    }
    renderLoginStatus();
  }

  async function handleAppLogout() {
    try { await zlibLogout(); } catch (e) { /* ignore */ }
    try { await authLogout(); } catch (e) { /* ignore */ }
    state.user = null;
    state.isLoggedIn = false;
    state.shelves = [];
    state.books = [];
    showAuthPage();
  }

  function showAuthPage() {
    dom.authPage.style.display = 'flex';
    dom.authApp.style.display = 'none';
  }

  function showAppPage() {
    dom.authPage.style.display = 'none';
    dom.authApp.style.display = 'flex';
  }

  /* Auth tab switching */
  function switchAuthTab(tabEl) {
    dom.authTabs.forEach(t => t.classList.remove('active'));
    tabEl.classList.add('active');
    const mode = tabEl.dataset.authTab;
    if (mode === 'login') {
      dom.authLoginForm.style.display = 'block';
      dom.authRegisterForm.style.display = 'none';
    } else {
      dom.authLoginForm.style.display = 'none';
      dom.authRegisterForm.style.display = 'block';
    }
    dom.authError.style.display = 'none';
  }

  async function handleAuthSubmit(mode) {
    const email = mode === 'login' ? dom.authLoginEmail.value.trim() : dom.authRegEmail.value.trim();
    const password = mode === 'login' ? dom.authLoginPass.value.trim() : dom.authRegPass.value.trim();
    if (!email || !password) {
      dom.authError.textContent = '请输入邮箱和密码';
      dom.authError.style.display = 'block';
      return;
    }
    try {
      const resp = mode === 'login' ? await authLogin(email, password) : await authRegister(email, password);
      if (!resp.success) {
        dom.authError.textContent = resp.message || '操作失败';
        dom.authError.style.display = 'block';
        return;
      }
      state.user = resp.data;
      showAppPage();
      renderLoginStatus();
      await checkLoginStatus();
      await loadShelves();
    } catch (err) {
      dom.authError.textContent = err.message || '操作失败';
      dom.authError.style.display = 'block';
    }
  }

  /* ================================================================
     Render: Shelves Tab Bar
     ================================================================ */
  function renderTabs() {
    const existingEdits = dom.tabBar.querySelectorAll('.tab-name-input');
    existingEdits.forEach((inp) => {
      const tab = inp.closest('.tab-item');
      if (tab) tab.classList.remove('editing');
    });

    dom.tabBar.innerHTML = state.shelves
      .map(
        (shelf) => `
        <div class="tab-item ${shelf.id === state.activeShelfId ? 'active' : ''}"
             data-shelf-id="${shelf.id}"
             data-shelf-name="${escapeHtml(shelf.name)}"
             draggable="true">
          <span class="tab-name" data-shelf-id="${shelf.id}">${escapeHtml(shelf.name)}</span>
          <span class="tab-count">${shelf.bookCount ?? 0}</span>
        </div>`
      )
      .join('');
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function formatFileSize(bytes) {
    if (bytes == null || bytes === 0) return '0 B';
    const u = ['B', 'KB', 'MB', 'GB'];
    let i = 0, v = bytes;
    while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
    return v.toFixed(1) + ' ' + u[i];
  }

  /* ================================================================
     Render: Book Grid
     ================================================================ */
  function renderBooks() {
    // Reset empty state text for shelf mode
    const emptyTitle = dom.emptyState.querySelector('p:first-of-type');
    const emptySub = dom.emptyState.querySelector('.text-muted');
    if (emptyTitle) emptyTitle.textContent = '还没有书籍';
    if (emptySub) emptySub.textContent = '点击上方 + 搜索添加，或直接上传';

    if (state.books.length === 0) {
      dom.booksGrid.innerHTML = '';
      toggleEmptyState();
      updateTotalCount();
      return;
    }

    dom.booksGrid.innerHTML = state.books
      .map((book) => {
        const unread = computeUnread(book);
        const badgeText = unread > 9999 ? '9999+' : unread > 0 ? String(unread) : '';
        const isFinished = book.isFinished || book.progress?.finished;
        const coverUrl = book.coverUrl || '';

        return `
         <div class="book-card"
             data-book-id="${book.id}"
             data-book-bookid="${book.bookId || book.zlibId || ''}"
             data-shelf-id="${state.activeShelfId}"
             data-title="${escapeHtml(book.title || '')}"
             data-author="${escapeHtml(book.author || '')}"
             data-cover="${escapeHtml(coverUrl)}"
             data-extension="${escapeHtml(book.extension || '')}"
             data-filesize="${book.filesize || 0}"
             data-hash="${escapeHtml(book.zlibHash || book.hash || '')}"
             data-description="${escapeHtml(book.description || '')}"
             data-source="shelf"
             data-unread="${unread}"
             data-finished="${isFinished}"
              data-zlib-id="${escapeHtml(book.zlibId || '')}"
              data-readonline-url="${escapeHtml(book.readOnlineUrl || '')}"
               data-has-file="${(book.filePath && book.filePath.length > 0) ? 'true' : 'false'}"
               data-filepath="${escapeHtml(book.filePath || '')}"
              draggable="true">
          <div class="cover-wrapper">
            ${coverUrl
              ? `<img class="cover-img" src="${escapeHtml(coverUrl)}" alt="${escapeHtml(book.title || '')}" loading="lazy">`
              : `<div class="cover-placeholder" style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;background:var(--panel);color:var(--muted);font-size:32px;">📖</div>`
            }
            <div class="cover-overlay"></div>
            ${badgeText
              ? `<span class="cover-badge ${isFinished ? 'finished' : ''}">${badgeText}</span>`
              : ''
            }
            <button class="cover-options-btn" data-action="book-options" data-book-id="${book.id}" title="选项">
              <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
                <circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/>
              </svg>
            </button>
            <button class="cover-read-btn" data-action="read-book" data-book-id="${book.id}" title="阅读">
              <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14">
                <polygon points="5,3 19,12 5,21"/>
              </svg>
            </button>
          </div>
          <div class="book-title">${escapeHtml(book.title || '未命名')}</div>
          ${book.author ? `<div class="book-author">${escapeHtml(book.author)}</div>` : ''}
          <div class="book-actions" data-book-id="${book.id}">
            <button class="btn-local-read ${book.filePath && book.filePath.length > 0 ? '' : 'disabled'}"
                    data-action="local-read" data-book-id="${book.id}"
                    ${book.filePath && book.filePath.length > 0 ? '' : 'disabled'}>
              <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>
              本地阅读
            </button>
            ${book.readOnlineUrl && book.readOnlineUrl.length > 0
              ? `<a class="btn-online-read" href="${escapeHtml(book.readOnlineUrl)}" target="_blank" rel="noopener">
                  <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
                 在线阅读
               </a>`
              : ''}
          </div>
        </div>`;
      })
      .join('');

    toggleEmptyState();
    updateTotalCount();
  }

  function computeUnread(book) {
    if (book.isFinished) return 0;
    if (book.unreadPages != null && book.unreadPages > 0) return book.unreadPages;
    if (book.progress) {
      if (book.progress.finished) return 0;
      return Math.max(0, (book.progress.totalPages || 0) - (book.progress.currentPage || 0));
    }
    return book.filesize ? Math.ceil(book.filesize / 1024) : 0;
  }

  function updateTotalCount() {
    const total = state.shelves.reduce((sum, s) => sum + (s.bookCount || 0), 0);
    state.totalBookCount = total;
    dom.totalBookCount.textContent = total;
    if (state.currentPage === 'shelf') {
      dom.headerTitle.textContent = state.activeShelfName || '书架';
    }
  }

  /* ================================================================
     Data Loading
     ================================================================ */
  async function loadShelves() {
    try {
      state.shelves = await fetchShelves();
      renderTabs();

      if (state.shelves.length > 0) {
        const activeExists = state.shelves.some((s) => s.id === state.activeShelfId);
        if (!activeExists) {
          state.activeShelfId = state.shelves[0].id;
          state.activeShelfName = state.shelves[0].name;
        }
        if (state.currentPage === 'shelf') {
          await loadBooks(state.activeShelfId);
        }
      } else {
        state.activeShelfId = null;
        state.books = [];
        if (state.currentPage === 'shelf') renderBooks();
      }
    } catch (err) {
      showToast('加载书架失败: ' + err.message, 'error');
    }
  }

  async function loadBooks(shelfId) {
    showLoading();
    try {
      state.books = await fetchBooks(shelfId);
      if (state.currentPage === 'shelf') {
        renderBooks();
      }
    } catch (err) {
      showToast('加载书籍失败: ' + err.message, 'error');
      state.books = [];
      if (state.currentPage === 'shelf') renderBooks();
    }
    hideLoading();
  }

  async function refreshAll() {
    if (state.currentPage === 'browse') {
      await loadBrowseBooks();
    } else if (state.currentPage === 'downloads') {
      await loadDownloadTasks();
    } else if (state.currentPage === 'history') {
      await renderHistoryPage();
    } else if (state.currentPage === 'detail' || state.currentPage === 'reader') {
      if (state.detailBook) await renderDetailPage();
    } else {
      await loadShelves();
    }
  }

  /* ================================================================
     Tab Interactions
     ================================================================ */
  function activateShelf(shelfId) {
    const shelf = state.shelves.find((s) => s.id == shelfId);
    if (!shelf) return;
    state.activeShelfId = shelf.id;
    state.activeShelfName = shelf.name;
    state.books = [];
    renderBooks();
    renderTabs();
    updateHeader();
    loadBooks(shelf.id);
  }

  function handleTabClick(e) {
    const tab = e.target.closest('.tab-item');
    if (!tab) return;
    if (tab.classList.contains('editing')) return;
    const shelfId = tab.dataset.shelfId;
    if (shelfId) activateShelf(shelfId);
  }

  function handleTabDblClick(e) {
    const tab = e.target.closest('.tab-item');
    if (!tab) return;
    if (tab.classList.contains('editing')) return;
    const shelfId = tab.dataset.shelfId;
    const nameEl = tab.querySelector('.tab-name');
    if (!nameEl) return;

    // Enter edit mode
    tab.classList.add('editing');
    const input = document.createElement('input');
    input.className = 'tab-name-input';
    input.value = nameEl.textContent;
    input.dataset.shelfId = shelfId;
    nameEl.replaceWith(input);
    input.focus();
    input.select();
  }

  function handleTabInputKey(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitTabRename(e.target);
    } else if (e.key === 'Escape') {
      cancelTabRename(e.target);
    }
  }

  function handleTabInputBlur(e) {
    commitTabRename(e.target);
  }

  async function commitTabRename(input) {
    const shelfId = input.dataset.shelfId;
    const newName = input.value.trim();
    if (!newName || !shelfId) {
      cancelTabRename(input);
      return;
    }

    const tab = input.closest('.tab-item');
    try {
      await updateShelf(shelfId, newName);
      const shelf = state.shelves.find((s) => s.id == shelfId);
      if (shelf) shelf.name = newName;
      showToast('书架已重命名', 'success');
    } catch (err) {
      showToast('重命名失败: ' + err.message, 'error');
    }

    if (tab) tab.classList.remove('editing');
    renderTabs();
  }

  function cancelTabRename(input) {
    const tab = input.closest('.tab-item');
    if (tab) tab.classList.remove('editing');
    renderTabs();
  }

  document.addEventListener('click', (e) => {
    const editingInput = document.querySelector('.tab-name-input');
    if (editingInput && !editingInput.contains(e.target) && !e.target.closest('.tab-item')) {
      commitTabRename(editingInput);
    }
  });

  /* -- Add shelf -- */
  async function handleAddShelf() {
    const name = prompt('输入新书架名称：');
    if (!name || !name.trim()) return;
    try {
      await createShelf(name.trim());
      showToast('书架创建成功', 'success');
      await loadShelves();
    } catch (err) {
      showToast('创建书架失败: ' + err.message, 'error');
    }
  }

  /* -- Delete shelf -- */
  async function handleDeleteShelf(shelfId) {
    const shelf = state.shelves.find((s) => s.id == shelfId);
    if (!shelf) return;
    if (!confirm(`确定要删除书架「${shelf.name}」吗？书架中的书籍不会被删除，但会失去分类。`)) return;
    try {
      await deleteShelf(shelfId);
      showToast('书架已删除', 'success');
      await loadShelves();
    } catch (err) {
      showToast('删除失败: ' + err.message, 'error');
    }
  }

  /* -- Rename shelf via context menu -- */
  async function handleRenameShelf(shelfId) {
    const shelf = state.shelves.find((s) => s.id == shelfId);
    if (!shelf) return;
    state.renameTargetShelfId = shelfId;
    $('#renameInput').value = shelf.name;
    showModal('rename');
    setTimeout(() => $('#renameInput').focus(), 100);
  }

  /* ================================================================
     Context Menu System
     ================================================================ */
  function showContextMenu(items, x, y, target) {
    state.contextMenu = { visible: true, x, y, items, target };
    dom.contextMenuInner.innerHTML = items
      .map((item) => {
        if (item.divider) return '<div class="context-menu-divider"></div>';
        const hasSub = item.submenu && item.submenu.length > 0;
        return `
          <div class="context-menu-item ${item.danger ? 'danger' : ''}"
               data-action="${item.action || ''}"
               data-payload='${item.payload || ''}'>
            ${item.icon ? `<span class="context-menu-icon">${item.icon}</span>` : ''}
            <span>${item.label}</span>
            ${hasSub ? `<span class="context-menu-sub-arrow">▶</span>` : ''}
            ${hasSub
              ? `<div class="context-submenu">
                  ${item.submenu
                    .map(
                      (s) => `
                    <div class="context-menu-item"
                         data-action="${s.action || ''}"
                         data-payload='${s.payload || ''}'>
                      ${s.icon ? `<span class="context-menu-icon">${s.icon}</span>` : ''}
                      <span>${s.label}</span>
                    </div>`
                    )
                    .join('')}
                </div>`
              : ''}
          </div>`;
      })
      .join('');

    dom.contextMenu.style.display = 'block';

    // Position: ensure menu stays within viewport
    requestAnimationFrame(() => {
      const menuRect = dom.contextMenu.getBoundingClientRect();
      const viewW = window.innerWidth;
      const viewH = window.innerHeight;

      let finalX = x;
      let finalY = y;

      if (x + menuRect.width > viewW) finalX = Math.max(4, viewW - menuRect.width - 4);
      if (y + menuRect.height > viewH) finalY = Math.max(4, viewH - menuRect.height - 4);

      dom.contextMenu.style.left = finalX + 'px';
      dom.contextMenu.style.top = finalY + 'px';
      dom.contextMenu.classList.add('visible');
    });
  }

  function hideContextMenu() {
    dom.contextMenu.classList.remove('visible');
    state.contextMenu.visible = false;
    setTimeout(() => {
      if (!state.contextMenu.visible) {
        dom.contextMenu.style.display = 'none';
      }
    }, 150);
  }

  /* Context Menu Item Builders */

  // Book right-click menu
  const ICONS_SVG = {
    select: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="16" height="16"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>',
    download: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="16" height="16"><path d="M12 3v12m0 0l-5-5m5 5l5-5"/><path d="M4 17v1a3 3 0 003 3h10a3 3 0 003-3v-1"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><polyline points="20 6 9 17 4 12"/></svg>',
    eyeSlash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="16" height="16"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>',
    transfer: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="16" height="16"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 014-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 01-4 4H3"/></svg>',
    refresh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="16" height="16"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 102.13-9.36L1 10"/></svg>',
    trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="16" height="16"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>',
    pencil: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="16" height="16"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>',
  };

  function buildBookContextMenu(bookData) {
    const { id, bookId, shelfId, title, author, extension, unread, finished, zlibId, hash } = bookData;

    const shelfSubmenu = state.shelves
      .filter((s) => s.id != shelfId)
      .map((s) => ({
        label: s.name,
        action: 'transfer-book',
        payload: JSON.stringify({ bookId: id, fromShelfId: shelfId, toShelfId: s.id }),
      }));

    // Format submenu: available formats
    const formatsSubmenu = [
      { label: 'EPUB', action: 'download-book', payload: JSON.stringify({ localBookId: bookId, zlibId, hash, extension: 'epub' }) },
      { label: 'PDF', action: 'download-book', payload: JSON.stringify({ localBookId: bookId, zlibId, hash, extension: 'pdf' }) },
      { label: 'MOBI', action: 'download-book', payload: JSON.stringify({ localBookId: bookId, zlibId, hash, extension: 'mobi' }) },
    ];

    return [
      { label: '选择', icon: ICONS_SVG.select, action: 'select-book', payload: id },
      { label: '下载', icon: ICONS_SVG.download, action: 'download-book', payload: JSON.stringify({ localBookId: bookId, zlibId, hash }), submenu: formatsSubmenu },
      { label: '标记为已读', icon: ICONS_SVG.check, action: 'mark-read', payload: JSON.stringify({ id, finished: true }) },
      { label: '标记为未读', icon: ICONS_SVG.eyeSlash, action: 'mark-unread', payload: JSON.stringify({ id, finished: false }) },
      ...(shelfSubmenu.length > 0
        ? [{ label: '迁移', icon: ICONS_SVG.transfer, action: '', payload: '', submenu: shelfSubmenu }]
        : []),
      { label: '追踪', icon: ICONS_SVG.refresh, action: 'track-book', payload: id },
      { divider: true },
      { label: '从书架中删除', icon: ICONS_SVG.trash, action: 'remove-from-shelf', payload: JSON.stringify({ shelfId, bookId: id }), danger: true },
    ];
  }

  function buildTabContextMenu(shelfId) {
    return [
      { label: '重命名', icon: ICONS_SVG.pencil, action: 'rename-shelf', payload: shelfId },
      { divider: true },
      { label: '删除书架', icon: ICONS_SVG.trash, action: 'delete-shelf', payload: shelfId, danger: true },
    ];
  }

  /* Context Menu Click Handler */
  function handleContextMenuClick(e) {
    const item = e.target.closest('.context-menu-item');
    if (!item) return;

    const action = item.dataset.action;
    const payload = item.dataset.payload;
    hideContextMenu();

    if (!action) return;

    switch (action) {
      case 'select-book': handleSelectBook(payload); break;
      case 'download-book': handleDownloadBook(payload); break;
      case 'mark-read': handleMarkRead(JSON.parse(payload)); break;
      case 'mark-unread': handleMarkUnread(JSON.parse(payload)); break;
      case 'transfer-book': handleTransferBook(JSON.parse(payload)); break;
      case 'track-book': handleTrackBook(payload); break;
      case 'remove-from-shelf': handleRemoveFromShelf(JSON.parse(payload)); break;
      case 'rename-shelf': handleRenameShelf(payload); break;
      case 'delete-shelf': handleDeleteShelf(payload); break;
    }
  }

  /* Context Menu Actions */
  function handleSelectBook(bookId) {
    const card = document.querySelector(`.book-card[data-book-id="${bookId}"]`);
    if (card) card.classList.toggle('selected');
  }

  async function handleDownloadBook(payloadStr) {
    const { localBookId, zlibId, hash } = JSON.parse(payloadStr);
    showToast('准备下载...', 'info');
    try {
      // If book has local file, serve it directly
      const card = document.querySelector(`.book-card[data-book-id="${localBookId}"]`);
      if (card && card.dataset.hasFile === 'true') {
        window.open(`${API_BASE}/books/${localBookId}/read`, '_blank');
      } else if (zlibId && hash) {
        // Download from Z-Library, save on server, return file
        window.open(`${API_BASE}/zlibrary/book/${zlibId}/${hash}/download/file?localBookId=${localBookId}`, '_blank');
      } else {
        window.open(`${API_BASE}/books/${localBookId}/read`, '_blank');
      }
    } catch (err) {
      showToast('下载失败', 'error');
    }
  }

  async function handleMarkRead({ id, finished }) {
    try {
      const progress = await getBookProgress(id);
      const totalPages = progress?.totalPages || 100;
      await updateBookProgress(id, totalPages, totalPages, true);
      showToast('已标记为已读', 'success');
      await refreshAll();
    } catch (err) {
      showToast('操作失败: ' + err.message, 'error');
    }
  }

  async function handleMarkUnread({ id, finished }) {
    try {
      await updateBookProgress(id, 0, 100, false);
      showToast('已标记为未读', 'success');
      await refreshAll();
    } catch (err) {
      showToast('操作失败: ' + err.message, 'error');
    }
  }

  async function handleTransferBook({ fromShelfId, toShelfId, bookId }) {
    try {
      await transferBook(fromShelfId, toShelfId, bookId);
      showToast('迁移成功', 'success');
      await refreshAll();
    } catch (err) {
      showToast('迁移失败: ' + err.message, 'error');
    }
  }

  async function handleTrackBook(bookId) {
    showToast('正在追踪更新...', 'info');
    // TODO: implement actual tracking logic
    setTimeout(() => showToast('追踪功能开发中', 'info'), 500);
  }

  async function handleRemoveFromShelf({ shelfId, bookId }) {
    if (!confirm('确定从书架中移除此书吗？')) return;
    if (confirm('同时删除服务器上的文件数据和数据库记录？')) {
      // Full delete: remove file from disk + delete DB records
      try {
        await deleteBook(bookId);
        showToast('已彻底删除', 'success');
        await refreshAll();
      } catch (err) {
        showToast('删除失败: ' + err.message, 'error');
      }
    } else {
      // Just remove from this shelf
      try {
        await removeBookFromShelf(shelfId, bookId);
        showToast('已从书架移除', 'success');
        await refreshAll();
      } catch (err) {
        showToast('移除失败: ' + err.message, 'error');
      }
    }
  }

  /* ================================================================
     Modal Management
     ================================================================ */
  function showModal(name) {
    const modalMap = {
      search: 'searchModal',
      upload: 'uploadModal',
      login: 'loginModal',
      rename: 'renameModal',
      downloadShelf: 'downloadShelfModal',
    };
    const modalId = modalMap[name] || (name + 'Modal');
    const modal = document.getElementById(modalId);
    if (modal) {
      modal.style.display = 'flex';
      document.body.style.overflow = 'hidden';
    }
  }

  function hideModal(name) {
    const modalMap = {
      search: 'searchModal',
      upload: 'uploadModal',
      login: 'loginModal',
      rename: 'renameModal',
      downloadShelf: 'downloadShelfModal',
    };
    const modalId = modalMap[name] || (name + 'Modal');
    const modal = document.getElementById(modalId);
    if (modal) {
      modal.style.display = 'none';
      document.body.style.overflow = '';
    }
  }

  function hideAllModals() {
    $$('.modal-overlay').forEach((m) => { m.style.display = 'none'; });
    document.body.style.overflow = '';
  }

  /* -- Search Modal -- */
  async function handleSearch() {
    showModal('search');
    setTimeout(() => $('#searchQuery').focus(), 100);
  }

  async function executeSearch() {
    const query = $('#searchQuery').value.trim();
    if (!query) return;

    const loadingEl = $('#searchLoading');
    loadingEl.style.display = 'flex';

    const params = {
      message: query,
      yearFrom: $('#filterYearFrom').value || undefined,
      yearTo: $('#filterYearTo').value || undefined,
      languages: $('#filterLanguage').value || undefined,
      extensions: $('#filterExtension').value ? [$('#filterExtension').value] : undefined,
      order: $('#filterOrder').value || undefined,
      page: 1,
      limit: 20,
    };

    Object.keys(params).forEach((k) => params[k] === undefined && delete params[k]);

    try {
      const resp = await zlibSearch(params);
      const results = resp?.data?.books || resp?.books || resp?.data || resp || [];
      state.browseBooks = Array.isArray(results) ? results : [];
      state.browseMode = 'search';
      state.searchQuery = query;
      hideModal('search');
      navigateTo('browse');
    } catch (err) {
      showToast('搜索失败: ' + err.message, 'error');
      hideModal('search');
    }
    loadingEl.style.display = 'none';
  }

  /* -- Old search list renderer removed; search now uses browse book-card grid -- */

  /* -- Upload Modal -- */
  function handleUploadOpen() {
    // Populate shelf selector
    const select = $('#uploadShelf');
    select.innerHTML = state.shelves
      .map((s) => `<option value="${s.id}" ${s.id == state.activeShelfId ? 'selected' : ''}>${escapeHtml(s.name)}</option>`)
      .join('');

    $('#uploadFileName').textContent = '';
    $('#uploadTitle').value = '';
    $('#uploadAuthor').value = '';
    state.selectedFile = null;
    $('#uploadFileInput').value = '';

    showModal('upload');
  }

  async function handleUploadSubmit() {
    const file = state.selectedFile;
    if (!file) {
      showToast('请选择一个文件', 'error');
      return;
    }

    const title = $('#uploadTitle').value.trim() || file.name.replace(/\.[^.]+$/, '');
    const author = $('#uploadAuthor').value.trim();
    const shelfId = $('#uploadShelf').value;

    if (!shelfId) {
      showToast('请选择目标书架', 'error');
      return;
    }

    $('#uploadSubmitText').style.display = 'none';
    $('#uploadSpinner').style.display = 'inline-block';
    $('#uploadSubmitBtn').disabled = true;

    try {
      await uploadBook(file, title, author, shelfId);
      showToast('上传成功！', 'success');
      hideModal('upload');
      await refreshAll();
    } catch (err) {
      showToast('上传失败: ' + err.message, 'error');
    }

    $('#uploadSubmitText').style.display = 'inline';
    $('#uploadSpinner').style.display = 'none';
    $('#uploadSubmitBtn').disabled = false;
  }

  /* -- Login Modal -- */
  function handleLoginOpen() {
    $('#loginError').style.display = 'none';
    $('#loginSubmitText').style.display = 'inline';
    $('#loginSpinner').style.display = 'none';
    $('#loginSubmitBtn').disabled = false;
    showModal('login');
    setTimeout(() => $('#loginEmail').focus(), 100);
  }

  async function handleLoginSubmit() {
    const email = $('#loginEmail').value.trim();
    const password = $('#loginPassword').value.trim();
    const domain = $('#loginDomain').value.trim();
    const proxyHost = $('#loginProxyHost') ? $('#loginProxyHost').value.trim() : '';
    const proxyPort = $('#loginProxyPort') ? $('#loginProxyPort').value.trim() : '';

    if (!email || !password) {
      $('#loginError').textContent = '请输入邮箱和密码';
      $('#loginError').style.display = 'block';
      return;
    }

    $('#loginSubmitText').style.display = 'none';
    $('#loginSpinner').style.display = 'inline-block';
    $('#loginSubmitBtn').disabled = true;

    const body = { email, password };
    if (domain) body.domain = domain;
    if (proxyHost) body.proxyHost = proxyHost;
    if (proxyPort) body.proxyPort = proxyPort;

    try {
      const resp = await api('/zlibrary/login', { method: 'POST', body: JSON.stringify(body) });
      if (!resp.success) {
        throw new Error(resp.message || '绑定失败');
      }
      state.isLoggedIn = true;
      renderLoginStatus();
      showToast('Z-Library 绑定成功', 'success');
      hideModal('login');
    } catch (err) {
      $('#loginError').textContent = '绑定失败: ' + err.message;
      $('#loginError').style.display = 'block';
    }

    $('#loginSubmitText').style.display = 'inline';
    $('#loginSpinner').style.display = 'none';
    $('#loginSubmitBtn').disabled = false;
  }

  async function handleLogout() {
    try {
      await zlibLogout();
    } catch (e) { /* ignore */ }
    state.isLoggedIn = false;
    renderLoginStatus();
    showToast('已登出', 'info');
  }

  /* -- Rename Modal -- */
  async function handleRenameSubmit() {
    const name = $('#renameInput').value.trim();
    const shelfId = state.renameTargetShelfId;
    if (!name || !shelfId) return;

    try {
      await updateShelf(shelfId, name);
      const shelf = state.shelves.find((s) => s.id == shelfId);
      if (shelf) shelf.name = name;
      renderTabs();
      showToast('重命名成功', 'success');
    } catch (err) {
      showToast('重命名失败: ' + err.message, 'error');
    }

    hideModal('rename');
  }

  /* ================================================================
     Book Card Interactions
     ================================================================ */
  async function handleBookClick(e) {
    const card = e.target.closest('.book-card');
    if (!card) return;

    // Ignore if clicking the options or read button
    if (e.target.closest('.cover-options-btn')) return;
    if (e.target.closest('.cover-read-btn')) return;

    // Build book data from card dataset
    const source = card.dataset.source || 'shelf';
    const zlibId = card.dataset.zlibId || (source === 'zlib' ? card.dataset.bookId : null);
    const zlibHash = card.dataset.hash || '';
    const bookId = card.dataset.bookBookid;

    const bookData = {
      id: card.dataset.bookId,
      bookId: bookId,
      title: card.dataset.title,
      author: card.dataset.author || '',
      coverUrl: card.dataset.cover || '',
      extension: card.dataset.extension || '',
      filesize: parseInt(card.dataset.filesize) || 0,
      hash: card.dataset.hash || '',
      description: card.dataset.description || '',
      zlibId: zlibId,
      zlibHash: zlibHash,
      source: source === 'zlib' ? 'Z-Library' : '本地书库',
      readOnlineUrl: card.dataset.readonlineUrl || '',
    };

    // Pre-fetch TOC for shelf books before navigating
    if (source === 'shelf' && bookId) {
      let toc = state.tocCache[bookId];
      if (!toc) {
        try {
          const resp = await fetchBookToc(bookId);
          if (resp && Array.isArray(resp)) {
            toc = resp;
          } else if (resp && resp.data && Array.isArray(resp.data)) {
            toc = resp.data;
          }
          if (toc) state.tocCache[bookId] = toc;
        } catch (e) {
          // Pre-fetch failed — loadDetailToc will fallback
        }
      }
      if (toc) bookData.toc = toc;
    }

    navigateTo('detail', bookData);
  }

  function showBookDetail(bookData) {
    navigateTo('detail', bookData);
  }

  function handleReadBook(bookId) {
    const card = document.querySelector(`.book-card[data-book-id="${bookId}"]`);
    if (!card) return;

    // Use Book entity DB ID (not ShelfBook junction ID) for API calls
    const entityBookId = card.dataset.bookBookid || bookId;

    // If local file exists, open reader page
    if (card.dataset.hasFile === 'true') {
      const title = encodeURIComponent(card.dataset.title || '');
      const author = encodeURIComponent(card.dataset.author || '');
      const ext = encodeURIComponent(card.dataset.extension || '');
      window.open(`/reader.html?bookId=${entityBookId}&title=${title}&author=${author}&ext=${ext}`, '_blank');
      return;
    }

    // Otherwise navigate to detail page
    const source = card.dataset.source || 'shelf';
    const zlibId = card.dataset.zlibId || (source === 'zlib' ? card.dataset.bookId : null);
    const bookData = {
      id: card.dataset.bookId,
      bookId: card.dataset.bookBookid,
      title: card.dataset.title,
      author: card.dataset.author || '',
      coverUrl: card.dataset.cover || '',
      extension: card.dataset.extension || '',
      filesize: parseInt(card.dataset.filesize) || 0,
      hash: card.dataset.hash || '',
      description: card.dataset.description || '',
      zlibId: zlibId,
      zlibHash: card.dataset.hash || '',
      filePath: card.dataset.filepath || '',
      source: source === 'zlib' ? 'Z-Library' : '本地书库',
    };
    navigateTo('detail', bookData);
  }

  function handleBookRightClick(e) {
    const card = e.target.closest('.book-card');
    if (!card) return;
    e.preventDefault();

    const bookData = {
      id: card.dataset.bookId,
      bookId: card.dataset.bookBookid,
      shelfId: card.dataset.shelfId,
      title: card.dataset.title,
      author: card.dataset.author,
      extension: card.dataset.extension,
      unread: card.dataset.unread,
      finished: card.dataset.finished === 'true',
      zlibId: card.dataset.zlibId || '',
      hash: card.dataset.hash || '',
    };

    const menu = buildBookContextMenu(bookData);
    showContextMenu(menu, e.clientX, e.clientY, card);
  }

  function handleBookOptionsBtn(e) {
    e.stopPropagation();
    const btn = e.target.closest('.cover-options-btn');
    if (!btn) return;
    const bookId = btn.dataset.bookId;
    const card = document.querySelector(`.book-card[data-book-id="${bookId}"]`);
    if (!card) return;

    const bookData = {
      id: card.dataset.bookId,
      bookId: card.dataset.bookBookid,
      shelfId: card.dataset.shelfId,
      title: card.dataset.title,
      author: card.dataset.author,
      extension: card.dataset.extension,
      unread: card.dataset.unread,
      finished: card.dataset.finished === 'true',
      zlibId: card.dataset.zlibId || '',
      hash: card.dataset.hash || '',
    };

    const rect = btn.getBoundingClientRect();
    const menu = buildBookContextMenu(bookData);
    showContextMenu(menu, rect.left, rect.bottom + 4, card);
  }

  /* ================================================================
     Tab Context Menu & Drag
     ================================================================ */
  function handleTabRightClick(e) {
    const tab = e.target.closest('.tab-item');
    if (!tab) return;
    e.preventDefault();

    const shelfId = tab.dataset.shelfId;
    if (!shelfId) return;
    const menu = buildTabContextMenu(shelfId);
    showContextMenu(menu, e.clientX, e.clientY, tab);
  }

  // Drag-and-drop reorder for tabs
  let dragSrcShelfId = null;

  function handleTabDragStart(e) {
    const tab = e.target.closest('.tab-item');
    if (!tab) return;
    dragSrcShelfId = tab.dataset.shelfId;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', dragSrcShelfId);
    tab.style.opacity = '0.4';
  }

  function handleTabDragEnd(e) {
    const tab = e.target.closest('.tab-item');
    if (tab) tab.style.opacity = '1';
    dragSrcShelfId = null;
  }

  function handleTabDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }

  async function handleTabDrop(e) {
    e.preventDefault();
    const dropTab = e.target.closest('.tab-item');
    if (!dropTab || !dragSrcShelfId) return;

    const dropShelfId = dropTab.dataset.shelfId;
    if (dragSrcShelfId === dropShelfId) return;

    // Reorder
    const ordered = state.shelves.map((s) => s.id);
    const srcIdx = ordered.findIndex((id) => id == dragSrcShelfId);
    const dropIdx = ordered.findIndex((id) => id == dropShelfId);

    if (srcIdx >= 0 && dropIdx >= 0) {
      ordered.splice(srcIdx, 1);
      ordered.splice(dropIdx, 0, dragSrcShelfId);

      try {
        await reorderShelves(ordered);
        await loadShelves();
      } catch (err) {
        showToast('排序失败: ' + err.message, 'error');
        await loadShelves();
      }
    }

    dragSrcShelfId = null;
  }

  /* ================================================================
     Upload Drag & Drop
     ================================================================ */
  function handleUploadDropzoneClick() {
    $('#uploadFileInput').click();
  }

  function handleUploadFileChange(e) {
    const file = e.target.files[0];
    if (!file) return;
    state.selectedFile = file;
    $('#uploadFileName').textContent = file.name + ' (' + formatFileSize(file.size) + ')';
    if (!$('#uploadTitle').value) {
      $('#uploadTitle').value = file.name.replace(/\.[^.]+$/, '');
    }
  }

  function handleUploadDropzoneDragOver(e) {
    e.preventDefault();
    e.stopPropagation();
    $('#uploadDropzone').classList.add('drag-over');
  }

  function handleUploadDropzoneDragLeave(e) {
    e.preventDefault();
    e.stopPropagation();
    $('#uploadDropzone').classList.remove('drag-over');
  }

  function handleUploadDropzoneDrop(e) {
    e.preventDefault();
    e.stopPropagation();
    $('#uploadDropzone').classList.remove('drag-over');

    const file = e.dataTransfer.files[0];
    if (!file) return;
    state.selectedFile = file;
    $('#uploadFileName').textContent = file.name + ' (' + formatFileSize(file.size) + ')';
    if (!$('#uploadTitle').value) {
      $('#uploadTitle').value = file.name.replace(/\.[^.]+$/, '');
    }
  }

  /* ================================================================
     Sidebar Navigation & Responsive
     ================================================================ */
  function handleSidebarNavClick(e) {
    const item = e.target.closest('.nav-item');
    if (!item) return;
    const page = item.dataset.page;
    if (!page) return;

    // Update active styling
    $$('.nav-item').forEach((n) => n.classList.remove('active'));
    item.classList.add('active');

    // Route to page
    switch (page) {
      case 'shelf':
        navigateTo('shelf');
        break;
      case 'browse':
        navigateTo('browse');
        break;
      case 'reader':
        navigateTo('reader');
        break;
      case 'downloads':
        navigateTo('downloads');
        break;
      case 'history':
        navigateTo('history');
        break;
      default:
        // Other pages (settings, about) — placeholder
        showToast('该功能正在开发中', 'info');
        $$('.nav-item').forEach((n) => n.classList.remove('active'));
        const shelfNav = document.querySelector('.nav-item[data-page="shelf"]');
        if (shelfNav) shelfNav.classList.add('active');
    }
  }

  function handleSidebarToggle() {
    dom.sidebar.classList.toggle('open');
  }

  /* ================================================================
     Page Routing & Management
     ================================================================ */
  function navigateTo(page, data) {
    state.previousPage = state.currentPage;
    state.currentPage = page;

    // Update sidebar active state
    $$('.nav-item').forEach((n) => {
      n.classList.remove('active');
      if (n.dataset.page === page || (page === 'detail' && n.dataset.page === 'shelf')) {
        n.classList.add('active');
      }
    });

    // Show/hide page sections
    const isShelf = page === 'shelf';
    const isBrowse = page === 'browse';
    const isDownloads = page === 'downloads';
    const isHistory = page === 'history';
    const isDetail = page === 'detail' || page === 'reader';

    // Tab bar visible only in shelf mode
    dom.tabBarWrapper.classList.toggle('hidden', !isShelf);

    // Books container visible in shelf, browse, downloads, or history mode
    dom.booksContainer.style.display = (isShelf || isBrowse || isDownloads || isHistory) ? '' : 'none';

    // Detail page visible in detail mode
    dom.detailPage.style.display = isDetail ? '' : 'none';

    // Header back button: visible in detail/browse/history
    dom.headerBackBtn.style.display = (isDetail || isBrowse || isHistory) ? '' : 'none';

    // Header actions: full set in shelf, partial in browse, hidden in detail
    if (isDetail) {
      dom.searchBtn.style.display = 'none';
      dom.uploadBtn.style.display = 'none';
      dom.refreshBtn.style.display = 'none';
      dom.totalBookCount.style.display = 'none';
    } else if (isBrowse) {
      dom.searchBtn.style.display = '';
      dom.uploadBtn.style.display = 'none';
      dom.refreshBtn.style.display = '';
      dom.totalBookCount.style.display = 'none';
    } else if (isDownloads || isHistory) {
      dom.searchBtn.style.display = 'none';
      dom.uploadBtn.style.display = 'none';
      dom.refreshBtn.style.display = '';
      dom.totalBookCount.style.display = 'none';
    } else {
      // Shelf
      dom.searchBtn.style.display = '';
      dom.uploadBtn.style.display = '';
      dom.refreshBtn.style.display = '';
      dom.totalBookCount.style.display = '';
    }

    dom.mainContent.style.background = isDetail ? '#080808' : '';

    // Hide history container when navigating away from history
    if (page !== 'history') {
      var hc = document.getElementById('historyContainer');
      if (hc) hc.style.display = 'none';
    }

    switch (page) {
      case 'shelf':
        if (!state.activeShelfId && state.shelves.length > 0) {
          state.activeShelfId = state.shelves[0].id;
          state.activeShelfName = state.shelves[0].name;
        }
        if (state.activeShelfId) {
          renderTabs();
          loadBooks(state.activeShelfId);
        } else {
          state.books = [];
          renderBooks();
        }
        break;
      case 'browse':
        if (state.browseMode === 'search') {
          renderBrowseBooks();
          updateDownloadLimit();
        } else {
          loadBrowseBooks();
        }
        break;
      case 'downloads':
        stopDownloadPolling();
        loadDownloadTasks();
        startDownloadPolling();
        break;
      case 'history':
        renderHistoryPage();
        break;
      case 'detail':
        if (data) {
          state.detailBook = data;
          renderDetailPage();
        }
        break;
    }
    updateHeader();
  }

  function updateHeader() {
    switch (state.currentPage) {
      case 'shelf': {
        const shelfName = state.activeShelfName || '书架';
        dom.headerTitle.textContent = shelfName;
        dom.totalBookCount.textContent = state.totalBookCount;
        break;
      }
      case 'browse':
        dom.headerTitle.textContent = state.browseMode === 'search'
          ? `搜索结果: ${state.searchQuery || ''}`
          : '热门书籍';
        break;
      case 'detail':
      case 'reader': {
        const book = state.detailBook;
        dom.headerTitle.textContent = (book && book.title) ? book.title : '书籍详情';
        break;
      }
      case 'downloads':
        dom.headerTitle.textContent = '下载';
        break;
      case 'history':
        dom.headerTitle.textContent = '历史';
        break;
    }
  }

  function goBack() {
    if (state.currentPage === 'detail' || state.currentPage === 'reader') {
      navigateTo(state.previousPage);
    } else if (state.currentPage === 'browse' || state.currentPage === 'history') {
      navigateTo('shelf');
    }
  }

  /* ================================================================
     Browse Page
     ================================================================ */
  async function updateDownloadLimit() {
    const span = dom.loginBtn.querySelector('span');
    try {
      const resp = await api('/zlibrary/downloads-left');
      if (resp && resp.success && resp.data != null) {
        span.textContent = 'Z-Library · 剩余' + resp.data + '次';
      } else {
        console.warn('Downloads-left api failed:', resp);
      }
    } catch (e) {
      console.warn('Downloads-left error:', e.message);
    }
  }

  async function loadBrowseBooks() {
    showLoading();
    state.browseMode = 'popular';
    try {
      // Fetch download limit in parallel
      updateDownloadLimit();
      const resp = await fetchMostPopular();
      if (resp && resp.success && resp.data && resp.data.books) {
        state.browseBooks = resp.data.books;
      } else if (Array.isArray(resp)) {
        state.browseBooks = resp;
      } else if (resp && Array.isArray(resp.data)) {
        state.browseBooks = resp.data;
      } else {
        state.browseBooks = [];
      }
      renderBrowseBooks();
    } catch (err) {
      showToast('请先登录Z-Library', 'error');
      navigateTo(state.previousPage);
      // Re-highlight shelf nav
      $$('.nav-item').forEach((n) => {
        n.classList.remove('active');
        if (n.dataset.page === 'shelf') n.classList.add('active');
      });
    }
    hideLoading();
  }

  function renderBrowseBooks() {
    const books = state.browseBooks;
    if (books.length === 0) {
      dom.booksGrid.innerHTML = '';
      dom.emptyState.style.display = 'flex';
      dom.booksGrid.style.display = 'none';
      dom.emptyState.querySelector('p:first-of-type').textContent = '暂无热门书籍';
      dom.emptyState.querySelector('.text-muted').textContent = '请先登录 Z-Library 后重试';
      return;
    }

    dom.emptyState.style.display = 'none';
    dom.booksGrid.style.display = 'grid';

    dom.booksGrid.innerHTML = books
      .map((book) => {
        const coverUrl = book.cover || book.coverUrl || '';
        return `
        <div class="book-card"
             data-book-id="${escapeHtml(book.id || '')}"
             data-book-bookid="${escapeHtml(book.id || '')}"
             data-title="${escapeHtml(book.title || '')}"
             data-author="${escapeHtml(book.author || '')}"
             data-cover="${escapeHtml(coverUrl)}"
             data-extension="${escapeHtml(book.extension || '')}"
             data-filesize="${book.filesize || 0}"
             data-hash="${escapeHtml(book.hash || '')}"
             data-description="${escapeHtml(book.description || '')}"
             data-source="zlib"
             draggable="false">
          <div class="cover-wrapper">
            ${coverUrl
              ? `<img class="cover-img" src="${escapeHtml(coverUrl)}" alt="${escapeHtml(book.title || '')}" loading="lazy">`
              : `<div class="cover-placeholder" style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;background:var(--panel);color:var(--muted);font-size:32px;">📖</div>`
            }
            <div class="cover-overlay"></div>
          </div>
          <div class="book-title">${escapeHtml(book.title || '未命名')}</div>
          ${book.author ? `<div class="book-author">${escapeHtml(book.author)}</div>` : ''}
        </div>`;
      })
      .join('');
  }

  /* ================================================================
     Book Detail Page
     ================================================================ */
  async function renderDetailPage() {
    const book = state.detailBook;
    if (!book) return;
    console.log('renderDetailPage: rendering book', book.id, book.title);

    // Clear stale state from previous detail view
    state.detailToc = [];
    state.detailProgress = null;

    // Set readOnlineUrl from book data immediately (Z-Library search results include it)
    if (book.readOnlineUrl && !book._readOnlineUrl) {
      book._readOnlineUrl = book.readOnlineUrl;
    }

    dom.mainContent.style.background = '#080808';

    // Cover
    const coverUrl = book.coverUrl || book.cover || '';
    if (coverUrl) {
      dom.detailCover.src = coverUrl;
      dom.detailCover.style.display = '';
      // Reset parent to original state (undo any placeholder)
      const wrapper = dom.detailCover.parentElement;
      // Remove any placeholder div we may have added
      const placeholder = wrapper.querySelector('.detail-cover-placeholder');
      if (placeholder) placeholder.remove();
    } else {
      dom.detailCover.style.display = 'none';
      const wrapper = dom.detailCover.parentElement;
      if (!wrapper.querySelector('.detail-cover-placeholder')) {
        const ph = document.createElement('div');
        ph.className = 'detail-cover-placeholder';
        ph.innerHTML = '📖';
        Object.assign(ph.style, {
          position: 'absolute', inset: '0',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: '#211315', borderRadius: '5px', color: '#a0a0a0',
          fontSize: '48px'
        });
        wrapper.appendChild(ph);
      }
    }
    dom.detailCover.alt = book.title || '';

    // Meta
    dom.detailTitle.textContent = book.title || '未命名';
    dom.detailAuthor.textContent = '作者: ' + (book.author || '未知');
    dom.detailStatus.textContent = '状态: ' + (book.status || (book.progress && book.progress.finished ? '已读完' : '未读'));
    dom.detailSource.textContent = '来源: ' + (book.source || (book.zlibId ? 'Z-Library' : '本地书库'));

    // Description
    const desc = book.description || '';
    if (desc) {
      dom.detailDescText.textContent = desc;
      dom.detailDescText.classList.remove('expanded');
      dom.detailDesc.style.display = '';
      // Show "查看更多" if description is long enough
      // We check after render via a small delay
      setTimeout(() => {
        const lineHeight = parseFloat(getComputedStyle(dom.detailDescText).lineHeight) || 22;
        const maxHeight = lineHeight * 3;
        if (dom.detailDescText.scrollHeight > maxHeight + 4) {
          dom.detailDescMore.style.display = '';
        } else {
          dom.detailDescMore.style.display = 'none';
        }
      }, 50);
    } else {
      dom.detailDesc.style.display = 'none';
    }

    // TOC — render pre-fetched data immediately if available (before tags to survive tags failure)
    if (book.toc && Array.isArray(book.toc) && book.toc.length > 0) {
      state.detailToc = book.toc;
      renderToc();
    }

    // Tags
    const tags = [];
    if (book.extension) tags.push(book.extension.toUpperCase());
    if (book.language) tags.push(book.language);
    if (book.year) tags.push(String(book.year));
    if (book.publisher) tags.push(book.publisher);
    if (book.series) tags.push(book.series);
    if (book.pages) tags.push(book.pages + '页');
    if (book.filesize) tags.push(formatFileSize(book.filesize));

    dom.detailTags.innerHTML = tags.length > 0
      ? tags.map((t) => `<span class="detail-tag">${escapeHtml(t)}</span>`).join('')
      : '<span class="detail-tag">未分类</span>';

    // Also run loadDetailToc for fallback / lazy fetch (will no-op if already rendered)
    try {
      await loadDetailToc();
    } catch (e) {
      console.error('renderDetailPage: loadDetailToc error', e);
    }

    // Continue reading button
    try {
      await loadDetailProgress();
    } catch (e) {
      console.error('renderDetailPage: loadDetailProgress error', e);
    }

    // Load additional metadata from API
    try {
      loadDetailMetadata();
    } catch (e) {
      console.error('renderDetailPage: loadDetailMetadata error', e);
    }
  }

  async function loadDetailToc() {
    const book = state.detailBook;
    if (!book) { console.warn('loadDetailToc: no book'); return; }

    // Never call local TOC API for Z-Library browse/search books
    if (book.source !== '本地书库') {
      const totalPages = book.pages || 1;
      const pageCount = Math.min(totalPages, 20);
      const toc = Array.from({ length: pageCount }, (_, i) => ({
        title: `第${i + 1}页`,
        index: i + 1,
        createdAt: null,
      }));
      if (state.detailToc !== toc) {
        state.detailToc = toc;
        renderToc();
      }
      return;
    }

    let toc = [];

    // Check tocCache or book.toc (pre-fetched in handleBookClick)
    const cached = state.tocCache[book.bookId] || book.toc;
    if (cached && Array.isArray(cached) && cached.length > 0) {
      toc = cached;
    } else {
      const entityId = book.bookId;
      if (entityId) {
        try {
          const resp = await fetchBookToc(entityId);
          if (resp && Array.isArray(resp)) {
            toc = resp;
            state.tocCache[entityId] = resp;
          } else if (resp && resp.data && Array.isArray(resp.data)) {
            toc = resp.data;
            state.tocCache[entityId] = resp.data;
          }
        } catch (e) {
          // fetch failed, fall through to placeholder
        }
      }
    }

    // If no TOC, generate placeholder
    if (toc.length === 0) {
      const totalPages = book.pages || (book.progress && book.progress.totalPages) || 1;
      const pageCount = Math.min(totalPages, 20);
      toc = Array.from({ length: pageCount }, (_, i) => ({
        title: `第${i + 1}页`,
        index: i + 1,
        createdAt: null,
      }));
    }

    // Only re-render if toc changed (prevent overwriting a previously rendered real TOC)
    if (state.detailToc !== toc) {
      state.detailToc = toc;
      renderToc();
    }
  }

  function renderToc() {
    const toc = state.detailToc;
    dom.tocCount.textContent = toc.length;

    if (toc.length === 0) {
      dom.tocList.innerHTML = '<div class="toc-empty">暂无目录信息</div>';
      return;
    }

    dom.tocList.innerHTML = toc
      .map((item, i) => {
        const title = item.title || `章节 ${i + 1}`;
        const date = item.createdAt || item.date || '';
        const progress = item.progressPercent || item.percentage || 0;

        return `
        <div class="toc-item" data-index="${i}" data-href="${escapeHtml(item.href || '')}" data-chapterindex="${escapeHtml(String(item.chapterIndex != null ? item.chapterIndex : i))}">
          <div class="toc-item-info">
            <div class="toc-item-title">${escapeHtml(title)}</div>
            ${date ? `<div class="toc-item-date">${escapeHtml(date)}</div>` : ''}
            ${progress > 0 ? `
            <div class="toc-item-progress">
              <div class="toc-item-progress-bar" style="width:${progress}%"></div>
            </div>` : ''}
          </div>
          <button class="toc-item-options" data-index="${i}" title="选项">
            <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
              <circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/>
            </svg>
          </button>
        </div>`;
      })
      .join('');
  }

  async function loadDetailProgress() {
    const book = state.detailBook;
    if (!book || book.source !== '本地书库') return;
    const entityId = book?.bookId || book?.id;
    if (!entityId) return;

    try {
      const progress = await getBookProgress(entityId);
      state.detailProgress = progress;
    } catch {
      state.detailProgress = null;
    }

    // Show continue reading button if there's progress
    if (state.detailProgress && state.detailProgress.currentPage > 0 && !state.detailProgress.finished) {
      dom.continueReadingBtn.style.display = '';
    } else {
      dom.continueReadingBtn.style.display = 'none';
    }
  }

  async function loadDetailMetadata() {
    const book = state.detailBook;
    if (!book.zlibId || !book.zlibHash) return;

    // Capture identity for stale check after async
    const identity = book.zlibId + '|' + book.zlibHash + '|' + (book.bookId || book.id);

    try {
      const resp = await fetchZlibBookDetail(book.zlibId, book.zlibHash);

      // Guard: if navigated to a different book since the request started, discard
      const current = state.detailBook;
      const currentId = (current?.zlibId || '') + '|' + (current?.zlibHash || '') + '|' + (current?.bookId || current?.id || '');
      if (currentId !== identity) return;

      // Response: {success, data: {success:1, book: {title, author, ...}}}
      const raw = resp?.data;
      const d = raw?.book || raw; // Z-Library response nests under 'book'

      if (!d) return;

      // Update description
      if (d.description && !book.description) {
        book.description = d.description;
        dom.detailDescText.textContent = d.description;
        dom.detailDesc.style.display = '';
        dom.detailDescText.classList.remove('expanded');
        setTimeout(() => {
          const lineHeight = parseFloat(getComputedStyle(dom.detailDescText).lineHeight) || 22;
          if (dom.detailDescText.scrollHeight > lineHeight * 3 + 4) {
            dom.detailDescMore.style.display = '';
          }
        }, 50);
      }

      // Update status/source with richer info
      dom.detailStatus.textContent = '状态: ' + (d.readOnlineAvailable ? '可在线阅读' : '可下载');
      dom.detailSource.textContent = '来源: Z-Library';
      if (d.filesize) {
        dom.detailSource.textContent += ' · ' + (d.filesizeString || formatFileSize(d.filesize));
      }

      // Tags with all metadata
      const tags = [];
      if (d.extension) tags.push(d.extension.toUpperCase());
      if (d.language) tags.push(d.language);
      if (d.year) tags.push(String(d.year));
      if (d.publisher) tags.push(d.publisher);
      if (d.series) tags.push(d.series);
      if (d.pages) tags.push(d.pages + '页');
      if (d.filesize) tags.push(d.filesizeString || formatFileSize(d.filesize));
      if (d.interestScore) tags.push('⭐ ' + d.interestScore);

      if (tags.length > 0) {
        dom.detailTags.innerHTML = tags.map((t) => `<span class="detail-tag">${escapeHtml(t)}</span>`).join('');
      }

      // Store readOnlineUrl for the online reading button
      if (d.readOnlineUrl) {
        book._readOnlineUrl = d.readOnlineUrl;
      }
      // Store download link
      if (d.dl) {
        book._downloadPath = d.dl;
      }
    } catch {
      // Silently fail — metadata is optional
    }
  }

  function handleDetailDescToggle() {
    const isExpanded = dom.detailDescText.classList.contains('expanded');
    if (isExpanded) {
      dom.detailDescText.classList.remove('expanded');
      dom.detailDescMore.textContent = '查看更多';
    } else {
      dom.detailDescText.classList.add('expanded');
      dom.detailDescMore.textContent = '收起';
    }
  }

  /* ================================================================
     Detail Page: Action Buttons
     ================================================================ */
  async function handleDetailReadOnline() {
    const book = state.detailBook;
    if (!book) return;

    // Z-Library: prefer readOnlineUrl — wait for metadata if not yet loaded
    if (book.zlibId && book.zlibHash) {
      if (!book._readOnlineUrl) {
        showToast('正在获取阅读链接...', 'info');
        await loadDetailMetadata();
      }
      if (book._readOnlineUrl) {
        window.open(book._readOnlineUrl, '_blank');
        return;
      }
      // Fallback: no online reader available, offer download
      showToast('该书不支持在线阅读，请先下载到书架', 'info');
      return;
    }

    // Local book: open reader
    if (book.id) {
      window.open(`/api/books/${book.id}/read`, '_blank');
    } else {
      showToast('无法打开此书', 'error');
    }
  }

  function handleDetailDownloadToShelf() {
    const book = state.detailBook;
    if (!book) return;
    state.downloadTargetBook = book;
    showDownloadShelfModal();
  }

  function handleDetailFav() {
    showToast('收藏功能开发中', 'info');
  }

  function handleDetailLocalRead() {
    const currentBook = state.detailBook;
    if (!currentBook) return;
    const entityId = currentBook.bookId || currentBook.id;
    // Check matching card in books grid for file status
    const card = document.querySelector(`.book-card[data-book-bookid="${entityId}"]`);
    if (card && card.dataset.hasFile === 'true') {
      const title = encodeURIComponent(currentBook.title || '');
      const author = encodeURIComponent(currentBook.author || '');
      const ext = encodeURIComponent(currentBook.extension || '');
      window.open(`/reader.html?bookId=${entityId}&title=${title}&author=${author}&ext=${ext}`, '_blank');
    } else {
      showToast('请先从Z-Library下载此书后再阅读', 'error');
    }
  }

  /* ================================================================
     Download to Shelf Modal
     ================================================================ */
  function showDownloadShelfModal() {
    const shelves = state.shelves;
    state.selectedShelfIds = [];

    if (shelves.length === 0) {
      showToast('请先创建书架', 'error');
      return;
    }

    // Auto-select if only one shelf
    if (shelves.length === 1) {
      state.selectedShelfIds = [shelves[0].id];
    }

    dom.shelfCheckboxList.innerHTML = shelves
      .map((shelf) => {
        const selected = state.selectedShelfIds.includes(shelf.id);
        return `
        <div class="shelf-checkbox-item ${selected ? 'selected' : ''}" data-shelf-id="${shelf.id}">
          <div class="shelf-checkbox"></div>
          <span class="shelf-checkbox-label">${escapeHtml(shelf.name)}</span>
        </div>`;
      })
      .join('');

    showModal('downloadShelf');
  }

  function handleShelfCheckboxClick(e) {
    const item = e.target.closest('.shelf-checkbox-item');
    if (!item) return;
    const shelfId = parseInt(item.dataset.shelfId);
    const idx = state.selectedShelfIds.indexOf(shelfId);
    if (idx >= 0) {
      state.selectedShelfIds.splice(idx, 1);
      item.classList.remove('selected');
    } else {
      state.selectedShelfIds.push(shelfId);
      item.classList.add('selected');
    }
  }

  async function handleDownloadShelfConfirm() {
    if (state.selectedShelfIds.length === 0) {
      showToast('请至少选择一个书架', 'error');
      return;
    }

    const book = state.downloadTargetBook;
    if (!book) return;

    const bookData = {
      zlibId: book.zlibId || book.id || '',
      zlibHash: book.zlibHash || book.hash || '',
      title: book.title || '',
      author: book.author || '',
      coverUrl: book.coverUrl || book.cover || '',
      extension: book.extension || '',
      filesize: book.filesize || 0,
      description: book.description || '',
    };

    // Add to selected shelves
    let successCount = 0, errorCount = 0;
    for (const shelfId of state.selectedShelfIds) {
      try {
        await addBookToShelf(shelfId, bookData);
        successCount++;
      } catch (err) {
        errorCount++;
      }
    }

    // Close modal immediately — user is unblocked
    hideModal('downloadShelf');

    if (successCount > 0) {
      showToast(`已添加到 ${successCount} 个书架`, 'success');
      await refreshAll();
    }
    if (errorCount > 0) {
      showToast(`${errorCount} 个书架添加失败`, 'error');
    }

    // Fire background download — non-blocking, progress shown in downloads page
    if (book.zlibId && book.zlibHash) {
      try {
        const resp = await startBackgroundDownload({
          zlibId: Number(book.zlibId),
          zlibHash: book.zlibHash,
          title: bookData.title,
          author: bookData.author,
          coverUrl: bookData.coverUrl,
          extension: bookData.extension,
          filesize: bookData.filesize,
          description: bookData.description,
          shelfIds: state.selectedShelfIds,
        });
        if (resp && resp.success && resp.data && resp.data.taskId) {
          state.downloadTasks.unshift({
            taskId: resp.data.taskId,
            title: bookData.title,
            author: bookData.author,
            coverUrl: bookData.coverUrl,
            extension: bookData.extension,
            totalBytes: bookData.filesize,
            downloadedBytes: 0,
            status: 'DOWNLOADING',
            createdAt: new Date().toISOString(),
          });
          showToast('已加入下载队列', 'success');
          if (state.currentPage === 'downloads') renderDownloadsPage();
        }
      } catch (e) {
        showToast('下载启动失败', 'error');
      }
    }
  }

  // Close sidebar on outside click (mobile)
  document.addEventListener('click', (e) => {
    if (
      window.innerWidth <= 768 &&
      dom.sidebar.classList.contains('open') &&
      !dom.sidebar.contains(e.target) &&
      e.target !== dom.sidebarToggle &&
      !dom.sidebarToggle.contains(e.target)
    ) {
      dom.sidebar.classList.remove('open');
    }
  });

  /* ================================================================
     Keyboard Shortcuts
     ================================================================ */
  function handleKeydown(e) {
    // Escape: close context menu, modals, or go back from detail/browse
    if (e.key === 'Escape') {
      // First check if any modal is open
      const anyModalOpen = Array.from($$('.modal-overlay')).some((m) => m.style.display === 'flex');

      if (state.contextMenu.visible) {
        hideContextMenu();
      } else if (anyModalOpen) {
        hideAllModals();
      } else if (state.currentPage === 'detail' || state.currentPage === 'browse' || state.currentPage === 'history') {
        goBack();
      }
    }

    // Ctrl+F / Cmd+F: open search
    if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
      e.preventDefault();
      handleSearch();
    }

    // Ctrl+R / Cmd+R: prevent page reload, use our refresh
    if ((e.ctrlKey || e.metaKey) && e.key === 'r') {
      e.preventDefault();
      refreshAll();
    }

    // Enter in search
    if (e.key === 'Enter' && $('#searchModal').style.display === 'flex') {
      const active = document.activeElement;
      if (active === $('#searchQuery')) {
        e.preventDefault();
        executeSearch();
      }
    }
  }

  /* ================================================================
     Downloads Page
     ================================================================ */
  async function loadDownloadTasks() {
    try {
      const list = await fetchDownloadList();
      // Merge with existing local tasks (preserve in-progress tasks that might be newer locally)
      const merged = new Map();
      for (const t of state.downloadTasks) merged.set(t.taskId, t);
      for (const t of list) {
        if (merged.has(t.taskId)) {
          // Backend has authoritative progress
          merged.set(t.taskId, { ...merged.get(t.taskId), ...t });
        } else {
          merged.set(t.taskId, t);
        }
      }
      state.downloadTasks = Array.from(merged.values())
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    } catch (e) {
      // keep existing state
    }
    renderDownloadsPage();
  }

  function renderDownloadsPage() {
    const tasks = state.downloadTasks;
    dom.emptyState.style.display = 'none';
    dom.booksGrid.style.display = tasks.length === 0 ? 'none' : 'grid';

    if (tasks.length === 0) {
      dom.booksGrid.innerHTML = '';
      dom.emptyState.style.display = 'flex';
      dom.emptyState.querySelector('p:first-of-type').textContent = '暂无下载任务';
      dom.emptyState.querySelector('.text-muted').textContent = '从 Z-Library 添加书籍后下载任务会在此显示';
      return;
    }

    dom.emptyState.style.display = 'none';
    dom.booksGrid.innerHTML = tasks
      .map((t) => {
        const pct = t.totalBytes > 0 ? Math.round((t.downloadedBytes / t.totalBytes) * 100) : 0;
        const statusText = {
          DOWNLOADING: '下载中',
          CONVERTING: '格式转换中',
          SAVING: '保存中',
          COMPLETED: '已完成',
          FAILED: '失败',
        }[t.status] || t.status || '等待中';
        const isActive = t.status === 'DOWNLOADING' || t.status === 'CONVERTING' || t.status === 'SAVING';
        const isFailed = t.status === 'FAILED';

        return `
        <div class="book-card download-card" data-task-id="${escapeHtml(t.taskId)}">
          <div class="cover-wrapper">
            ${t.coverUrl
              ? `<img class="cover-img" src="${escapeHtml(t.coverUrl)}" alt="" loading="lazy">`
              : `<div class="cover-placeholder" style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;background:var(--panel);color:var(--muted);font-size:32px;">📥</div>`
            }
            <div class="cover-overlay"></div>
          </div>
          <div class="book-title">${escapeHtml(t.title || '未命名')}</div>
          ${t.author ? `<div class="book-author">${escapeHtml(t.author)}</div>` : ''}
          <div class="download-progress-section">
            <div class="download-progress-bar-wrapper">
              <div class="download-progress-bar${isFailed ? ' failed' : ''}" style="width:${isActive ? pct : 100}%"></div>
            </div>
            <div class="download-progress-info">
              <span class="download-progress-status${isFailed ? ' failed' : ''}">${statusText}</span>
              <span class="download-progress-size">${isActive ? formatFileSize(t.downloadedBytes) + ' / ' + formatFileSize(t.totalBytes) : formatFileSize(t.totalBytes)}</span>
            </div>
            ${t.errorMessage ? `<div class="download-error">${escapeHtml(t.errorMessage)}</div>` : ''}
          </div>
        </div>`;
      })
      .join('');
  }

  function startDownloadPolling() {
    stopDownloadPolling();
    state.downloadPollTimer = setInterval(async () => {
      if (state.currentPage !== 'downloads') return;
      await loadDownloadTasks();
    }, 2000);
  }

  function stopDownloadPolling() {
    if (state.downloadPollTimer) {
      clearInterval(state.downloadPollTimer);
      state.downloadPollTimer = null;
    }
  }

  async function renderHistoryPage() {
    // Hide shelf/browse grid; use a dedicated container inside booksContainer
    dom.booksGrid.style.display = 'none';
    dom.emptyState.style.display = 'none';

    let hc = document.getElementById('historyContainer');
    if (!hc) {
      hc = document.createElement('div');
      hc.id = 'historyContainer';
      dom.booksContainer.appendChild(hc);
    }
    hc.style.display = '';
    hc.innerHTML = '<div class="loading-state" style="display:flex;"><div class="spinner"></div><p>加载中...</p></div>';

    try {
      const resp = await api('/books/history');
      const items = (resp && resp.success && resp.data) ? resp.data : [];

      if (items.length === 0) {
        hc.innerHTML = `
          <div class="empty-state" style="display:flex;">
            <div class="empty-state-kaomoji">(&#180;&middot;&omega;&middot;&#180;)</div>
            <p>暂无阅读记录</p>
            <p class="text-muted">阅读书籍后，历史会在此显示</p>
          </div>`;
        return;
      }

      const now = new Date();
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const yesterdayStart = new Date(todayStart.getTime() - 86400000);

      const groups = { today: [], yesterday: [], earlier: [] };
      items.forEach(function (it) {
        if (!it.lastReadAt) return;
        var d = new Date(it.lastReadAt);
        var dDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());
        if (dDay.getTime() >= todayStart.getTime()) {
          groups.today.push(it);
        } else if (dDay.getTime() >= yesterdayStart.getTime()) {
          groups.yesterday.push(it);
        } else {
          groups.earlier.push(it);
        }
      });

      function timeFmt(iso) {
        var d = new Date(iso);
        return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
      }

      function renderCard(item) {
        var ext = item.extension || '';
        var cover = item.coverUrl || '';
        return '<div class="history-card" data-book-id="' + item.bookId + '" data-ext="' + escapeHtml(ext)
          + '" data-title="' + escapeHtml(item.title || '') + '" data-author="' + escapeHtml(item.author || '') + '">'
          + '<div class="history-card-cover">'
          + (cover
            ? '<img src="' + escapeHtml(cover) + '" alt="" loading="lazy">'
            : '<div class="history-card-cover-placeholder">' + (ext.slice(0, 2).toUpperCase() || '?') + '</div>')
          + '</div>'
          + '<div class="history-card-info">'
          + '<div class="history-card-title">' + escapeHtml(item.title || '未命名') + '</div>'
          + '<div class="history-card-meta">' + escapeHtml(item.author || '') + ' &middot; ' + timeFmt(item.lastReadAt) + '</div>'
          + '</div></div>';
      }

      var html = '';
      if (groups.today.length) { html += '<div class="history-date-group"><h3 class="history-date-title">今天</h3>' + groups.today.map(renderCard).join('') + '</div>'; }
      if (groups.yesterday.length) { html += '<div class="history-date-group"><h3 class="history-date-title">昨天</h3>' + groups.yesterday.map(renderCard).join('') + '</div>'; }
      if (groups.earlier.length) { html += '<div class="history-date-group"><h3 class="history-date-title">更早</h3>' + groups.earlier.map(renderCard).join('') + '</div>'; }

      hc.innerHTML = html;

      hc.querySelectorAll('.history-card').forEach(function (card) {
        card.addEventListener('click', function () {
          var bookId = card.dataset.bookId;
          var ext = card.dataset.ext;
          var title = card.dataset.title;
          var author = card.dataset.author;
          window.location.href = '/reader.html?bookId=' + bookId
            + '&title=' + encodeURIComponent(title)
            + '&author=' + encodeURIComponent(author)
            + '&ext=' + encodeURIComponent(ext);
        });
      });
    } catch (e) {
      hc.innerHTML = '<div class="empty-state" style="display:flex;"><p>加载失败</p></div>';
    }
  }

  /* ================================================================
     Event Binding
     ================================================================ */
  function bindEvents() {
    // Sidebar
    dom.sidebarNav.addEventListener('click', handleSidebarNavClick);
    dom.sidebarToggle.addEventListener('click', handleSidebarToggle);
    dom.loginBtn.addEventListener('click', handleLoginOpen);

    // Header
    dom.searchBtn.addEventListener('click', handleSearch);
    dom.refreshBtn.addEventListener('click', refreshAll);
    dom.uploadBtn.addEventListener('click', handleUploadOpen);

    // Tab bar
    dom.tabBar.addEventListener('click', handleTabClick);
    dom.tabBar.addEventListener('dblclick', handleTabDblClick);
    dom.tabBar.addEventListener('contextmenu', handleTabRightClick);
    dom.tabBar.addEventListener('dragstart', handleTabDragStart);
    dom.tabBar.addEventListener('dragend', handleTabDragEnd);
    dom.tabBar.addEventListener('dragover', handleTabDragOver);
    dom.tabBar.addEventListener('drop', handleTabDrop);
    dom.addShelfBtn.addEventListener('click', handleAddShelf);

    // Global: detect tab name input keydown
    document.addEventListener('keydown', (e) => {
      if (e.target.classList.contains('tab-name-input')) {
        handleTabInputKey(e);
      }
    });

    document.addEventListener(
      'focusout',
      (e) => {
        if (e.target.classList.contains('tab-name-input')) {
          handleTabInputBlur(e);
        }
      },
      true
    );

    // Book grid
    dom.booksGrid.addEventListener('click', handleBookClick);
    dom.booksGrid.addEventListener('contextmenu', handleBookRightClick);
    dom.booksGrid.addEventListener('click', (e) => {
      if (e.target.closest('.cover-options-btn')) handleBookOptionsBtn(e);
      if (e.target.closest('.cover-read-btn')) {
        const btn = e.target.closest('.cover-read-btn');
        handleReadBook(btn.dataset.bookId);
      }
      if (e.target.closest('.btn-local-read') && !e.target.closest('.btn-local-read.disabled')) {
        const btn = e.target.closest('.btn-local-read');
        handleReadBook(btn.dataset.bookId);
      }
    });

    // Context menu
    dom.contextMenu.addEventListener('click', handleContextMenuClick);
    document.addEventListener('click', (e) => {
      if (!dom.contextMenu.contains(e.target)) {
        hideContextMenu();
      }
    });

    // Search modal
    $('#searchSubmitBtn').addEventListener('click', executeSearch);
    $('#searchModalClose').addEventListener('click', () => hideModal('search'));
    $('#searchModal').addEventListener('click', (e) => {
      if (e.target === $('#searchModal')) hideModal('search');
    });

    // Upload modal
    $('#uploadModalClose').addEventListener('click', () => hideModal('upload'));
    $('#uploadModal').addEventListener('click', (e) => {
      if (e.target === $('#uploadModal')) hideModal('upload');
    });
    $('#uploadDropzone').addEventListener('click', handleUploadDropzoneClick);
    $('#uploadFileInput').addEventListener('change', handleUploadFileChange);
    $('#uploadDropzone').addEventListener('dragover', handleUploadDropzoneDragOver);
    $('#uploadDropzone').addEventListener('dragleave', handleUploadDropzoneDragLeave);
    $('#uploadDropzone').addEventListener('drop', handleUploadDropzoneDrop);
    $('#uploadSubmitBtn').addEventListener('click', handleUploadSubmit);

    // Login modal
    $('#loginSubmitBtn').addEventListener('click', handleLoginSubmit);
    $('#loginModalClose').addEventListener('click', () => hideModal('login'));
    $('#loginModal').addEventListener('click', (e) => {
      if (e.target === $('#loginModal')) hideModal('login');
    });
    $('#loginPassword').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') handleLoginSubmit();
    });

    // Rename modal
    $('#renameSubmitBtn').addEventListener('click', handleRenameSubmit);
    $('#renameModalClose').addEventListener('click', () => hideModal('rename'));
    $('#renameModal').addEventListener('click', (e) => {
      if (e.target === $('#renameModal')) hideModal('rename');
    });
    $('#renameInput').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') handleRenameSubmit();
      if (e.key === 'Escape') hideModal('rename');
    });

    // Keyboard
    document.addEventListener('keydown', handleKeydown);

    // Detail page — header back button
    dom.headerBackBtn.addEventListener('click', goBack);

    // Detail page — description toggle
    dom.detailDescMore.addEventListener('click', handleDetailDescToggle);

    // Detail page — action buttons
    dom.detailReadOnline.addEventListener('click', handleDetailReadOnline);
    dom.detailDownloadToShelf.addEventListener('click', handleDetailDownloadToShelf);
    dom.detailFavBtn.addEventListener('click', handleDetailFav);
    dom.detailLocalRead.addEventListener('click', handleDetailLocalRead);

    // Detail page — TOC search
    dom.tocSearch.addEventListener('input', (e) => {
      const query = e.target.value.toLowerCase();
      const items = dom.tocList.querySelectorAll('.toc-item');
      items.forEach((item) => {
        const title = item.querySelector('.toc-item-title');
        if (title) {
          item.style.display = title.textContent.toLowerCase().includes(query) ? '' : 'none';
        }
      });
    });

    // Detail page — TOC sort
    let tocSortAsc = true;
    dom.tocSortBtn.addEventListener('click', () => {
      tocSortAsc = !tocSortAsc;
      state.detailToc.sort((a, b) => {
        const ta = a.title || '';
        const tb = b.title || '';
        return tocSortAsc ? ta.localeCompare(tb) : tb.localeCompare(ta);
      });
      renderToc();
    });

    // Detail page — TOC item click → open reader at chapter
    dom.tocList.addEventListener('click', (e) => {
      const item = e.target.closest('.toc-item');
      if (!item) return;
      if (e.target.closest('.toc-item-options')) return;
      const href = item.dataset.href;
      if (!href) return;
      const book = state.detailBook;
      if (!book) return;
      const entityId = book.bookId || book.id;
      const title = encodeURIComponent(book.title || '');
      const author = encodeURIComponent(book.author || '');
      const ext = encodeURIComponent(book.extension || '');
      window.open(
        `/reader.html?bookId=${entityId}&title=${title}&author=${author}&ext=${ext}&tocHref=${encodeURIComponent(href)}`,
        '_blank'
      );
    });

    // Detail page — continue reading
    dom.continueReadingBtn.addEventListener('click', handleDetailReadOnline);

    // Download-to-shelf modal
    dom.shelfCheckboxList.addEventListener('click', handleShelfCheckboxClick);
    dom.downloadShelfConfirmBtn.addEventListener('click', handleDownloadShelfConfirm);
    dom.downloadShelfModalClose.addEventListener('click', () => hideModal('downloadShelf'));
    dom.downloadShelfModal.addEventListener('click', (e) => {
      if (e.target === dom.downloadShelfModal) hideModal('downloadShelf');
    });

    // Auth page
    dom.authTabs.forEach(tab => tab.addEventListener('click', () => switchAuthTab(tab)));
    dom.appLogoutBtn.addEventListener('click', handleAppLogout);
    $('#authLoginPass').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') handleAuthSubmit('login');
    });
    $('#authRegPass').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') handleAuthSubmit('register');
    });

    // Expose auth handlers for inline onclick in HTML
    window._switchAuthTab = switchAuthTab;
    window._handleAuthSubmit = handleAuthSubmit;

    // Window resize - close sidebar on mobile
    window.addEventListener('resize', () => {
      if (window.innerWidth > 768) {
        dom.sidebar.classList.remove('open');
      }
    });
  }

  /* ================================================================
     Init
     ================================================================ */
  async function init() {
    bindEvents();

    // Check app auth first
    try {
      const resp = await authMe();
      if (resp && resp.success && resp.data) {
        state.user = resp.data;
        showAppPage();
        renderLoginStatus();
        await checkLoginStatus();
        await loadShelves();
      } else {
        showAuthPage();
        renderLoginStatus();
      }
    } catch {
      showAuthPage();
      renderLoginStatus();
    }
  }

  // Start app
  document.addEventListener('DOMContentLoaded', init);
})();
