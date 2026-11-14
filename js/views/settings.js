import { state, saveSettings, MODES, CUSTOM_TECHNIQUES } from '../store.js';
import { exportAll, importAll } from '../db.js';
import { esc, $, $$, options, checks, toast, confirmDialog } from '../ui.js';
import { MODELS } from '../ai.js';
import { NOTIFY_TYPES, requestPermission, notifSupported, runNotificationChecks } from '../notify.js';
import { downloadFile } from '../tasks.js';
import { applyTheme, route, loadContext } from '../app.js';

export async function render(view) {
  const s = state.settings, n = s.notify;
  const perm = notifSupported() ? Notification.permission : 'unsupported';
  view.innerHTML = `
  <div class="grid g2">
  <div class="card"><h2>✨ Intelligenza artificiale</h2>
    <div class="field"><label for="sKey">Chiave API Claude (Anthropic)</label><input id="sKey" type="password" autocomplete="off" value="${esc(s.apiKey)}" placeholder="sk-ant-…">
      <div class="hint">Si crea su console.anthropic.com. Resta salvata solo su questo dispositivo, non è inclusa nei backup e viene inviata solo all'API di Anthropic.</div></div>
    <div class="field"><label for="sModel">Modello</label><select id="sModel">${options(MODELS, s.model)}</select>
      <div class="hint">Schede e consigli vengono salvati per ridurre le chiamate. Costo tipico: 1–4 $ al mese con Opus.</div></div>
    <button class="primary" id="sSaveAI">Salva</button>
  </div>
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
    <p><small>Meteo e clima: Open-Meteo (ERA5). Nomenclatura: GBIF Backbone Taxonomy. Immagini: iNaturalist e Wikimedia Commons, solo con licenza Creative Commons, con autore e link alla fonte. AI: Claude (Anthropic).</small></p>
    <p><small>Le diagnosi e le identificazioni AI sono ipotesi da verificare; per organismi da quarantena rivolgiti al Servizio fitosanitario regionale. Usa i prodotti fitosanitari solo secondo etichetta.</small></p>
  </div>
  </div>`;

  $('#sSaveAI', view).onclick = async () => { await saveSettings({ apiKey: $('#sKey', view).value.trim(), model: $('#sModel', view).value }); toast('Impostazioni AI salvate'); };
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
