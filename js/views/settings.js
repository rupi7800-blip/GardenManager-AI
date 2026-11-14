import { state, saveSettings, MODES, CUSTOM_TECHNIQUES } from '../store.js';
import { exportAll, importAll, kvGet, kvSet } from '../db.js';
import { esc, $, $$, options, checks, toast, confirmDialog } from '../ui.js';
import { PROVIDERS, aiConfig, testProvider, listModels, hasAI } from '../ai.js';
import { PROVIDER_ORDER, NOT_INCLUDED } from '../ai-providers.js';
import { NOTIFY_TYPES, requestPermission, notifSupported, runNotificationChecks } from '../notify.js';
import { downloadFile } from '../tasks.js';
import { applyTheme, route, loadContext } from '../app.js';

export async function render(view) {
  const s = state.settings, n = s.notify;
  const perm = notifSupported() ? Notification.permission : 'unsupported';
  view.innerHTML = `
  <div class="card" id="aiCard" style="margin-bottom:14px"></div>
  <div class="grid g2">
  <div class="card"><h2>🌿 Filosofia di gestione</h2>
    <div class="stack">${Object.entries(MODES).map(([k, v]) => `<label style="font-weight:400;display:flex;gap:10px;align-items:flex-start;margin:0;padding:8px;border:1px solid var(--line);border-radius:10px;cursor:pointer"><input type="radio" name="mode" value="${k}" ${s.mode === k ? 'checked' : ''} style="margin-top:4px"><span><b>${v.label}</b><br><small>${esc(v.desc)}</small></span></label>`).join('')}</div>
    <div id="customBox" ${s.mode === 'personalizzata' ? '' : 'hidden'} style="margin-top:10px"><label>Tecniche da combinare</label>${checks('tech', CUSTOM_TECHNIQUES, s.customMode)}</div>
    <div class="hint" style="margin-top:8px">Modifica i trattamenti, le concimazioni e le risposte dell'AI.</div>
  </div>
  <div class="card"><h2>🔔 Notifiche</h2>
    ${perm === 'unsupported' ? '<div class="alert warn">Questo browser non supporta le notifiche. Su iPhone/iPad installa prima l\'app nella schermata Home (iOS 16.4+).</div>' : perm === 'denied' ? '<div class="alert warn">Notifiche bloccate nelle impostazioni del browser per questo sito.</div>' : ''}
    <label style="font-weight:400;display:flex;gap:8px;align-items:center"><input type="checkbox" id="nOn" ${n.enabled && perm === 'granted' ? 'checked' : ''} ${perm === 'unsupported' || perm === 'denied' ? 'disabled' : ''}> Attiva notifiche</label>
    <div class="form-grid" style="margin-top:10px">
      <div class="field"><label for="nTime">Orario del riepilogo</label><input id="nTime" type="time" value="${n.time}"></div>
      <div class="field"><label for="nAdv">Anticipo</label><select id="nAdv">${options([[0, 'il giorno stesso'], [1, '1 giorno prima'], [2, '2 giorni prima'], [3, '3 giorni prima']], n.advanceDays)}</select></div>
      <div class="field"><label for="nPrio">Priorità minima</label><select id="nPrio">${options([[1, 'tutte'], [2, 'importanti e urgenti'], [3, 'solo urgenti']], n.minPriority)}</select></div>
      <div class="field"><label>&nbsp;</label><label style="font-weight:400;display:flex;gap:8px;align-items:center"><input type="checkbox" id="nWeek" ${n.weekly ? 'checked' : ''}> Riepilogo settimanale (lunedì)</label></div>
      <div class="field full"><label>Tipi di notifica</label>${checks('ntype', NOTIFY_TYPES, n.types)}</div>
    </div>
    <div class="hint">Un solo riepilogo al giorno e un avviso per ogni evento meteo: niente notifiche ripetute. Le notifiche partono quando l'app è aperta; se l'app è installata, su Chrome/Edge per Android e desktop anche in background (sincronizzazione periodica). Per promemoria sempre garantiti esporta le attività nel tuo calendario.</div>
    <div class="row" style="margin-top:10px"><button class="primary" id="nSave">Salva notifiche</button><button id="nTest">Invia notifica di prova</button></div>
  </div>
  <div class="card"><h2>🎨 Aspetto e profilo</h2>
    <div class="field"><label for="sTheme">Tema</label><select id="sTheme">${options([['auto', 'Automatico (come il sistema)'], ['light', 'Chiaro'], ['dark', 'Scuro']], s.theme)}</select></div>
    <div class="field"><label for="sName">Il tuo nome</label><input id="sName" type="text" value="${esc(s.userName)}"></div>
    <button id="sSaveLook">Salva</button>
  </div>
  <div class="card"><h2>💾 Backup e dati</h2>
    <p class="muted">I dati sono salvati in questo dispositivo (funzionano offline). Esporta un backup per conservarli o trasferirli su un altro dispositivo.</p>
    <div class="row"><button id="bExp" class="primary">⬇️ Esporta backup</button><label class="btn" style="margin:0;font-weight:400">⬆️ Importa backup<input type="file" id="bImp" accept="application/json,.json" hidden></label></div>
    <div id="storage" class="hint" style="margin-top:8px"></div>
  </div>
  <div class="card"><h2>ℹ️ Informazioni</h2>
    <p><small>Meteo e clima: Open-Meteo (ERA5). Nomenclatura: GBIF Backbone Taxonomy. Immagini: iNaturalist e Wikimedia Commons, solo con licenza Creative Commons, con autore e link alla fonte. AI: il servizio scelto sopra (Gemini, Groq, OpenRouter, Mistral, Claude…).</small></p>
    <p><small>Le diagnosi e le identificazioni AI sono ipotesi da verificare; per organismi da quarantena rivolgiti al Servizio fitosanitario regionale. Usa i prodotti fitosanitari solo secondo etichetta.</small></p>
  </div>
  </div>`;

  renderAI($('#aiCard', view));
  $$('[name=mode]', view).forEach(r => r.onchange = async () => { $('#customBox', view).hidden = r.value !== 'personalizzata'; await saveSettings({ mode: r.value }); toast('Filosofia di gestione: ' + MODES[r.value].label); });
  $$('[name=tech]', view).forEach(c => c.onchange = () => saveSettings({ customMode: $$('[name=tech]:checked', view).map(x => x.value) }));
  const collectNotify = (enabled) => ({ ...n, enabled, time: $('#nTime', view).value || '08:00', advanceDays: +$('#nAdv', view).value, minPriority: +$('#nPrio', view).value, weekly: $('#nWeek', view).checked, types: $$('[name=ntype]:checked', view).map(x => x.value) });
  $('#nSave', view).onclick = async () => {
    let enabled = $('#nOn', view).checked;
    if (enabled && Notification.permission !== 'granted') { const r = await requestPermission(); enabled = r === 'granted'; if (!enabled) toast('Permesso notifiche non concesso'); }
    await saveSettings({ notify: collectNotify(enabled) });
    toast('Notifiche salvate');
    if (enabled) { const ctx = await loadContext(); runNotificationChecks({ alerts: ctx.alerts }); }
  };
  $('#nTest', view).onclick = async () => {
    const r = Notification.permission === 'granted' ? 'granted' : await requestPermission();
    if (r !== 'granted') return toast('Permesso notifiche non concesso');
    const reg = await navigator.serviceWorker?.getRegistration();
    const opts = { body: 'Le notifiche funzionano. 🌿', icon: 'icons/icon-192.png', tag: 'test' };
    if (reg) reg.showNotification('Garden Manager AI', opts); else new Notification('Garden Manager AI', opts);
  };
  $('#sSaveLook', view).onclick = async () => { await saveSettings({ theme: $('#sTheme', view).value, userName: $('#sName', view).value.trim() }); applyTheme(); toast('Salvato'); };
  $('#sTheme', view).onchange = (e) => applyTheme(e.target.value);
  $('#bExp', view).onclick = async () => {
    const data = await exportAll();
    downloadFile(`garden-manager-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(data), 'application/json');
    toast('Backup esportato');
  };
  $('#bImp', view).onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try {
      const json = JSON.parse(await f.text());
      const replace = await confirmDialog('Sostituire i dati attuali con quelli del backup? (Annulla = unisci ai dati esistenti)', 'Sostituisci', true);
      await importAll(json, { replace });
      toast('Backup importato'); setTimeout(() => location.reload(), 600);
    } catch (err) { toast('Importazione non riuscita: ' + err.message, 5000); }
  };
  if (navigator.storage?.estimate) navigator.storage.estimate().then(est => { $('#storage', view).textContent = `Spazio usato: ${(est.usage / 1048576).toFixed(1)} MB${est.quota ? ' su ' + Math.round(est.quota / 1048576) + ' MB disponibili' : ''}.`; navigator.storage.persist?.(); });
}

// Scelta e configurazione dei servizi AI
// Menu a tendina dei modelli: suggeriti + letti dal servizio + "altro" da scrivere
function modelPicker(id, field, current, list) {
  const all = [...new Set([current, ...list].filter(Boolean))];
  return `<div class="row" style="flex-wrap:nowrap;gap:6px">
    <select data-pick="${field}" aria-label="${field === 'model' ? 'Modello' : 'Modello per le foto'}" style="flex:1;min-width:0">${all.map(m => `<option value="${esc(m)}" ${m === current ? 'selected' : ''}>${esc(m)}</option>`).join('')}<option value="__altro">✏️ Altro modello (scrivi)…</option></select>
    <input type="text" data-f="${field}" value="${esc(current)}" hidden style="flex:1;min-width:0" placeholder="nome del modello">
  </div>`;
}
function bindPickers(root) {
  for (const sel of $$('[data-pick]', root)) {
    const input = sel.parentElement.querySelector('[data-f]');
    sel.onchange = () => {
      if (sel.value === '__altro') { input.hidden = false; input.value = ''; input.focus(); }
      else { input.hidden = true; input.value = sel.value; }
    };
  }
}

async function renderAI(box) {
  const cfg = aiConfig();
  const fetched = {};
  for (const id of PROVIDER_ORDER) fetched[id] = await kvGet('models:' + id, []);
  const listFor = (id) => [...PROVIDERS[id].models, ...fetched[id]];
  const chip = (f) => `<span class="chip ${/^gratuito/.test(f) ? 'ok' : /pagamento/.test(f) ? 'warn' : ''}">${esc(f)}</span>`;
  box.innerHTML = `<div class="card-head"><h2>✨ Intelligenza artificiale</h2>${hasAI() ? '<span class="chip ok">attiva</span>' : '<span class="chip warn">non configurata</span>'}</div>
    <p class="muted">Scegli uno o più servizi. Per iniziare gratis: crea una chiave su <a href="${PROVIDERS.gemini.keyUrl}" target="_blank" rel="noopener">Google AI Studio</a> (un minuto, senza carta) e incollala in Google Gemini. Le chiavi restano solo su questo dispositivo e non entrano nei backup.</p>
    <div class="form-grid">
      <div class="field"><label for="aiPrimary">Servizio principale</label><select id="aiPrimary">${options(PROVIDER_ORDER.map(id => [id, `${PROVIDERS[id].label} — ${PROVIDERS[id].free}`]), cfg.primary)}</select></div>
      <div class="field"><label>Servizi di riserva</label><label style="font-weight:400;display:flex;gap:8px;align-items:center"><input type="checkbox" id="aiFallback" ${cfg.fallback ? 'checked' : ''}> Se finisce la quota gratuita o il servizio non risponde, usa automaticamente gli altri servizi attivi</label></div>
    </div>
    <div class="stack" id="provList">${PROVIDER_ORDER.map(id => { const p = PROVIDERS[id], c = cfg.providers[id]; const showBase = id === 'custom' || id === 'ollama'; return `<details class="card" style="box-shadow:none;padding:10px 14px" data-prov="${id}">
      <summary style="cursor:pointer"><b>${esc(p.label)}</b> ${chip(p.free)} ${id === cfg.primary ? '<span class="chip ok">principale</span>' : ''} ${c.enabled ? '<span class="chip sage">attivo</span>' : ''} <small>${p.vision ? '📷 foto' : 'solo testo'}${p.webSearch ? ' · 🔎 fonti web' : ''}</small></summary>
      <p style="margin-top:8px"><small>${esc(p.note)}${p.keyUrl ? ` <a href="${p.keyUrl}" target="_blank" rel="noopener">${p.needsKey ? 'Ottieni la chiave ↗' : 'Sito ↗'}</a>` : ''}</small></p>
      <label style="font-weight:400;display:flex;gap:8px;align-items:center"><input type="checkbox" data-f="enabled" ${c.enabled ? 'checked' : ''}> Usa questo servizio</label>
      <div class="form-grid" style="margin-top:8px">
        ${p.needsKey || id === 'custom' ? `<div class="field full"><label>Chiave API${p.needsKey ? '' : ' (se richiesta)'}</label><input type="password" autocomplete="off" data-f="key" value="${esc(c.key)}"></div>` : ''}
        ${showBase ? `<div class="field full"><label>Indirizzo del servizio</label><input type="text" data-f="base" value="${esc(c.base || p.base)}" placeholder="https://…/v1"></div>` : ''}
        <div class="field"><label>Modello</label>${modelPicker(id, 'model', c.model || p.model, listFor(id))}</div>
        ${p.vision && p.kind === 'openai' ? `<div class="field"><label>Modello per le foto</label>${modelPicker(id, 'visionModel', c.visionModel || p.visionModel, listFor(id))}</div>` : ''}
      </div>
      <div class="row"><button class="small" data-test="${id}">Prova collegamento</button><button class="small ghost" data-models="${id}">Aggiorna elenco modelli</button><small data-out="${id}"></small></div>
    </details>`; }).join('')}</div>
    <div class="row" style="margin-top:12px"><button class="primary" id="aiSave">Salva servizi AI</button></div>
    <details style="margin-top:12px"><summary><small>Servizi valutati e non inclusi</small></summary><ul>${NOT_INCLUDED.map(([n, w]) => `<li><small><b>${esc(n)}</b>: ${esc(w)}</small></li>`).join('')}</ul>
      <small>I limiti dei piani gratuiti cambiano spesso: verifica le condizioni sul sito di ogni servizio.</small></details>`;
  bindPickers(box);
  // inserendo una chiave il servizio si attiva automaticamente
  for (const k of $$('[data-f=key]', box)) k.addEventListener('input', () => { if (k.value.trim()) k.closest('[data-prov]').querySelector('[data-f=enabled]').checked = true; });
  const collect = () => {
    const providers = {};
    for (const d of $$('[data-prov]', box)) {
      const o = {};
      for (const el of $$('[data-f]', d)) o[el.dataset.f] = el.type === 'checkbox' ? el.checked : el.value.trim();
      providers[d.dataset.prov] = o;
    }
    return { primary: $('#aiPrimary', box).value, fallback: $('#aiFallback', box).checked, providers };
  };
  $('#aiPrimary', box).onchange = (e) => { const d = $(`[data-prov="${e.target.value}"]`, box); d.open = true; $('[data-f=enabled]', d).checked = true; };
  $('#aiSave', box).onclick = async () => {
    const ai = collect();
    ai.providers[ai.primary].enabled = true;
    await saveSettings({ ai, apiKey: '' });
    toast(hasAI() ? 'Servizi AI salvati' : 'Salvato: manca ancora una chiave valida');
    renderAI(box);
  };
  // aggiorna i menu dei modelli di un servizio con l'elenco letto dal servizio stesso
  const refreshModels = async (id, quiet) => {
    const out = $(`[data-out="${id}"]`, box);
    try {
      const list = await listModels(id, { ...state.settings, ai: collect() });
      if (!list.length) throw new Error('nessun modello restituito');
      await kvSet('models:' + id, list);
      fetched[id] = list;
      const d = $(`[data-prov="${id}"]`, box);
      for (const sel of $$('[data-pick]', d)) {
        const input = sel.parentElement.querySelector('[data-f]');
        const cur = input.value;
        sel.innerHTML = [...new Set([cur, ...listFor(id)].filter(Boolean))].map(m => `<option value="${esc(m)}" ${m === cur ? 'selected' : ''}>${esc(m)}</option>`).join('') + '<option value="__altro">✏️ Altro modello (scrivi)…</option>';
        input.hidden = true;
      }
      if (!quiet) out.innerHTML = `<span class="chip ok">${list.length} modelli</span> scegli dal menu Modello`;
    } catch (e) { if (!quiet) out.innerHTML = `<span class="chip danger">errore</span> ${esc(e.message)}`; }
  };
  $$('[data-test]', box).forEach(b => b.onclick = async () => {
    const id = b.dataset.test, out = $(`[data-out="${id}"]`, box);
    b.disabled = true;
    out.innerHTML = '<span class="spinner"></span> Prova in corso (max 30 s)…';
    try {
      const r = await testProvider(id, { ...state.settings, ai: collect() });
      // collegamento riuscito: attiva e salva subito il servizio
      $(`[data-prov="${id}"] [data-f=enabled]`, box).checked = true;
      await saveSettings({ ai: collect(), apiKey: '' });
      out.innerHTML = `<span class="chip ok">funziona</span> ${esc(r.model)} · «${esc(r.pianta)}» · ${r.seconds} s · attivato e salvato`;
      const st = $('.card-head .chip', box); if (st) { st.className = 'chip ok'; st.textContent = 'attiva'; }
      refreshModels(id, true);
    } catch (e) { out.innerHTML = `<span class="chip danger">errore</span> ${esc(e.message)}`; }
    b.disabled = false;
  });
  $$('[data-models]', box).forEach(b => b.onclick = async () => {
    const id = b.dataset.models;
    b.disabled = true;
    $(`[data-out="${id}"]`, box).innerHTML = '<span class="spinner"></span> Lettura modelli…';
    await refreshModels(id, false);
    b.disabled = false;
  });
}
