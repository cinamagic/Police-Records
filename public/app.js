const state = {
  records: [],
  selectedId: null,
  selectedTab: 'charges'
};

const els = {
  stats: document.querySelector('#stats'),
  recordList: document.querySelector('#recordList'),
  recordDetail: document.querySelector('#recordDetail'),
  searchInput: document.querySelector('#searchInput'),
  statusFilter: document.querySelector('#statusFilter'),
  riskFilter: document.querySelector('#riskFilter'),
  dialog: document.querySelector('#recordDialog'),
  recordForm: document.querySelector('#recordForm'),
  auditTable: document.querySelector('#auditTable'),
  devicesTable: document.querySelector('#devicesTable'),
  exportOutput: document.querySelector('#exportOutput'),
  importResult: document.querySelector('#importResult')
};

const api = async (path, options = {}) => {
  const response = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'X-CRMS-User': 'local-operator',
      'X-CRMS-Role': 'records-officer',
      'X-CRMS-Device': 'station-main',
      ...(options.headers || {})
    }
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || 'Request failed');
  return payload;
};

async function init() {
  bindEvents();
  await Promise.all([loadStats(), loadRecords(), loadAudit(), loadDevices()]);
}

function bindEvents() {
  document.querySelectorAll('.nav-item').forEach((button) => {
    button.addEventListener('click', () => switchView(button.dataset.view));
  });
  document.querySelector('#newRecordBtn').addEventListener('click', () => els.dialog.showModal());
  document.querySelector('#closeDialog').addEventListener('click', () => els.dialog.close());
  document.querySelector('#cancelRecord').addEventListener('click', () => els.dialog.close());
  els.recordForm.addEventListener('submit', createRecord);
  els.searchInput.addEventListener('input', debounce(loadRecords, 180));
  els.statusFilter.addEventListener('change', loadRecords);
  els.riskFilter.addEventListener('change', loadRecords);
  document.querySelector('#refreshDevices').addEventListener('click', loadDevices);
  document.querySelector('#exportForm').addEventListener('submit', exportChanges);
  document.querySelector('#importForm').addEventListener('submit', importChanges);
}

function switchView(view) {
  document.querySelectorAll('.nav-item').forEach((item) => item.classList.toggle('active', item.dataset.view === view));
  document.querySelectorAll('.view').forEach((item) => item.classList.remove('active'));
  document.querySelector(`#${view}View`).classList.add('active');
  if (view === 'audit') loadAudit();
  if (view === 'sync') loadDevices();
}

async function loadStats() {
  const stats = await api('/api/stats');
  els.stats.innerHTML = [
    ['Records', stats.records],
    ['Active warrants', stats.activeWarrants],
    ['Open cases', stats.openCases],
    ['High risk', stats.highRisk],
    ['Change log', stats.changes]
  ].map(([label, value]) => `<div class="stat"><strong>${value}</strong><span>${label}</span></div>`).join('');
}

async function loadRecords() {
  const params = new URLSearchParams({
    search: els.searchInput.value,
    status: els.statusFilter.value,
    risk: els.riskFilter.value
  });
  state.records = await api(`/api/records?${params}`);
  if (!state.selectedId && state.records.length) state.selectedId = state.records[0].id;
  if (!state.records.some((record) => record.id === state.selectedId)) state.selectedId = state.records[0]?.id || null;
  renderRecordList();
  await renderDetail();
}

function renderRecordList() {
  els.recordList.innerHTML = state.records.length ? state.records.map((record) => `
    <button class="record-row ${record.id === state.selectedId ? 'active' : ''}" data-id="${record.id}">
      <span>
        <strong>${escapeHtml(record.last_name)}, ${escapeHtml(record.first_name)}</strong>
        <small>${escapeHtml(record.crn)} · ${escapeHtml(record.national_id || 'No national ID')}</small>
        <small>${record.charge_count} charges · ${record.open_case_count} open cases · ${record.active_warrant_count} warrants</small>
      </span>
      <span class="pills">
        <span class="pill ${record.risk_level}">${record.risk_level}</span>
        <span class="pill ${record.status}">${record.status}</span>
      </span>
    </button>
  `).join('') : '<div class="item">No matching records.</div>';
  els.recordList.querySelectorAll('.record-row').forEach((row) => {
    row.addEventListener('click', async () => {
      state.selectedId = row.dataset.id;
      renderRecordList();
      await renderDetail();
    });
  });
}

async function renderDetail() {
  if (!state.selectedId) {
    els.recordDetail.innerHTML = '<p>Select or create a record to view case intelligence.</p>';
    return;
  }
  const record = await api(`/api/records/${state.selectedId}`);
  const tabItems = record[state.selectedTab] || [];
  els.recordDetail.innerHTML = `
    <div class="detail-title">
      <div>
        <strong>${escapeHtml(record.first_name)} ${escapeHtml(record.last_name)}</strong>
        <p>${escapeHtml(record.crn)} · updated ${formatDate(record.updated_at)}</p>
      </div>
      <span class="pills">
        <span class="pill ${record.risk_level}">${record.risk_level} risk</span>
        <span class="pill ${record.status}">${record.status}</span>
      </span>
    </div>
    <div class="identity-grid">
      ${field('Date of birth', record.date_of_birth || 'Unknown')}
      ${field('Gender', record.gender || 'Unknown')}
      ${field('Nationality', record.nationality || 'Unknown')}
      ${field('Fingerprint', record.fingerprint_id || 'Not captured')}
      ${field('National ID', record.national_id || 'Not captured')}
      ${field('Address', record.address || 'No address')}
      ${field('Aliases', record.aliases.map((a) => a.alias_name).join(', ') || 'None')}
      ${field('Origin device', record.origin_device_id)}
    </div>
    <div class="item"><strong>Officer notes</strong><p>${escapeHtml(record.notes || 'No notes recorded.')}</p></div>
    <div class="tabs">
      ${['charges', 'cases', 'evidence', 'warrants', 'audit'].map((tab) => `<button class="tab ${state.selectedTab === tab ? 'active' : ''}" data-tab="${tab}">${tab}</button>`).join('')}
    </div>
    <div class="item-list">
      ${tabItems.length ? tabItems.map((item) => renderItem(state.selectedTab, item)).join('') : '<div class="item">No entries in this section.</div>'}
    </div>
  `;
  els.recordDetail.querySelectorAll('.tab').forEach((button) => {
    button.addEventListener('click', () => {
      state.selectedTab = button.dataset.tab;
      renderDetail();
    });
  });
}

function field(label, value) {
  return `<div class="field"><span>${label}</span><strong>${escapeHtml(value)}</strong></div>`;
}

function renderItem(tab, item) {
  const layouts = {
    charges: [`${item.offense}`, `${item.statute_code} · ${item.severity} · ${item.disposition}`, item.notes],
    cases: [`${item.case_number}: ${item.title}`, `${item.agency} · ${item.lead_officer} · ${item.status}`, item.summary],
    evidence: [`${item.tag}: ${item.type}`, `${item.storage_location}`, `${item.description} Chain: ${item.chain_of_custody}`],
    warrants: [`${item.warrant_number}`, `${item.issuing_court} · ${item.status}`, item.details],
    audit: [`${item.action} ${item.entity_table}`, `${item.actor} · ${formatDate(item.created_at)}`, item.metadata]
  };
  const [title, meta, body] = layouts[tab] || ['Entry', '', ''];
  return `<div class="item"><strong>${escapeHtml(title)}</strong><p>${escapeHtml(meta || '')}</p><p>${escapeHtml(body || '')}</p></div>`;
}

async function createRecord(event) {
  event.preventDefault();
  const form = new FormData(els.recordForm);
  const payload = Object.fromEntries(form.entries());
  payload.aliases = payload.aliases.split(',').map((alias) => alias.trim()).filter(Boolean);
  const record = await api('/api/records', { method: 'POST', body: JSON.stringify(payload) });
  els.recordForm.reset();
  els.dialog.close();
  state.selectedId = record.id;
  await Promise.all([loadStats(), loadRecords(), loadAudit()]);
}

async function exportChanges(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const params = new URLSearchParams({ device: form.get('device'), since: form.get('since') });
  const packet = await api(`/api/sync/export?${params}`);
  els.exportOutput.value = JSON.stringify(packet, null, 2);
  await Promise.all([loadStats(), loadDevices()]);
}

async function importChanges(event) {
  event.preventDefault();
  const packetText = new FormData(event.currentTarget).get('packet');
  const packet = JSON.parse(packetText);
  const result = await api('/api/sync/import', { method: 'POST', body: JSON.stringify(packet) });
  els.importResult.textContent = JSON.stringify(result, null, 2);
  await Promise.all([loadStats(), loadRecords(), loadAudit(), loadDevices()]);
}

async function loadAudit() {
  const rows = await api('/api/audit');
  els.auditTable.innerHTML = rows.map((row) => `
    <div class="table-row">
      <strong>${escapeHtml(row.action)}</strong>
      <span>${escapeHtml(row.entity_table)}</span>
      <span>${escapeHtml(row.actor)}</span>
      <span>${escapeHtml(row.device_id)}</span>
      <span>${formatDate(row.created_at)}</span>
    </div>
  `).join('');
}

async function loadDevices() {
  const rows = await api('/api/devices');
  els.devicesTable.innerHTML = rows.map((row) => `
    <div class="table-row">
      <strong>${escapeHtml(row.name)}</strong>
      <span>${escapeHtml(row.id)}</span>
      <span>${escapeHtml(row.type)}</span>
      <span>export ${row.last_exported_change_id} / import ${row.last_imported_change_id}</span>
      <span>${formatDate(row.last_seen_at || row.created_at)}</span>
    </div>
  `).join('');
}

function debounce(fn, delay) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  })[char]);
}

function formatDate(value) {
  if (!value) return 'never';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

init().catch((error) => {
  document.body.innerHTML = `<pre>${escapeHtml(error.stack || error.message)}</pre>`;
});
