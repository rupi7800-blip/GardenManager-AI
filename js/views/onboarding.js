import { state, saveSettings, MODES } from '../store.js';
import { esc, $, options } from '../ui.js';
import { gardenFormHTML, bindGardenForm } from './garden-form.js';
import { go } from '../app.js';

export async function render(view, params) {
  const isNew = params[0] === 'nuovo' || state.gardens.length > 0;
  view.innerHTML = `
    ${isNew ? '' : `<div class="card tip" style="margin-bottom:14px"><h2>🌿 Benvenuto in Garden Manager AI</h2><p>Configura il tuo giardino: con la località l'app calcola il clima locale, il meteo e adatta calendario, irrigazione e consigli. Tutti i dati restano sul tuo dispositivo.</p></div>`}
    <div class="card"><h2>${isNew ? 'Nuovo giardino' : 'Il tuo giardino'}</h2>
      ${gardenFormHTML({})}
      ${isNew ? '' : `<hr><div class="form-grid">
        <div class="field"><label for="obName">Come ti chiami? (facoltativo)</label><input id="obName" type="text" value="${esc(state.settings.userName || '')}"></div>
        <div class="field"><label for="obMode">Filosofia di gestione</label><select id="obMode">${options(Object.entries(MODES).map(([k, v]) => [k, v.label]), state.settings.mode)}</select><div class="hint">Cambia i consigli e gli interventi proposti. Modificabile in Impostazioni.</div></div>
      </div>`}
      <div class="modal-foot"><button class="primary" id="obSave">Salva e inizia</button></div>
    </div>`;
  const submit = bindGardenForm(view, {});
  $('#obSave', view).onclick = async (e) => {
    e.target.disabled = true; e.target.textContent = 'Salvataggio…';
    if (!isNew) await saveSettings({ userName: $('#obName', view).value.trim(), mode: $('#obMode', view).value });
    const g = await submit();
    e.target.disabled = false; e.target.textContent = 'Salva e inizia';
    if (g) go('#/dashboard');
  };
}
