// Accounts, mod presets, player roster, and activity history.
let currentAccount = { permissions: [] };
let savedPresets = [];
let accountRows = [];
let roster = [];
let activityCursor = null;

const can = permission => currentAccount.permissions.includes(permission);
const byId = id => document.getElementById(id);

// Centralized helper to wrap async button clicks & prevent double actions
async function handleAction(buttonEl, actionFn) {
  if (buttonEl && buttonEl.disabled) return;
  const originalText = buttonEl ? buttonEl.textContent : '';
  if (buttonEl) {
    buttonEl.disabled = true;
    buttonEl.textContent = '...';
  }
  try {
    await actionFn();
  } catch (e) {
    setLog(e.message, 'error');
  } finally {
    if (buttonEl) {
      buttonEl.disabled = false;
      buttonEl.textContent = originalText;
    }
  }
}

async function changeFeature(url, data) {
  const response = await postJson(url, data);
  const result = await response.json();
  if (!response.ok || !result.ok) throw new Error(result.error || 'Request failed');
  setLog(result.restart_required ? 'Saved. Restart server to apply changes.' : 'Saved successfully', 'ok');
  if (result.restart_required) {
    const notice = byId('mods-restart-notice');
    if (notice) notice.classList.add('visible');
  }
  return result;
}

function applyPermissions() {
  document.querySelectorAll('[data-permission]').forEach(el => {
    el.hidden = !can(el.dataset.permission);
  });
  document.querySelectorAll('#mods-list button').forEach(el => {
    el.hidden = !can('mods');
  });
  ['btn-start', 'btn-stop', 'btn-reset'].forEach(id => {
    const btn = byId(id);
    if (btn && !can('control')) btn.disabled = true;
  });
}

// ─── PLAYERS ROSTER ───────────────────────────────────────────────────────────
async function loadPlayers() {
  if (document.hidden) return;
  const container = byId('players-roster');
  const summary = byId('player-summary');
  const msgEl = byId('player-message');

  try {
    const res = await apiFetch('/api/players');
    const data = await res.json();
    roster = data.players || [];

    if (summary) {
      summary.textContent = data.available ? `${roster.length} connected` : 'Unavailable';
    }
    if (msgEl) {
      msgEl.textContent = data.message || '';
    }

    if (!container) return;

    if (!data.available) {
      container.replaceChildren();
      const errRow = document.createElement('div');
      errRow.style.cssText = 'color:var(--offline);font-size:13px;';
      errRow.textContent = data.message || 'RCON connection unavailable';
      container.appendChild(errRow);
      return;
    }

    if (roster.length === 0) {
      container.replaceChildren();
      const emptyRow = document.createElement('div');
      emptyRow.style.cssText = 'color:var(--muted);font-size:13px;font-style:italic;';
      emptyRow.textContent = 'No players connected to the server';
      container.appendChild(emptyRow);
      return;
    }

    const frag = document.createDocumentFragment();

    roster.forEach(player => {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 14px;background:var(--bg);border:1px solid var(--border);';

      // Ліва частина: Номер, Нік, GUID/Identity
      const info = document.createElement('div');
      info.style.cssText = 'display:flex;flex-direction:column;gap:3px;min-width:0;';

      const title = document.createElement('div');
      title.style.cssText = "font-family:'Barlow Condensed',sans-serif;font-weight:700;font-size:16px;color:#fff;letter-spacing:0.04em;display:flex;align-items:center;gap:8px;";

      const numSpan = document.createElement('span');
      numSpan.style.cssText = 'color:var(--accent);font-size:13px;';
      numSpan.textContent = `#${player.id}`;

      const nameSpan = document.createElement('span');
      nameSpan.textContent = player.name;

      title.appendChild(numSpan);
      title.appendChild(nameSpan);

      const sub = document.createElement('div');
      sub.style.cssText = "font-size:11px;color:var(--muted);font-family:'Roboto Mono',monospace;word-break:break-all;";
      sub.textContent = player.identity;

      info.appendChild(title);
      info.appendChild(sub);

      // Права частина: час появи онлайн
      const right = document.createElement('div');
      right.style.cssText = 'flex-shrink:0;text-align:right;';

      const timeSpan = document.createElement('div');
      timeSpan.style.cssText = 'font-size:10px;font-weight:600;letter-spacing:0.15em;text-transform:uppercase;color:var(--muted);';
      timeSpan.textContent = 'Online since';

      const timeVal = document.createElement('div');
      timeVal.style.cssText = "font-family:'Roboto Mono',monospace;font-size:11px;color:var(--online);";
      timeVal.textContent = player.first_seen ? new Date(player.first_seen * 1000).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : 'now';

      right.appendChild(timeSpan);
      right.appendChild(timeVal);

      row.appendChild(info);
      row.appendChild(right);
      frag.appendChild(row);
    });

    container.replaceChildren(frag);

  } catch (error) {
    if (summary) summary.textContent = 'Unavailable';
    if (msgEl) msgEl.textContent = error.message;
    if (container) {
      container.replaceChildren();
      const errRow = document.createElement('div');
      errRow.style.cssText = 'color:var(--offline);font-size:13px;';
      errRow.textContent = error.message;
      container.appendChild(errRow);
    }
  }
}

// ─── MOD PRESETS ──────────────────────────────────────────────────────────────
async function loadPresets() {
  try {
    const res = await apiFetch('/api/presets');
    const data = await res.json();
    savedPresets = data.presets || [];
    const selected = byId('preset-select').value;

    byId('preset-select').replaceChildren(new Option('Select a saved mod preset', ''));
    savedPresets.forEach(p => {
      const matchSuffix = p.active ? ' — matches configured mods' : '';
      byId('preset-select').add(new Option(`${p.name} (${p.mods.length} mods)${matchSuffix}`, p.id));
    });
    byId('preset-select').value = selected;
    showPreset();
  } catch(e) {
    setLog('Failed to load presets: ' + e.message, 'error');
  }
}

function showPreset() {
  const p = savedPresets.find(p => String(p.id) === byId('preset-select').value);
  if (!p) {
    byId('preset-details').textContent = '';
    return;
  }
  const modList = p.mods.map(m => m.name || m.modId).join(', ') || 'No mods';
  byId('preset-details').textContent = `Saved by ${p.updated_by}: ${modList}`;
}

async function savePreset(overwrite = false, btn = null) {
  await handleAction(btn, async () => {
    const selected = savedPresets.find(p => String(p.id) === byId('preset-select').value);
    if (overwrite && !selected) throw new Error('Select a preset to overwrite');
    if (overwrite && !confirm(`Replace mods saved in "${selected.name}" with currently active mods?`)) return;

    const name = overwrite ? selected.name : byId('preset-name').value.trim();
    await changeFeature('/api/presets', { name, ...(overwrite ? { id: selected.id } : {}) });
    byId('preset-name').value = '';
    await loadPresets();
  });
}

async function presetAction(action, btn = null) {
  await handleAction(btn, async () => {
    const selected = savedPresets.find(p => String(p.id) === byId('preset-select').value);
    if (!selected) throw new Error('Select a preset first');

    const promptText = action === 'apply'
      ? `Replace active mod list with "${selected.name}"? Server restart will be required.`
      : `Delete preset "${selected.name}"?`;
    if (!confirm(promptText)) return;

    await changeFeature(`/api/presets/${action}`, { id: selected.id });
    await fetchStatus();
    await loadPresets();
  });
}

// ─── USER MANAGEMENT ──────────────────────────────────────────────────────────
async function loadUsers() {
  if (!can('users')) return;
  try {
    const res = await apiFetch('/api/users');
    const data = await res.json();
    accountRows = data.users || [];
    const container = byId('users-list');
    container.replaceChildren();

    const frag = document.createDocumentFragment();
    accountRows.forEach(user => {
      const row = document.createElement('div');
      row.className = 'feature-row';

      const label = document.createElement('span');
      label.textContent = `${user.username} · ${user.role}${user.enabled ? '' : ' · Disabled'}`;
      row.appendChild(label);

      const editBtn = document.createElement('button');
      editBtn.className = 'btn-save';
      editBtn.textContent = 'Edit';
      editBtn.onclick = () => {
        byId('user-id').value = user.id;
        byId('user-name').value = user.username;
        byId('user-role').value = user.role;
        byId('user-enabled').checked = !!user.enabled;
        byId('user-password').value = '';
        byId('user-save').textContent = 'Update account';
        byId('user-form-status').textContent = `Editing: ${user.username}`;
      };
      row.appendChild(editBtn);

      if (user.username !== currentAccount.username) {
        const delBtn = document.createElement('button');
        delBtn.className = 'btn-save';
        delBtn.textContent = 'Delete';
        delBtn.onclick = () => handleAction(delBtn, async () => {
          if (!confirm(`Delete account "${user.username}"?`)) return;
          await changeFeature('/api/users/delete', { id: user.id });
          await loadUsers();
        });
        row.appendChild(delBtn);
      }
      frag.appendChild(row);
    });
    container.appendChild(frag);
  } catch(e) {
    setLog(e.message, 'error');
  }
}

function resetUserForm() {
  byId('user-id').value = '';
  byId('user-name').value = '';
  byId('user-password').value = '';
  byId('user-role').value = 'viewer';
  byId('user-enabled').checked = true;
  byId('user-save').textContent = 'Create account';
  byId('user-form-status').textContent = '';
}

async function saveUser(btn = null) {
  await handleAction(btn, async () => {
    const username = byId('user-name').value.trim();
    const password = byId('user-password').value;
    const role = byId('user-role').value;
    const enabled = byId('user-enabled').checked;

    if (!username) throw new Error('Username cannot be empty');

    const payload = { username, role, enabled };
    if (password) payload.password = password;

    const editId = byId('user-id').value;
    if (editId) payload.id = Number(editId);

    await changeFeature('/api/users', payload);
    resetUserForm();
    await loadUsers();
  });
}

async function changePassword(btn = null) {
  await handleAction(btn, async () => {
    const cur = byId('current-password').value;
    const next = byId('new-password').value;
    if (!cur || !next) throw new Error('Both password fields are required');

    await changeFeature('/api/account/password', { current_password: cur, password: next });
    byId('current-password').value = '';
    byId('new-password').value = '';
  });
}

// ─── AUDIT ACTIVITY ───────────────────────────────────────────────────────────
const actionNames = {
  login: 'Signed in', api_start: 'Start server', api_stop: 'Stop server',
  api_restart: 'Restart server', api_config: 'Change configuration',
  api_mods_add: 'Add mod', api_mods_remove: 'Remove mod', api_mods_import: 'Import mods',
  api_persistence_set: 'Change persistence', api_persistence_flush: 'Delete saves',
  api_scenarios_rescan: 'Rescan scenarios', presets_save: 'Save preset',
  presets_apply: 'Apply preset', presets_delete: 'Delete preset',
  users_save: 'Save account', users_delete: 'Delete account', account_password: 'Change password'
};

function renderActivityRow(event) {
  const row = document.createElement('div');
  row.className = 'activity-entry';

  const title = document.createElement('strong');
  const dateStr = new Date(event.ts * 1000).toLocaleString();
  title.textContent = `${dateStr} · ${event.actor} · ${actionNames[event.action] || event.action} · ${event.outcome}`;
  row.appendChild(title);

  if (event.details && Object.keys(event.details).length > 0) {
    const detail = document.createElement('div');
    detail.textContent = Object.entries(event.details)
      .map(([key, value]) => {
        const cleanKey = key.replaceAll('_', ' ');
        if (Array.isArray(value)) {
          const items = value.map(v => typeof v === 'object' ? `${v.name || v.modId} (${v.modId})` : v).join(', ');
          return `${cleanKey}: ${items || 'none'}`;
        }
        return `${cleanKey}: ${value}`;
      })
      .join(' · ');
    row.appendChild(detail);
  }
  return row;
}

async function loadActivity(older = false, btn = null) {
  if (!can('activity')) return;
  await handleAction(btn, async () => {
    const query = (older && activityCursor) ? `?before=${activityCursor}` : '';
    const res = await apiFetch(`/api/activity${query}`);
    const data = await res.json();
    const list = byId('activity-list');

    const frag = document.createDocumentFragment();
    (data.events || []).forEach(event => {
      frag.appendChild(renderActivityRow(event));
    });

    if (!older) {
      list.replaceChildren(frag);
    } else {
      list.appendChild(frag);
    }

    if (!list.childElementCount) {
      list.textContent = 'No activity yet.';
    }

    activityCursor = data.next_before;
    byId('activity-more').hidden = !activityCursor;
  });
}

// ─── INITIALIZATION ───────────────────────────────────────────────────────────
async function initFeatures() {
  try {
    const res = await apiFetch('/api/me');
    currentAccount = await res.json();
    byId('account-label').textContent = `${currentAccount.username} · ${currentAccount.role}`;
    applyPermissions();

    await Promise.all([
      loadPlayers(),
      loadPresets(),
      can('users') ? loadUsers() : Promise.resolve(),
      can('activity') ? loadActivity() : Promise.resolve()
    ]);

    setInterval(() => {
      if (!document.hidden) loadPlayers();
    }, 10000);
  } catch(e) {
    setLog(e.message, 'error');
  }
}

document.addEventListener('panel-change', event => {
  // Update activity log without wiping older pagination if already loaded
  if (can('activity') && !activityCursor) {
    loadActivity();
  }
  if (event.detail.startsWith('/api/mods/')) {
    loadPresets().catch(e => setLog(e.message, 'error'));
  }
});

initFeatures();
