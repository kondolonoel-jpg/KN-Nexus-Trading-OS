(() => {
  const $ = (selector, parent = document) => parent.querySelector(selector);
  const $$ = (selector, parent = document) => [...parent.querySelectorAll(selector)];

  document.addEventListener('DOMContentLoaded', () => {
    // Mobile sidebar
    const sidebar = $('.sidebar');
    $('.mobile-menu')?.addEventListener('click', () => sidebar?.classList.toggle('open'));
    $$('.side-link').forEach(link => link.addEventListener('click', () => sidebar?.classList.remove('open')));

    // Scroll reveal, vanilla replacement for ScrollTrigger
    const reveals = $$('.reveal:not(.visible)');
    if ('IntersectionObserver' in window && reveals.length) {
      const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            entry.target.classList.add('visible');
            observer.unobserve(entry.target);
          }
        });
      }, { threshold: 0.12 });
      reveals.forEach(item => observer.observe(item));
    } else reveals.forEach(item => item.classList.add('visible'));

    // Lightweight generic tabs / chips
    $$('.tabs').forEach(group => {
      $$('button', group).forEach(tab => tab.addEventListener('click', () => {
        $$('button', group).forEach(item => item.classList.remove('active'));
        tab.classList.add('active');
      }));
    });
    $$('.filter-chips').forEach(group => {
      $$('button', group).forEach(chip => chip.addEventListener('click', () => {
        if (chip.textContent.trim().startsWith('Tous')) {
          $$('button', group).forEach(item => item.classList.remove('active'));
          chip.classList.add('active');
        } else {
          const all = $$('button', group).find(item => item.textContent.trim().startsWith('Tous'));
          all?.classList.remove('active');
          chip.classList.toggle('active');
        }
      }));
    });

    // Mock buttons make the prototype responsive and explicit
    $$('[data-toast]').forEach(button => button.addEventListener('click', event => {
      event.preventDefault();
      showToast(button.dataset.toast);
    }));

    initAuthentication();
    hydrateUserIdentity();
    refreshRemoteIdentity();
    initProfilePage();

    initRiskCalculator();
    initAccountsPanel();
    initPlaybook();
    initLightbox();
    initJournalWorkspace();
    initMarketRegimes();
  });

  const USERS_STORAGE_KEY = 'kn-nexus-users-v1';
  const USER_SESSION_KEY = 'kn-nexus-session-v1';
  const REMOTE_USER_CACHE_KEY = 'kn-nexus-remote-user-v1';
  const PREVIEW_USER = { id: 'PREVIEW-LOCAL', username: 'NOEL', email: 'trader@knnexus.local', role: 'Nexus Pro' };

  function getUsers() {
    try {
      const users = JSON.parse(window.localStorage.getItem(USERS_STORAGE_KEY));
      return Array.isArray(users) ? users : [];
    } catch (_) { return []; }
  }

  function saveUsers(users) {
    try { window.localStorage.setItem(USERS_STORAGE_KEY, JSON.stringify(users)); } catch (_) { /* Browser storage unavailable */ }
  }

  function getAuthenticatedUser() {
    try {
      const remote = JSON.parse(window.localStorage.getItem(REMOTE_USER_CACHE_KEY));
      if (remote?.id) return remote;
      const session = JSON.parse(window.localStorage.getItem(USER_SESSION_KEY));
      if (!session?.userId) return null;
      return getUsers().find(user => user.id === session.userId) || null;
    } catch (_) { return null; }
  }

  function setAuthenticatedUser(user) {
    try { window.localStorage.setItem(USER_SESSION_KEY, JSON.stringify({ userId: user.id, signedInAt: new Date().toISOString() })); } catch (_) { /* Browser storage unavailable */ }
  }

  function cacheRemoteUser(user) {
    try { window.localStorage.setItem(REMOTE_USER_CACHE_KEY, JSON.stringify({ ...user, _remote: true })); } catch (_) { /* Browser storage unavailable */ }
  }

  async function apiRequest(path, options = {}) {
    try {
      const response = await fetch(path, { credentials: 'same-origin', headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }, ...options });
      const contentType = response.headers.get('content-type') || '';
      const body = contentType.includes('application/json') ? await response.json() : null;
      return { ok: response.ok, status: response.status, body };
    } catch (_) { return { ok: false, status: 0, body: null }; }
  }

  async function refreshRemoteIdentity() {
    const result = await apiRequest('/api/auth/me', { method: 'GET' });
    if (result.ok && result.body?.id) { cacheRemoteUser(result.body); hydrateUserIdentity(); }
    else if (result.status === 401) { try { window.localStorage.removeItem(REMOTE_USER_CACHE_KEY); } catch (_) { /* no action */ } }
  }

  function initials(name) {
    return String(name || 'KN').trim().split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase();
  }

  function arrayToBase64(array) {
    let raw = '';
    new Uint8Array(array).forEach(byte => { raw += String.fromCharCode(byte); });
    return window.btoa(raw);
  }

  function base64ToArray(base64) {
    const raw = window.atob(base64);
    return Uint8Array.from(raw, char => char.charCodeAt(0));
  }

  async function hashPassword(password, saltBase64) {
    const cryptoApi = window.crypto?.subtle;
    if (!cryptoApi) throw new Error('Web Crypto indisponible');
    const key = await cryptoApi.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
    const bits = await cryptoApi.deriveBits({ name: 'PBKDF2', salt: base64ToArray(saltBase64), iterations: 120000, hash: 'SHA-256' }, key, 256);
    return arrayToBase64(bits);
  }

  function createSalt() {
    const bytes = new Uint8Array(16);
    window.crypto.getRandomValues(bytes);
    return arrayToBase64(bytes);
  }

  function hydrateUserIdentity() {
    const user = getAuthenticatedUser() || PREVIEW_USER;
    $$('[data-user-name]').forEach(element => { element.textContent = user.username; });
    $$('[data-user-email]').forEach(element => { element.textContent = user.email; });
    $$('[data-user-role]').forEach(element => { element.textContent = user.role || 'Nexus Trader'; });
    $$('[data-user-avatar]').forEach(element => { element.textContent = initials(user.username); });
    $$('[data-user-id]').forEach(element => { element.textContent = user.id; });
  }

  function initAuthentication() {
    $('#login-form')?.addEventListener('submit', async event => {
      event.preventDefault();
      const email = $('#email').value.trim().toLowerCase();
      const password = $('#password').value;
      const remote = await apiRequest('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
      if (remote.ok && remote.body?.id) {
        cacheRemoteUser(remote.body); showToast(`Bienvenue, ${remote.body.username}.`);
        window.setTimeout(() => { window.location.href = 'dashboard.html'; }, 420); return;
      }
      if (remote.status && remote.status !== 404) { showToast(remote.body?.detail || 'E-mail ou mot de passe incorrect.'); return; }
      // Offline static-preview fallback.
      const user = getUsers().find(item => item.email.toLowerCase() === email);
      if (!user) { showToast('Aucun utilisateur ne correspond à cette adresse e-mail.'); return; }
      try {
        const candidate = await hashPassword(password, user.passwordSalt);
        if (candidate !== user.passwordHash) { showToast('Mot de passe incorrect.'); return; }
        setAuthenticatedUser(user); showToast(`Bienvenue, ${user.username}.`);
        window.setTimeout(() => { window.location.href = 'dashboard.html'; }, 420);
      } catch (_) { showToast('Impossible de vérifier ce mot de passe dans ce navigateur.'); }
    });

    $('#register-form')?.addEventListener('submit', async event => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      const username = String(form.get('username') || '').trim();
      const email = String(form.get('email') || '').trim().toLowerCase();
      const password = String(form.get('password') || '');
      const confirm = String(form.get('confirm') || '');
      if (username.length < 2) { showToast('Le pseudo doit comporter au moins 2 caractères.'); return; }
      if (password.length < 8) { showToast('Le mot de passe doit comporter au moins 8 caractères.'); return; }
      if (password !== confirm) { showToast('Les mots de passe ne correspondent pas.'); return; }
      const remote = await apiRequest('/api/auth/register', { method: 'POST', body: JSON.stringify({ username, email, password }) });
      if (remote.ok && remote.body?.id) {
        cacheRemoteUser(remote.body); showToast('Votre espace trader est créé.');
        window.setTimeout(() => { window.location.href = 'dashboard.html'; }, 480); return;
      }
      if (remote.status && remote.status !== 404) { showToast(remote.body?.detail || 'Création de compte impossible.'); return; }
      // Offline static-preview fallback.
      const users = getUsers();
      if (users.some(user => user.email.toLowerCase() === email)) { showToast('Cette adresse e-mail possède déjà un espace KN Nexus.'); return; }
      try {
        const passwordSalt = createSalt();
        const user = { id: `KN-${Date.now().toString(36).toUpperCase()}`, username, email, passwordSalt, passwordHash: await hashPassword(password, passwordSalt), role: 'Nexus Trader', createdAt: new Date().toISOString() };
        saveUsers([...users, user]); setAuthenticatedUser(user); showToast('Votre espace trader est créé.');
        window.setTimeout(() => { window.location.href = 'dashboard.html'; }, 480);
      } catch (_) { showToast('Création impossible : Web Crypto n’est pas disponible.'); }
    });
  }

  function initProfilePage() {
    const profileForm = $('#profile-form');
    if (!profileForm) return;
    let user = getAuthenticatedUser();
    const notice = $('#profile-preview-notice');
    const username = $('#profile-username');
    const email = $('#profile-email');
    const sessionState = $('#profile-session-state');
    const accountCount = $('#profile-account-count');
    accountCount.textContent = getTradingAccounts().length;
    if (!user) {
      notice?.classList.remove('hide');
      username.value = PREVIEW_USER.username;
      email.value = PREVIEW_USER.email;
      sessionState.textContent = 'Aperçu local';
    } else {
      username.value = user.username;
      email.value = user.email;
      sessionState.textContent = 'Connectée';
    }

    profileForm.addEventListener('submit', async event => {
      event.preventDefault();
      if (!user) { showToast('Créez un identifiant pour enregistrer votre profil.'); return; }
      const nextName = username.value.trim();
      const nextEmail = email.value.trim().toLowerCase();
      if (nextName.length < 2) { showToast('Le pseudo doit comporter au moins 2 caractères.'); return; }
      if (user._remote) {
        const remote = await apiRequest('/api/auth/profile', { method: 'PATCH', body: JSON.stringify({ username: nextName, email: nextEmail }) });
        if (!remote.ok) { showToast(remote.body?.detail || 'Mise à jour du profil impossible.'); return; }
        user = { ...remote.body, _remote: true }; cacheRemoteUser(remote.body); hydrateUserIdentity(); showToast('Profil mis à jour.'); return;
      }
      const users = getUsers();
      if (users.some(item => item.id !== user.id && item.email.toLowerCase() === nextEmail)) { showToast('Cette adresse e-mail est déjà utilisée.'); return; }
      user = { ...user, username: nextName, email: nextEmail };
      saveUsers(users.map(item => item.id === user.id ? user : item));
      hydrateUserIdentity();
      showToast('Profil mis à jour.');
    });

    $('#password-form')?.addEventListener('submit', async event => {
      event.preventDefault();
      if (!user) { showToast('Créez un identifiant pour définir un mot de passe.'); return; }
      const form = new FormData(event.currentTarget);
      const current = String(form.get('currentPassword') || '');
      const next = String(form.get('newPassword') || '');
      const confirm = String(form.get('confirmPassword') || '');
      if (next.length < 8) { showToast('Le nouveau mot de passe doit comporter au moins 8 caractères.'); return; }
      if (next !== confirm) { showToast('Les nouveaux mots de passe ne correspondent pas.'); return; }
      if (user._remote) {
        const remote = await apiRequest('/api/auth/password', { method: 'PATCH', body: JSON.stringify({ current_password: current, new_password: next }) });
        if (!remote.ok) { showToast(remote.body?.detail || 'Mise à jour du mot de passe impossible.'); return; }
        event.currentTarget.reset(); showToast('Mot de passe mis à jour.'); return;
      }
      try {
        if (await hashPassword(current, user.passwordSalt) !== user.passwordHash) { showToast('Mot de passe actuel incorrect.'); return; }
        const passwordSalt = createSalt();
        user = { ...user, passwordSalt, passwordHash: await hashPassword(next, passwordSalt) };
        saveUsers(getUsers().map(item => item.id === user.id ? user : item));
        event.currentTarget.reset();
        showToast('Mot de passe mis à jour.');
      } catch (_) { showToast('Mise à jour du mot de passe impossible.'); }
    });

    $('#logout-button')?.addEventListener('click', async () => {
      if (user?._remote) await apiRequest('/api/auth/logout', { method: 'POST' });
      try { window.localStorage.removeItem(USER_SESSION_KEY); window.localStorage.removeItem(REMOTE_USER_CACHE_KEY); } catch (_) { /* no action */ }
      showToast('Session fermée.');
      window.setTimeout(() => { window.location.href = 'login.html'; }, 350);
    });
  }

  function initRiskCalculator() {
    const form = $('#risk-calculator');
    if (!form) return;

    const instruments = {
      EURUSD: { asset: 'FOREX', name: 'EURUSD · Forex standard', info: '1 lot = 100 000 unités · 1 pip ≈ $10.00 / lot', scale: 10000, pointValue: 10, decimals: 5, unit: 'pips', preset: [1.08362, 1.08112, 1.08862], lotSuffix: 'lot', step: 0.01 },
      GBPUSD: { asset: 'FOREX', name: 'GBPUSD · Forex standard', info: '1 lot = 100 000 unités · 1 pip ≈ $10.00 / lot', scale: 10000, pointValue: 10, decimals: 5, unit: 'pips', preset: [1.27800, 1.27550, 1.28300], lotSuffix: 'lot', step: 0.01 },
      USDJPY: { asset: 'FOREX', name: 'USDJPY · Forex standard', info: '1 lot = 100 000 unités · valeur du pip USD indicative, dépend du taux de conversion', scale: 100, pointValue: 6.4, decimals: 3, unit: 'pips', preset: [156.200, 155.900, 156.800], lotSuffix: 'lot', step: 0.01 },
      XAUUSD: { asset: 'MÉTAL', name: 'XAUUSD · Or spot', info: '1 lot = 100 oz · $0.01 = $1.00 / lot', scale: 100, pointValue: 1, decimals: 2, unit: 'points', preset: [4195.20, 4190.20, 4205.20], lotSuffix: 'lot', step: 0.01 },
      NAS100: { asset: 'INDICE', name: 'NAS100 · CFD indice', info: '1 lot = $1.00 par point · Paramètre broker standard', scale: 1, pointValue: 1, decimals: 2, unit: 'points', preset: [18465.24, 18415.24, 18565.24], lotSuffix: 'lot', step: 0.1 },
      US30: { asset: 'INDICE', name: 'US30 · CFD indice', info: '1 lot = $1.00 par point · à confirmer selon votre broker', scale: 1, pointValue: 1, decimals: 2, unit: 'points', preset: [42000.00, 41900.00, 42200.00], lotSuffix: 'lot', step: 0.1 },
      BTCUSD: { asset: 'CRYPTO', name: 'BTCUSD · Spot CFD', info: '1 unité = 1 BTC · $1.00 de mouvement = $1 / BTC', scale: 1, pointValue: 1, decimals: 2, unit: '$', preset: [68491.30, 67991.30, 69491.30], lotSuffix: 'BTC', step: 0.001 },
      USOIL: { asset: 'ÉNERGIE', name: 'USOIL · WTI CFD', info: '1 lot = 1 000 barils · $0.01 = $10.00 / lot', scale: 100, pointValue: 10, decimals: 2, unit: 'points', preset: [74.80, 74.30, 75.80], lotSuffix: 'lot', step: 0.01 }
    };

    const account = $('#account');
    const symbol = $('#symbol');
    const riskInput = $('#risk');
    const entry = $('#entry');
    const stop = $('#stop');
    const target = $('#target');
    const riskAffix = $('#risk-affix');
    let riskMode = 'percent';

    // Accounts are shared with the account manager through browser local storage.
    function populateAccounts() {
      const previousValue = account.value;
      const accounts = getTradingAccounts();
      account.innerHTML = accounts.map(item => `<option value="${Number(item.currentBalance) || 0}">${escapeHtml(item.name)} · ${formatAccountMoney(item.currentBalance)}</option>`).join('');
      if ([...account.options].some(option => option.value === previousValue)) account.value = previousValue;
    }
    populateAccounts();

    const number = (value, decimals = 2) => Number(value || 0).toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
    const money = value => `$${number(value)}`;
    const roundToStep = (value, step) => Math.floor(value / step) * step;

    function calculate() {
      const config = instruments[symbol.value];
      const balance = Number(account.value) || 0;
      const riskValue = Math.max(0, Number(riskInput.value) || 0);
      const allowedRisk = riskMode === 'percent' ? balance * riskValue / 100 : riskValue;
      const stopDistance = Math.abs(Number(entry.value) - Number(stop.value));
      const targetDistance = Math.abs(Number(target.value) - Number(entry.value));
      const points = stopDistance * config.scale;
      const targetPoints = targetDistance * config.scale;
      const position = points ? roundToStep(allowedRisk / (points * config.pointValue), config.step) : 0;
      const potential = position * targetPoints * config.pointValue;
      const ratio = stopDistance ? targetDistance / stopDistance : 0;
      const lots = position < 1 ? position.toFixed(config.step < 0.01 ? 3 : 2) : position.toFixed(2);

      $('#lot-size').textContent = `${lots} ${config.lotSuffix}`;
      $('#unit-label').textContent = 'Taille de position recommandée';
      $('#risk-amount').textContent = money(allowedRisk);
      $('#stop-distance').textContent = `${number(points, points < 10 ? 1 : 0)} ${config.unit}`;
      $('#potential-gain').textContent = money(potential);
      $('#rr-ratio').textContent = `1 : ${number(ratio)}`;
      $('#asset-pill').textContent = config.asset;
      $('#instrument-name').textContent = config.name;
      $('#instrument-info').textContent = config.info;
      $('#risk-percent-display').textContent = `${number(balance ? allowedRisk / balance * 100 : 0)}%`;
    }

    $$('[data-segment]').forEach(segment => {
      $$('button', segment).forEach(button => button.addEventListener('click', () => {
        $$('button', segment).forEach(item => item.classList.remove('active'));
        button.classList.add('active');
        if (segment.dataset.segment === 'risk-mode') {
          riskMode = button.dataset.value;
          riskAffix.textContent = riskMode === 'percent' ? '%' : 'USD';
          riskInput.value = riskMode === 'percent' ? '0.5' : '500';
        }
        calculate();
      }));
    });

    [account, riskInput, entry, stop, target].forEach(field => { field?.addEventListener('input', calculate); field?.addEventListener('change', calculate); });
    symbol.addEventListener('change', () => {
      const config = instruments[symbol.value];
      [entry.value, stop.value, target.value] = config.preset;
      calculate();
    });
    form.addEventListener('submit', event => { event.preventDefault(); calculate(); showToast('Position mise à jour avec les paramètres actuels.'); });
    calculate();
  }

  const ACCOUNTS_STORAGE_KEY = 'kn-nexus-trading-accounts-v1';

  function defaultTradingAccounts() {
    return [
      { id: 'ftmo-100k', name: 'FTMO 100K', broker: 'FTMO', type: 'Financé', initialCapital: 100000, currentBalance: 100000, currency: 'USD', leverage: '1:100', dailyDrawdown: 5, totalDrawdown: 10 },
      { id: 'blueberry-25k', name: 'Blueberry Funded', broker: 'Blueberry Markets', type: 'Financé', initialCapital: 25000, currentBalance: 25180, currency: 'USD', leverage: '1:30', dailyDrawdown: 5, totalDrawdown: 10 },
      { id: 'personal-18k', name: 'Compte personnel', broker: 'IC Markets', type: 'Réel', initialCapital: 18000, currentBalance: 18400, currency: 'USD', leverage: '1:100', dailyDrawdown: 0, totalDrawdown: 0 }
    ];
  }

  function getTradingAccounts() {
    try {
      const saved = window.localStorage.getItem(ACCOUNTS_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length) return parsed;
      }
      const initial = defaultTradingAccounts();
      window.localStorage.setItem(ACCOUNTS_STORAGE_KEY, JSON.stringify(initial));
      return initial;
    } catch (_) {
      return defaultTradingAccounts();
    }
  }

  function setTradingAccounts(accounts) {
    try { window.localStorage.setItem(ACCOUNTS_STORAGE_KEY, JSON.stringify(accounts)); } catch (_) { /* storage fallback */ }
  }

  function formatAccountMoney(value) {
    return `$${Number(value || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[char]));
  }

  function initAccountsPanel() {
    const body = $('#accounts-body');
    if (!body) return;
    const render = () => {
      const accounts = getTradingAccounts();
      const initial = accounts.reduce((sum, item) => sum + Number(item.initialCapital || 0), 0);
      const balance = accounts.reduce((sum, item) => sum + Number(item.currentBalance || 0), 0);
      const pnl = balance - initial;
      $('#accounts-count').textContent = accounts.length;
      $('#accounts-capital').textContent = formatAccountMoney(initial);
      $('#accounts-balance').textContent = formatAccountMoney(balance);
      const pnlTarget = $('#accounts-pnl');
      pnlTarget.textContent = `${pnl >= 0 ? '+' : '−'}${formatAccountMoney(Math.abs(pnl))}`;
      pnlTarget.style.color = pnl >= 0 ? 'var(--green)' : 'var(--red)';
      body.innerHTML = accounts.map(item => `<tr>
        <td><div class="table-account"><span class="broker-mark">${escapeHtml(item.name).slice(0, 2).toUpperCase()}</span><div><b>${escapeHtml(item.name)}</b><small>${escapeHtml(item.broker || 'Broker non renseigné')} · ${escapeHtml(item.currency || 'USD')}</small></div></div></td>
        <td><span class="account-tag">${escapeHtml(item.type || 'Réel')}</span></td>
        <td>${formatAccountMoney(item.initialCapital)}</td>
        <td><b style="color:var(--ink)">${formatAccountMoney(item.currentBalance)}</b></td>
        <td>${escapeHtml(item.leverage || '—')}</td>
        <td>${Number(item.dailyDrawdown || 0) ? `−${Number(item.dailyDrawdown)}%` : '—'}</td>
        <td>${Number(item.totalDrawdown || 0) ? `−${Number(item.totalDrawdown)}%` : '—'}</td>
        <td><button class="account-action" data-account-delete="${escapeHtml(item.id)}">Supprimer</button></td>
      </tr>`).join('');
      $$('[data-account-delete]', body).forEach(button => button.addEventListener('click', () => {
        const accountsLeft = getTradingAccounts().filter(item => item.id !== button.dataset.accountDelete);
        if (!accountsLeft.length) { showToast('Conservez au moins un compte pour le calculateur.'); return; }
        setTradingAccounts(accountsLeft);
        render();
        showToast('Compte supprimé du workspace.');
      }));
    };

    const open = () => openAccountModal(render);
    $('#add-account')?.addEventListener('click', open);
    $('#add-account-secondary')?.addEventListener('click', open);
    render();
  }

  function openAccountModal(onSaved) {
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML = `<form class="modal modal-form" id="account-form">
      <div class="modal-form-header"><div><h2>Ajouter un compte de trading</h2><p>Le compte sera disponible dans le calculateur dès l’enregistrement.</p></div><button type="button" class="modal-close" aria-label="Fermer">×</button></div>
      <div class="account-form-body">
        <div class="form-divider">Identification</div>
        <div class="form-grid"><div class="field"><label for="acc-name">Nom du compte *</label><input id="acc-name" name="name" required placeholder="Ex. FTMO Swing 50K"></div><div class="field"><label for="acc-broker">Broker / Prop Firm</label><input id="acc-broker" name="broker" placeholder="Ex. FTMO"></div><div class="field"><label for="acc-type">Type de compte</label><select id="acc-type" name="type"><option>Évaluation</option><option>Financé</option><option>Démo</option><option selected>Réel</option></select></div><div class="field"><label for="acc-currency">Devise</label><select id="acc-currency" name="currency"><option selected>USD</option><option>EUR</option><option>GBP</option><option>MAD</option></select></div></div>
        <div class="form-divider">Capital & règles</div>
        <div class="form-grid"><div class="field"><label for="acc-initial">Capital initial *</label><div class="input-wrap"><input id="acc-initial" name="initialCapital" type="number" min="0" step="0.01" required placeholder="100000"><span class="affix">USD</span></div></div><div class="field"><label for="acc-balance">Solde actuel *</label><div class="input-wrap"><input id="acc-balance" name="currentBalance" type="number" min="0" step="0.01" required placeholder="100000"><span class="affix">USD</span></div></div><div class="field"><label for="acc-leverage">Levier</label><select id="acc-leverage" name="leverage"><option>1:30</option><option>1:50</option><option selected>1:100</option><option>1:200</option><option>1:500</option></select></div><div class="field"><label for="acc-dd-day">Drawdown journalier max.</label><div class="input-wrap"><input id="acc-dd-day" name="dailyDrawdown" type="number" min="0" step="0.1" value="5"><span class="affix">%</span></div></div><div class="field"><label for="acc-dd-total">Drawdown total max.</label><div class="input-wrap"><input id="acc-dd-total" name="totalDrawdown" type="number" min="0" step="0.1" value="10"><span class="affix">%</span></div></div></div>
      </div><div class="account-form-footer"><button type="button" class="btn btn-ghost modal-cancel">Annuler</button><button class="btn btn-primary" type="submit">Enregistrer le compte <span>→</span></button></div>
    </form>`;
    document.body.append(backdrop);
    const close = () => backdrop.remove();
    $('.modal-close', backdrop).addEventListener('click', close);
    $('.modal-cancel', backdrop).addEventListener('click', close);
    backdrop.addEventListener('click', event => { if (event.target === backdrop) close(); });
    $('#account-form', backdrop).addEventListener('submit', event => {
      event.preventDefault();
      const values = Object.fromEntries(new FormData(event.currentTarget));
      const account = {
        id: `account-${Date.now()}`,
        name: values.name.trim(), broker: values.broker.trim(), type: values.type, currency: values.currency,
        initialCapital: Number(values.initialCapital), currentBalance: Number(values.currentBalance), leverage: values.leverage,
        dailyDrawdown: Number(values.dailyDrawdown), totalDrawdown: Number(values.totalDrawdown)
      };
      setTradingAccounts([...getTradingAccounts(), account]);
      close();
      onSaved();
      showToast(`${account.name} a été ajouté au calculateur.`);
    });
  }

  const SETUPS_STORAGE_KEY = 'kn-nexus-playbook-setups-v1';
  const TRADES_STORAGE_KEY = 'kn-nexus-journal-trades-v1';

  function getUserSetups() {
    try {
      const setups = JSON.parse(window.localStorage.getItem(SETUPS_STORAGE_KEY));
      return Array.isArray(setups) ? setups : [];
    } catch (_) { return []; }
  }

  function setUserSetups(setups) {
    try { window.localStorage.setItem(SETUPS_STORAGE_KEY, JSON.stringify(setups)); } catch (_) { /* browser storage unavailable */ }
  }

  function getUserTrades() {
    try {
      const trades = JSON.parse(window.localStorage.getItem(TRADES_STORAGE_KEY));
      return Array.isArray(trades) ? trades : [];
    } catch (_) { return []; }
  }

  function setUserTrades(trades) {
    try { window.localStorage.setItem(TRADES_STORAGE_KEY, JSON.stringify(trades)); } catch (_) { /* browser storage unavailable */ }
  }

  function initPlaybook() {
    const grid = $('#setup-grid');
    if (!grid) return;
    const search = $('#setup-search');
    const count = $('#setup-all-tab');
    let query = '';

    const render = () => {
      const setups = getUserSetups();
      if (count) count.textContent = `Tous · ${setups.length}`;
      const filtered = setups.filter(setup => `${setup.title} ${setup.assetClass} ${setup.timeframe} ${(setup.rules || []).join(' ')}`.toLowerCase().includes(query));
      if (!filtered.length) {
        grid.innerHTML = `<div class="playbook-empty"><div class="empty-symbol">▣</div><h3>${setups.length ? 'Aucun setup ne correspond à votre recherche.' : 'Votre playbook est vide.'}</h3><p>${setups.length ? 'Modifiez votre recherche ou vos filtres.' : 'Créez votre premier setup personnel : il sera ensuite disponible dans le journal de trading.'}</p><button class="btn btn-primary" data-open-setup>${setups.length ? 'Créer un setup' : '+ Créer mon premier setup'}</button></div>`;
      } else {
        grid.innerHTML = filtered.map(setup => `<article class="setup-card" data-setup-id="${escapeHtml(setup.id)}"><div class="setup-visual"><span class="setup-type">${escapeHtml(setup.assetClass || 'MARCHÉ')} · ${escapeHtml(setup.timeframe || '—')}</span></div><div class="setup-card-body"><div class="setup-card-title">${escapeHtml(setup.title)}</div><div class="setup-meta"><span>${escapeHtml(setup.assetClass || 'Multi-actifs')}</span><span>•</span><span>${escapeHtml(setup.timeframe || 'À définir')}</span></div><div class="setup-rules">${(setup.rules || []).slice(0,3).map(rule => `<div class="setup-rule">${escapeHtml(rule)}</div>`).join('') || '<div class="setup-rule">Aucune règle ajoutée</div>'}</div><div class="setup-footer"><span>${(setup.rules || []).length} règle(s)</span><button class="setup-delete" data-delete-setup="${escapeHtml(setup.id)}">Supprimer</button></div></div></article>`).join('');
      }
      $$('[data-open-setup]', grid).forEach(button => button.addEventListener('click', openSetup));
      $$('[data-delete-setup]', grid).forEach(button => button.addEventListener('click', () => {
        const setup = getUserSetups().find(item => item.id === button.dataset.deleteSetup);
        if (!setup || !window.confirm(`Supprimer le setup « ${setup.title} » ? Les trades historiques resteront visibles.`)) return;
        setUserSetups(getUserSetups().filter(item => item.id !== setup.id));
        render();
        showToast('Setup supprimé du playbook.');
      }));
    };

    const openSetup = () => openSetupModal(() => { render(); });
    $('#add-setup')?.addEventListener('click', openSetup);
    search?.addEventListener('input', () => { query = search.value.trim().toLowerCase(); render(); });
    render();
  }

  function openSetupModal(onSaved) {
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML = `<form class="modal modal-form" id="setup-form"><div class="modal-form-header"><div><h2>Créer un setup</h2><p>Définissez votre modèle ; il sera proposé dans le journal à chaque nouveau trade.</p></div><button type="button" class="modal-close" aria-label="Fermer">×</button></div><div class="account-form-body"><div class="form-grid"><div class="field"><label for="setup-title">Nom du setup *</label><input id="setup-title" name="title" required placeholder="Ex. Sweep Londres + FVG"></div><div class="field"><label for="setup-asset">Classe d’actif</label><select id="setup-asset" name="assetClass"><option>Forex</option><option>Métaux</option><option>Indices</option><option>Crypto</option><option>Énergies</option><option>Multi-actifs</option></select></div><div class="field"><label for="setup-timeframe">Timeframe principal</label><select id="setup-timeframe" name="timeframe"><option>M1</option><option>M5</option><option selected>M15</option><option>H1</option><option>H4</option><option>D1</option><option>W1</option></select></div></div><div class="form-divider">Checklist de règles</div><div class="field"><label for="setup-rules">Une règle par ligne</label><textarea id="setup-rules" name="rules" placeholder="Ex. Liquidité externe balayée\nEx. Confirmation de structure M5\nEx. Risque maximum de 1 %"></textarea></div></div><div class="account-form-footer"><button type="button" class="btn btn-ghost modal-cancel">Annuler</button><button type="submit" class="btn btn-primary">Enregistrer le setup <span>→</span></button></div></form>`;
    document.body.append(backdrop);
    const close = () => backdrop.remove();
    $('.modal-close', backdrop).addEventListener('click', close);
    $('.modal-cancel', backdrop).addEventListener('click', close);
    backdrop.addEventListener('click', event => { if (event.target === backdrop) close(); });
    $('#setup-form', backdrop).addEventListener('submit', event => {
      event.preventDefault();
      const values = Object.fromEntries(new FormData(event.currentTarget));
      const setup = { id: `setup-${Date.now()}`, title: values.title.trim(), assetClass: values.assetClass, timeframe: values.timeframe, rules: String(values.rules || '').split('\n').map(rule => rule.trim()).filter(Boolean), createdAt: new Date().toISOString() };
      setUserSetups([...getUserSetups(), setup]);
      close();
      onSaved();
      showToast(`${setup.title} est disponible dans votre journal.`);
    });
  }

  function initSearch(inputSelector, targetsSelector) {
    const input = $(inputSelector);
    if (!input) return;
    const targets = $$(targetsSelector);
    input.addEventListener('input', () => {
      const query = input.value.trim().toLowerCase();
      targets.forEach(target => {
        const searchable = `${target.textContent} ${target.dataset.search || ''}`.toLowerCase();
        target.style.display = searchable.includes(query) ? '' : 'none';
      });
    });
  }

  function initLightbox() {
    document.addEventListener('click', event => {
      const thumb = event.target.closest('[data-lightbox]');
      if (!thumb) return;
      openLightbox(thumb.dataset.lightbox);
    });
  }

  function openLightbox(title) {
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML = `<div class="modal" role="dialog" aria-modal="true"><div class="modal-visual"></div><div class="modal-content"><div><b>${escapeHtml(title)}</b><span>Visionneuse comparative · les fichiers importés seront reliés au trade via FastAPI.</span></div><button class="modal-close" aria-label="Fermer">×</button></div></div>`;
    document.body.append(backdrop);
    const close = () => backdrop.remove();
    $('.modal-close', backdrop).addEventListener('click', close);
    backdrop.addEventListener('click', event => { if (event.target === backdrop) close(); });
    document.addEventListener('keydown', function esc(event) { if (event.key === 'Escape') { close(); document.removeEventListener('keydown', esc); } });
  }

  function initJournalWorkspace() {
    const accountFilter = $('#journal-account-filter');
    if (!accountFilter) return;
    const search = $('#trade-search');
    const gallery = $('#screenshot-gallery');
    const upload = $('#screenshot-upload');
    const type = $('#screenshot-type');
    const tradesBody = $('#trades-body');
    const setupBody = $('#setup-performance-body');
    let shotFilter = 'all';

    const populateAccounts = () => {
      const previous = accountFilter.value || 'all';
      const accounts = getTradingAccounts();
      accountFilter.innerHTML = `<option value="all">Tous les comptes</option>${accounts.map(item => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}</option>`).join('')}`;
      accountFilter.value = [...accountFilter.options].some(option => option.value === previous) ? previous : 'all';
    };
    const accountName = id => getTradingAccounts().find(item => item.id === id)?.name || 'Compte supprimé';

    function render() {
      populateAccounts();
      const setups = getUserSetups();
      const trades = getUserTrades().sort((a,b) => new Date(b.timestamp) - new Date(a.timestamp));
      const query = (search?.value || '').trim().toLowerCase();
      const selectedAccount = accountFilter.value;
      const chartTrades = trades.filter(trade => selectedAccount === 'all' || trade.accountId === selectedAccount);
      const visibleTrades = chartTrades.filter(trade => {
        const haystack = `${trade.symbol} ${trade.setupTitle} ${trade.accountName} ${trade.direction}`.toLowerCase();
        return haystack.includes(query);
      });
      if (!visibleTrades.length) {
        tradesBody.innerHTML = `<tr><td colspan="9"><div class="table-empty">${trades.length ? 'Aucun trade ne correspond au compte ou à la recherche sélectionnée.' : 'Votre journal est vide. Créez un setup, puis ajoutez votre premier trade.'}</div></td></tr>`;
      } else {
        tradesBody.innerHTML = visibleTrades.map(trade => `<tr data-account="${escapeHtml(trade.accountId)}" data-search="${escapeHtml(`${trade.symbol} ${trade.setupTitle} ${trade.accountName}`)}"><td>${formatTradeDate(trade.timestamp)}</td><td><span class="symbol">${escapeHtml(trade.symbol)}</span><br><small class="muted">${escapeHtml(trade.lot || '—')} lot</small></td><td><span class="dir ${String(trade.direction).toLowerCase()}">${escapeHtml(trade.direction)}</span></td><td><span class="setup-tag">${escapeHtml(trade.setupTitle)}</span></td><td><span class="account-tag">${escapeHtml(trade.accountName)}</span></td><td>1 : ${Number(trade.rr || 0).toFixed(2)}</td><td><span class="pnl ${Number(trade.pnl) >= 0 ? 'positive' : 'negative'}">${Number(trade.pnl) >= 0 ? '+' : '−'}$${Math.abs(Number(trade.pnl || 0)).toFixed(2)}</span></td><td><span class="thumb" data-lightbox="${escapeHtml(`${trade.symbol} · ${trade.setupTitle}`)}"></span></td><td><span class="score">—</span></td></tr>`).join('');
      }
      renderJournalStats(trades, setups);
      renderSetupPerformance(trades, setups, setupBody);
      renderPnlChart(chartTrades);
      applyScreenshotFilters();
    }

    function renderJournalStats(trades, setups) {
      const pnl = trades.reduce((sum, trade) => sum + Number(trade.pnl || 0), 0);
      const wins = trades.filter(trade => Number(trade.pnl) > 0).length;
      const winRate = trades.length ? wins / trades.length * 100 : 0;
      const performance = buildSetupPerformance(trades, setups);
      const best = performance.filter(item => item.trades).sort((a,b) => b.pnl - a.pnl)[0];
      $('#journal-trade-count').textContent = trades.length;
      $('#journal-trade-caption').textContent = trades.length ? `${wins} gain(s) · ${trades.length - wins} perte(s)` : 'Ajoutez votre premier trade';
      $('#journal-win-rate').textContent = trades.length ? `${winRate.toFixed(1)}%` : '—';
      $('#journal-win-caption').textContent = trades.length ? `${wins} trade(s) gagnant(s)` : 'Aucun trade clôturé';
      $('#journal-pnl').textContent = `${pnl >= 0 ? '+' : '−'}$${Math.abs(pnl).toFixed(2)}`;
      $('#journal-pnl').style.color = pnl >= 0 ? 'var(--green)' : 'var(--red)';
      $('#journal-best-setup').textContent = best ? best.title : '—';
      $('#journal-best-caption').textContent = best ? `${best.pnl >= 0 ? '+' : '−'}$${Math.abs(best.pnl).toFixed(2)} · ${best.wins} gain(s) / ${best.losses} perte(s)` : 'Créez un setup puis enregistrez vos résultats';
    }

    function buildSetupPerformance(trades, setups) {
      const list = setups.map(setup => ({ id: setup.id, title: setup.title, trades: 0, wins: 0, losses: 0, pnl: 0, rrTotal: 0 }));
      trades.forEach(trade => {
        let row = list.find(item => item.id === trade.setupId);
        if (!row) { row = { id: trade.setupId, title: trade.setupTitle || 'Setup supprimé', trades: 0, wins: 0, losses: 0, pnl: 0, rrTotal: 0 }; list.push(row); }
        row.trades += 1; row.pnl += Number(trade.pnl || 0); row.rrTotal += Number(trade.rr || 0);
        if (Number(trade.pnl) > 0) row.wins += 1; else if (Number(trade.pnl) < 0) row.losses += 1;
      });
      return list;
    }

    function renderSetupPerformance(trades, setups, body) {
      const rows = buildSetupPerformance(trades, setups);
      if (!rows.length) { body.innerHTML = '<tr><td colspan="7"><div class="table-empty">Créez votre premier setup : vos statistiques de gains et pertes apparaîtront ici.</div></td></tr>'; return; }
      body.innerHTML = rows.sort((a,b) => b.pnl-a.pnl).map(item => `<tr><td><span class="symbol">${escapeHtml(item.title)}</span></td><td>${item.trades}</td><td><span class="pnl positive">${item.wins}</span></td><td><span class="pnl negative">${item.losses}</span></td><td>${item.trades ? (item.wins / item.trades * 100).toFixed(1) : '0.0'}%</td><td><span class="pnl ${item.pnl >= 0 ? 'positive' : 'negative'}">${item.pnl >= 0 ? '+' : '−'}$${Math.abs(item.pnl).toFixed(2)}</span></td><td>1 : ${item.trades ? (item.rrTotal / item.trades).toFixed(2) : '0.00'}</td></tr>`).join('');
    }

    function applyScreenshotFilters() {
      const selectedAccount = accountFilter.value;
      $$('.screenshot-card', gallery).forEach(card => {
        const matchesAccount = selectedAccount === 'all' || card.dataset.account === selectedAccount;
        const matchesType = shotFilter === 'all' || card.dataset.shotType === shotFilter;
        card.style.display = matchesAccount && matchesType ? '' : 'none';
      });
    }

    accountFilter.addEventListener('change', render);
    search?.addEventListener('input', render);
    $$('[data-shot-filter]', $('#screenshot-filter')).forEach(button => button.addEventListener('click', () => {
      shotFilter = button.dataset.shotFilter;
      $$('[data-shot-filter]', $('#screenshot-filter')).forEach(item => item.classList.remove('active'));
      button.classList.add('active');
      applyScreenshotFilters();
    }));
    $('#add-trade')?.addEventListener('click', () => {
      if (!getUserSetups().length) { showToast('Créez d’abord un setup dans votre playbook.'); window.setTimeout(() => { window.location.href = 'playbook.html'; }, 700); return; }
      openTradeModal(render);
    });
    upload?.addEventListener('change', event => {
      const file = event.target.files?.[0];
      if (!file) return;
      if (!file.type.startsWith('image/')) { showToast('Choisissez une image PNG, JPEG ou WebP.'); return; }
      const accountId = accountFilter.value === 'all' ? getTradingAccounts()[0]?.id : accountFilter.value;
      const typeLabel = type.value === 'before' ? 'Avant l’entrée' : 'Après clôture';
      const url = URL.createObjectURL(file);
      $('.gallery-empty', gallery)?.remove();
      const card = document.createElement('article');
      card.className = 'screenshot-card user-upload'; card.dataset.shotType = type.value; card.dataset.account = accountId;
      card.innerHTML = `<button class="screenshot-visual uploaded" data-lightbox="${escapeHtml(file.name)}" style="background-image:linear-gradient(rgba(6,11,20,.08),rgba(6,11,20,.42)),url('${url}')"><span>${escapeHtml(accountName(accountId))}</span><i>${typeLabel.toUpperCase()}</i></button><div><b>${escapeHtml(file.name)}</b><small>${typeLabel} · ${escapeHtml(accountName(accountId))}</small></div>`;
      gallery.prepend(card); upload.value = ''; applyScreenshotFilters(); showToast('Capture ajoutée à la session du journal.');
    });
    render();
  }

  function openTradeModal(onSaved) {
    const accounts = getTradingAccounts();
    const setups = getUserSetups();
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    const now = new Date().toISOString().slice(0,16);
    backdrop.innerHTML = `<form class="modal modal-form" id="trade-form"><div class="modal-form-header"><div><h2>Ajouter un trade</h2><p>Associez obligatoirement l’exécution à l’un de vos setups.</p></div><button type="button" class="modal-close" aria-label="Fermer">×</button></div><div class="account-form-body"><div class="form-divider">Contexte</div><div class="form-grid"><div class="field"><label for="trade-account">Compte</label><select id="trade-account" name="accountId">${accounts.map(item => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}</option>`).join('')}</select></div><div class="field"><label for="trade-setup">Type de setup *</label><select id="trade-setup" name="setupId">${setups.map(item => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.title)}</option>`).join('')}</select></div><div class="field"><label for="trade-symbol">Marché / symbole *</label><input id="trade-symbol" name="symbol" required placeholder="Ex. XAUUSD"></div><div class="field"><label for="trade-direction">Direction</label><select id="trade-direction" name="direction"><option>BUY</option><option>SELL</option></select></div></div><div class="form-divider">Résultat</div><div class="form-grid three"><div class="field"><label for="trade-entry">Entrée</label><input id="trade-entry" name="entry" type="number" step="any" placeholder="4195.20"></div><div class="field"><label for="trade-stop">Stop Loss</label><input id="trade-stop" name="stop" type="number" step="any" placeholder="4190.20"></div><div class="field"><label for="trade-target">Take Profit</label><input id="trade-target" name="target" type="number" step="any" placeholder="4205.20"></div><div class="field"><label for="trade-lot">Lot / taille</label><input id="trade-lot" name="lot" type="number" step="any" placeholder="0.20"></div><div class="field"><label for="trade-pnl">PnL réalisé *</label><input id="trade-pnl" name="pnl" type="number" step="0.01" required placeholder="Ex. 320 ou -120"></div><div class="field"><label for="trade-time">Date / heure</label><input id="trade-time" name="timestamp" type="datetime-local" value="${now}"></div></div><div class="field" style="margin-top:13px"><label for="trade-notes">Note de revue</label><textarea id="trade-notes" name="notes" placeholder="Pourquoi cette exécution respecte ou non votre plan ?"></textarea></div></div><div class="account-form-footer"><button type="button" class="btn btn-ghost modal-cancel">Annuler</button><button class="btn btn-primary" type="submit">Enregistrer le trade <span>→</span></button></div></form>`;
    document.body.append(backdrop);
    const close = () => backdrop.remove();
    $('.modal-close', backdrop).addEventListener('click', close); $('.modal-cancel', backdrop).addEventListener('click', close);
    backdrop.addEventListener('click', event => { if (event.target === backdrop) close(); });
    $('#trade-form', backdrop).addEventListener('submit', event => {
      event.preventDefault();
      const values = Object.fromEntries(new FormData(event.currentTarget));
      const account = accounts.find(item => item.id === values.accountId);
      const setup = setups.find(item => item.id === values.setupId);
      const entry = Number(values.entry), stop = Number(values.stop), target = Number(values.target);
      const rr = entry && stop && target ? Math.abs(target-entry) / Math.abs(entry-stop) : 0;
      const trade = { id: `trade-${Date.now()}`, accountId: values.accountId, accountName: account?.name || 'Compte', setupId: values.setupId, setupTitle: setup?.title || 'Setup', symbol: values.symbol.trim().toUpperCase(), direction: values.direction, entry, stop, target, lot: values.lot, pnl: Number(values.pnl), rr, notes: values.notes.trim(), timestamp: values.timestamp ? new Date(values.timestamp).toISOString() : new Date().toISOString() };
      setUserTrades([...getUserTrades(), trade]); close(); onSaved(); showToast(`Trade ${trade.symbol} enregistré pour le setup « ${trade.setupTitle} » .`);
    });
  }

  function formatTradeDate(value) {
    try { return new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(value)); } catch (_) { return '—'; }
  }

  function renderPnlChart(trades) {
    const line = $('#journal-pnl-line');
    const area = $('#journal-pnl-area');
    const pointsLayer = $('#journal-pnl-points');
    const totalNode = $('#journal-chart-total');
    const empty = $('#journal-pnl-empty');
    const axis = $('#journal-pnl-axis');
    if (!line || !area || !pointsLayer || !totalNode || !empty || !axis) return;
    const ordered = [...trades].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    const total = ordered.reduce((sum, trade) => sum + Number(trade.pnl || 0), 0);
    totalNode.textContent = `${total >= 0 ? '+' : '−'}$${Math.abs(total).toFixed(2)}`;
    totalNode.style.color = total >= 0 ? 'var(--green)' : 'var(--red)';
    if (!ordered.length) {
      line.setAttribute('d', 'M 0 112.5 L 900 112.5');
      line.setAttribute('stroke', '#60708d'); line.setAttribute('stroke-width', '1.5'); line.setAttribute('stroke-dasharray', '5 7'); line.setAttribute('fill', 'none');
      area.setAttribute('d', ''); pointsLayer.innerHTML = ''; empty.classList.remove('hide');
      axis.innerHTML = '<span>Début</span><span>Ajoutez des trades pour faire évoluer la courbe</span><span>Aujourd’hui</span>';
      return;
    }
    empty.classList.add('hide');
    const cumulative = [0];
    ordered.forEach(trade => cumulative.push(cumulative[cumulative.length - 1] + Number(trade.pnl || 0)));
    let min = Math.min(...cumulative), max = Math.max(...cumulative);
    const padding = Math.max((max - min) * 0.18, 20);
    min -= padding; max += padding;
    const width = 900, top = 15, bottom = 202, height = bottom - top;
    const pointFor = (value, index) => ({ x: index / (cumulative.length - 1 || 1) * width, y: top + (max - value) / (max - min || 1) * height });
    const coordinates = cumulative.map(pointFor);
    const path = coordinates.map((point, index) => `${index ? 'L' : 'M'} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(' ');
    const color = total >= 0 ? '#39e6d2' : '#ff6687';
    const areaColor = total >= 0 ? 'rgba(57,230,210,.17)' : 'rgba(255,102,135,.16)';
    line.setAttribute('d', path); line.setAttribute('stroke', color); line.setAttribute('stroke-width', '2.4'); line.setAttribute('stroke-dasharray', ''); line.setAttribute('fill', 'none');
    area.setAttribute('d', `${path} L ${coordinates.at(-1).x.toFixed(2)} ${bottom} L 0 ${bottom} Z`); area.setAttribute('fill', areaColor);
    pointsLayer.innerHTML = coordinates.slice(1).map((point, index) => `<circle cx="${point.x.toFixed(2)}" cy="${point.y.toFixed(2)}" r="${index === coordinates.length - 2 ? 4 : 2.4}" fill="${color}" stroke="#e6fffb" stroke-width="${index === coordinates.length - 2 ? 1.8 : 0}"><title>${formatTradeDate(ordered[index].timestamp)} · ${ordered[index].pnl >= 0 ? '+' : '−'}$${Math.abs(Number(ordered[index].pnl)).toFixed(2)}</title></circle>`).join('');
    axis.innerHTML = `<span>${formatTradeDate(ordered[0].timestamp)}</span><span>${ordered.length} trade${ordered.length > 1 ? 's' : ''} clôturé${ordered.length > 1 ? 's' : ''}</span><span>${formatTradeDate(ordered.at(-1).timestamp)}</span>`;
  }

  function initMarketRegimes() {
    const grid = $('#regime-grid');
    const marketSelect = $('#regime-market-select');
    if (!grid || !marketSelect) return;
    const demo = {
      daily: [
        { asset: 'DXY', label: 'Dollar américain', regime: 'Expansion haussière', tone: 'bull', force: 72, macro: 'Données US à venir : prime de volatilité et positionnement défensif.', technical: 'Structure HH/HL ; prix au-dessus des moyennes 20 et 50 périodes.' },
        { asset: 'EURUSD', label: 'Euro / Dollar', regime: 'Pression baissière modérée', tone: 'caution', force: 63, macro: 'Écart de dynamique Europe / États-Unis favorable au dollar dans ce scénario de démonstration.', technical: 'Sous la résistance intraday ; succession de sommets descendants.' },
        { asset: 'GBPUSD', label: 'Livre / Dollar', regime: 'Range volatil', tone: 'neutral', force: 53, macro: 'La sensibilité aux données britanniques et au dollar américain maintient une volatilité élevée.', technical: 'Prix enfermé entre les bornes intraday ; attendre une clôture de cassure.' },
        { asset: 'USDJPY', label: 'Dollar / Yen', regime: 'Expansion haussière', tone: 'bull', force: 70, macro: 'Différentiel de taux et risque d’intervention restent les facteurs principaux.', technical: 'Sommets ascendants ; momentum acheteur confirmé au-dessus du support journalier.' },
        { asset: 'XAUUSD', label: 'Or spot', regime: 'Tendance haussière contrôlée', tone: 'bull', force: 76, macro: 'Sensibilité élevée aux surprises inflation / taux réels ; flux refuge soutenu.', technical: 'Prix au-dessus de la zone 4 180 ; impulsions acheteuses conservées.' },
        { asset: 'NAS100', label: 'Nasdaq 100', regime: 'Compression neutre', tone: 'neutral', force: 48, macro: 'Attente des données US : réduction du risque directionnel avant publication.', technical: 'Range intraday intact ; aucune cassure confirmée en H1.' },
        { asset: 'US30', label: 'Dow Jones 30', regime: 'Haussier prudent', tone: 'neutral', force: 57, macro: 'Les anticipations de croissance et la réaction aux données US guident le sentiment cyclique.', technical: 'Structure positive mais proche d’une résistance journalière importante.' },
        { asset: 'BTCUSD', label: 'Bitcoin', regime: 'Risque-on modéré', tone: 'bull', force: 61, macro: 'Appétit spéculatif présent mais sensible au dollar et aux rendements.', technical: 'Supports préservés ; momentum positif, volume à confirmer.' },
        { asset: 'USOIL', label: 'WTI / Pétrole', regime: 'Range directionnel', tone: 'neutral', force: 54, macro: 'Sensibilité aux titres d’offre et aux données de demande mondiale.', technical: 'Oscillation entre support et résistance ; confirmation attendue hors du range.' }
      ],
      weekly: [
        { asset: 'DXY', label: 'Dollar américain', regime: 'Tendance positive', tone: 'bull', force: 67, macro: 'Politique monétaire relative toujours favorable au dollar dans ce scénario de démonstration.', technical: 'Clôtures hebdomadaires au-dessus de la zone de valeur précédente.' },
        { asset: 'EURUSD', label: 'Euro / Dollar', regime: 'Tendance baissière', tone: 'caution', force: 64, macro: 'Le différentiel de trajectoire monétaire reste l’élément dominant de cette lecture modèle.', technical: 'Structure weekly sous les résistances précédentes ; momentum vendeur intact.' },
        { asset: 'GBPUSD', label: 'Livre / Dollar', regime: 'Neutre à baissier', tone: 'neutral', force: 51, macro: 'Les perspectives de la BoE et la force du dollar imposent une lecture prudente.', technical: 'Consolidation weekly sous une zone d’offre ; breakout requis pour trancher.' },
        { asset: 'USDJPY', label: 'Dollar / Yen', regime: 'Tendance haussière', tone: 'bull', force: 74, macro: 'Différentiel de rendements favorable, avec vigilance sur le risque d’intervention.', technical: 'Tendance weekly structurée avec des replis achetés au-dessus du support majeur.' },
        { asset: 'XAUUSD', label: 'Or spot', regime: 'Expansion haussière', tone: 'bull', force: 82, macro: 'Demande de couverture et incertitude sur les taux réels soutiennent le métal.', technical: 'Séquence de sommets et creux ascendants ; structure weekly intacte.' },
        { asset: 'NAS100', label: 'Nasdaq 100', regime: 'Haussier, étiré', tone: 'caution', force: 58, macro: 'Croissance et taux doivent rester favorables pour prolonger l’expansion.', technical: 'Tendance weekly positive mais éloignement marqué des zones d’équilibre.' },
        { asset: 'US30', label: 'Dow Jones 30', regime: 'Tendance positive', tone: 'bull', force: 65, macro: 'La résilience des données US soutient les valeurs cycliques dans ce scénario de démonstration.', technical: 'Clôtures weekly au-dessus de la structure de consolidation précédente.' },
        { asset: 'BTCUSD', label: 'Bitcoin', regime: 'Accumulation / reprise', tone: 'neutral', force: 55, macro: 'Liquidité globale et dollar restent les variables de confirmation.', technical: 'Range weekly de reconstruction ; breakout encore à valider.' },
        { asset: 'USOIL', label: 'WTI / Pétrole', regime: 'Neutre à haussier', tone: 'neutral', force: 52, macro: 'L’équilibre offre / demande et le risque géopolitique restent les catalyseurs clés.', technical: 'Prix dans une structure large de consolidation, borne haute à confirmer.' }
      ]
    };
    let selectedPeriod = 'daily';
    let selectedMarket = 'all';
    let data = demo;
    try {
      const saved = JSON.parse(window.localStorage.getItem('kn-nexus-market-regimes-v1'));
      if (saved?.daily && saved?.weekly) data = saved;
    } catch (_) { /* demo data remains active */ }

    function populateMarkets() {
      const previous = selectedMarket;
      const markets = [...new Map([...(data.daily || []), ...(data.weekly || [])].map(item => [item.asset, item])).values()];
      marketSelect.innerHTML = `<option value="all">Tous les marchés</option>${markets.map(item => `<option value="${escapeHtml(item.asset)}">${escapeHtml(item.asset)} · ${escapeHtml(item.label || item.asset)}</option>`).join('')}`;
      selectedMarket = [...marketSelect.options].some(option => option.value === previous) ? previous : 'all';
      marketSelect.value = selectedMarket;
    }

    const render = () => {
      const markets = (data[selectedPeriod] || []).filter(item => selectedMarket === 'all' || item.asset === selectedMarket);
      if (!markets.length) {
        grid.innerHTML = '<div class="regime-empty">Aucune lecture disponible pour ce marché et cette période.</div>';
        return;
      }
      grid.innerHTML = markets.map(item => `<article class="regime-card ${escapeHtml(item.tone || 'neutral')}">
        <div class="regime-card-head"><div><span class="regime-asset">${escapeHtml(item.asset)}</span><span class="regime-label">${escapeHtml(item.label)}</span></div><span class="regime-state">${escapeHtml(item.regime)}</span></div>
        <div class="strength-row"><span>Force du régime</span><b>${Number(item.force)} / 100</b></div><div class="strength-track"><i style="width:${Math.max(0, Math.min(100, Number(item.force)))}%"></i></div>
        <div class="regime-reasons"><div><span>MACRO</span><p>${escapeHtml(item.macro)}</p></div><div><span>TECHNIQUE</span><p>${escapeHtml(item.technical)}</p></div></div>
      </article>`).join('');
    };

    $$('[data-regime-period]', $('#regime-period')).forEach(button => button.addEventListener('click', () => {
      selectedPeriod = button.dataset.regimePeriod;
      $$('[data-regime-period]', $('#regime-period')).forEach(item => item.classList.remove('active'));
      button.classList.add('active');
      render();
    }));
    marketSelect.addEventListener('change', () => { selectedMarket = marketSelect.value; render(); });
    window.KNNexus = window.KNNexus || {};
    window.KNNexus.setMarketRegimes = payload => {
      if (!payload?.daily || !payload?.weekly) return false;
      data = payload;
      populateMarkets();
      try { window.localStorage.setItem('kn-nexus-market-regimes-v1', JSON.stringify(payload)); } catch (_) { /* no local persistence */ }
      render();
      return true;
    };
    populateMarkets();
    render();
  }

  function showToast(message) {
    let toast = $('.toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.className = 'toast';
      document.body.append(toast);
    }
    toast.innerHTML = `<i>✓</i><span>${message}</span>`;
    toast.classList.add('show');
    window.clearTimeout(window.__knToastTimer);
    window.__knToastTimer = window.setTimeout(() => toast.classList.remove('show'), 3200);
  }
})();
