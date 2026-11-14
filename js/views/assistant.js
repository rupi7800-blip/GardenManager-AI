import { db, uid } from '../db.js';
import { state, saveSettings } from '../store.js';
import { esc, $, $$, toast, richText, confirmDialog } from '../ui.js';
import { chatStream, hasAI } from '../ai.js';

const SUGGEST = ['Cosa devo fare oggi nel mio giardino?', 'Quali piante devo potare questo mese?', 'Quali piante richiedono attenzione?', 'Come posso ridurre il consumo d\'acqua?', 'Quali arbusti posso inserire nella zona in mezz\'ombra?', 'Quali piante posso consociare nell\'orto?', 'Come posso migliorare la biodiversità?', 'Come posso ridurre la manutenzione?'];

export async function render(view) {
  const gid = state.garden.id;
  let chat = (await db.byIndex('chats', 'gardenId', gid))[0] || { id: uid(), gardenId: gid, messages: [] };
  view.innerHTML = `
  ${hasAI() ? '' : '<div class="alert warn">Il consulente usa l\'AI: inserisci la tua chiave API Claude in <a href="#/impostazioni">Impostazioni</a>.</div>'}
  <div class="row between" style="margin-bottom:10px"><small class="muted">Il consulente conosce piante, posizioni, clima, interventi e preferenze del giardino «${esc(state.garden.name)}».</small>
    <div class="row"><label style="font-weight:400;display:flex;gap:6px;align-items:center;margin:0" title="Cerca su fonti web e cita i link (più lento, costo maggiore)"><input type="checkbox" id="ws" ${state.settings.webSearch ? 'checked' : ''}> Cerca fonti sul web</label><button class="small ghost" id="clr">Nuova conversazione</button></div></div>
  <div class="chat" id="chat"></div>
  <div class="suggestions" id="sugg" style="margin:12px 0"></div>
  <div class="chat-input"><textarea id="q" placeholder="Fai una domanda sul tuo giardino…" rows="1" aria-label="Domanda"></textarea><button class="primary" id="send" ${hasAI() ? '' : 'disabled'}>Invia</button></div>`;
  const box = $('#chat', view);
  const drawMsg = (m) => `<div class="msg ${m.role}">${m.role === 'assistant' ? richText(m.text) : esc(m.text)}${m.sources?.length ? `<div class="src"><b>Fonti:</b> ${m.sources.map(s => `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title || new URL(s.url).hostname)}</a>`).join(' · ')}</div>` : ''}</div>`;
  const draw = () => {
    box.innerHTML = chat.messages.length ? chat.messages.map(drawMsg).join('') : '<div class="empty">Chiedi qualcosa: risposte specifiche per il tuo giardino, con fatti, ipotesi e consigli distinti.</div>';
    $('#sugg', view).innerHTML = chat.messages.length ? '' : SUGGEST.map(s => `<button>${esc(s)}</button>`).join('');
    $$('#sugg button', view).forEach(b => b.onclick = () => { $('#q', view).value = b.textContent; send(); });
  };
  const send = async () => {
    const q = $('#q', view).value.trim();
    if (!q || !hasAI()) return;
    $('#q', view).value = '';
    chat.messages.push({ role: 'user', text: q });
    draw();
    const div = document.createElement('div'); div.className = 'msg assistant'; div.innerHTML = '<span class="spinner"></span>';
    box.appendChild(div); div.scrollIntoView({ block: 'end', behavior: 'smooth' });
    $('#send', view).disabled = true;
    let acc = '';
    try {
      // ultimi 12 messaggi come contesto della conversazione
      const history = chat.messages.slice(-12).map(m => ({ role: m.role, content: m.text }));
      const r = await chatStream({ history, webSearch: $('#ws', view).checked, onText: (t) => { acc += t; div.innerHTML = richText(acc); } });
      chat.messages.push({ role: 'assistant', text: r.text || acc, sources: r.sources });
      await db.put('chats', chat);
    } catch (e) {
      chat.messages.pop();
      toast(e.message, 5000);
      $('#q', view).value = q;
    }
    $('#send', view).disabled = false;
    draw(); box.lastElementChild?.scrollIntoView({ block: 'end' });
  };
  $('#send', view).onclick = send;
  $('#q', view).addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } });
  $('#ws', view).onchange = (e) => saveSettings({ webSearch: e.target.checked });
  $('#clr', view).onclick = async () => { if (chat.messages.length && !await confirmDialog('Iniziare una nuova conversazione? Quella attuale sarà cancellata.')) return; chat.messages = []; await db.put('chats', chat); draw(); };
  draw();
}
