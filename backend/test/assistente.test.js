// Test dell'assistente virtuale: contesto della scheda, conversazione,
// risposta ripulita e chiamata all'API (con un client finto, niente rete).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  contestoScheda, conversazione, normalizzaAssistente, rispondiAssistente, ErroreAssistente, MAX_MESSAGGI
} from '../assistente.js';

const scheda = {
  fiera: { nome: 'NPE2027', date: '3-7 maggio 2027' },
  commessa: { numero: '001-2027' },
  fonti: [{ id: 'f1', file: 'NPE_Show_Rules.pdf', ruolo: 'organizzatore', pagine: 32 }],
  voci: [
    {
      id: 'altezza_max__isola', sezione: 'A', parametro: 'Altezza massima stand a isola', stato: 'confermato', valore: '20ft',
      citazioni: [{ fonte: 'f1', pagina: 2, testo: 'Maximum height: 20ft.' }], chiarimento: null
    },
    {
      id: 'appendimenti_portata_punto', sezione: 'D', parametro: 'Portata massima per punto (kg)', stato: 'non_specificato', valore: '',
      citazioni: [], chiarimento: { tipo: 'chiarito', valore: '250 kg', fonte: 'mail dell\'ente del 12/11' }
    },
    {
      id: 'orari_manifestazione', sezione: 'J', parametro: 'Orari della manifestazione', stato: 'da_verificare', valore: '9:00 a.m. – 5:00 p.m.',
      motivo: 'tabella su più righe', citazioni: [{ fonte: 'f1', pagina: 30, testo: 'Monday, May 3 9:00 a.m. – 5:00 p.m.' }],
      chiarimento: { tipo: 'in_attesa', chi: 'ufficio tecnico', dal: '13/11/2026' }
    }
  ]
};

test('contesto: ogni voce con identificativo, stato, valore, citazione con fonte e pagina', () => {
  const t = contestoScheda(scheda);
  assert.match(t, /Fiera: NPE2027 · date: 3-7 maggio 2027/);
  assert.match(t, /\[altezza_max__isola\] A · Altezza massima stand a isola — confermato — valore: 20ft/);
  assert.match(t, /«Maximum height: 20ft\.» \(NPE_Show_Rules\.pdf, p\. 2\)/);
  assert.match(t, /\[orari_manifestazione\].* — da verificare — .*motivo: tabella su più righe/);
});

test('contesto: le risposte del PM sono distinte dallo stato estratto', () => {
  const t = contestoScheda(scheda);
  assert.match(t, /\[appendimenti_portata_punto\].* — non specificato — risposta del PM: chiarito dal PM \(250 kg, fonte: mail dell'ente del 12\/11\)/);
  assert.match(t, /risposta del PM: in attesa \(da: ufficio tecnico, dal 13\/11\/2026\)/);
  assert.doesNotMatch(t, /appendimenti_portata_punto\] [^\n]*— confermato/);
});

test('contesto: testi lunghi troncati e voci non valide ignorate', () => {
  const lunga = { ...scheda, voci: [{ id: 'x', sezione: 'A', parametro: 'P', stato: 'confermato', valore: 'v'.repeat(5000), citazioni: [] }, null, { stato: 'confermato' }] };
  const t = contestoScheda(lunga);
  assert.ok(!t.includes('v'.repeat(501)));
  assert.equal(t.split('\n').filter((r) => r.startsWith('[')).length, 1);
});

test('conversazione: solo ruoli ammessi, messaggi vuoti scartati, ultimi messaggi', () => {
  const molti = Array.from({ length: 30 }, (_, i) => ({ ruolo: i % 2 ? 'assistente' : 'pm', testo: 'm' + i }));
  assert.equal(conversazione(molti).length, MAX_MESSAGGI);
  assert.deepEqual(conversazione([{ ruolo: 'sistema', testo: 'x' }, { ruolo: 'pm', testo: '  ' }, { ruolo: 'pm', testo: 'ciao' }]), [{ ruolo: 'pm', testo: 'ciao' }]);
});

test('risposta: restano solo identificativi di voci della scheda, senza doppioni', () => {
  const r = normalizzaAssistente({ messaggio: ' ok ', voci: ['altezza_max__isola', 'inventata', 'altezza_max__isola'] }, scheda);
  assert.deepEqual(r, { messaggio: 'ok', voci: ['altezza_max__isola'] });
  assert.deepEqual(normalizzaAssistente(null, scheda), { messaggio: '', voci: [] });
});

function clientFinto(risposta) {
  const chiamate = [];
  return {
    chiamate,
    beta: { messages: { create: async (p) => { chiamate.push(p); return risposta; } } }
  };
}
const ok = (dati) => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(dati) }], usage: { input_tokens: 10, output_tokens: 5 } });

test('chiamata: scheda nel primo messaggio in cache, turni alternati, risposta ripulita', async () => {
  const client = clientFinto(ok({ messaggio: 'Per lo stand a isola: 20ft, confermato (p. 2).', voci: ['altezza_max__isola', 'non_esiste'] }));
  const r = await rispondiAssistente({
    client, modello: 'm', effort: 'low', scheda,
    messaggi: [
      { ruolo: 'assistente', testo: 'benvenuto' }, // un messaggio iniziale dell'assistente viene scartato
      { ruolo: 'pm', testo: 'altezza isola?' },
      { ruolo: 'assistente', testo: '20ft' },
      { ruolo: 'pm', testo: 'e in linea?' },
      { ruolo: 'pm', testo: 'anche i corner' }
    ]
  });
  assert.deepEqual(r.voci, ['altezza_max__isola']);
  const p = client.chiamate[0];
  assert.deepEqual(p.messages.map((m) => m.role), ['user', 'assistant', 'user']);
  assert.equal(p.messages[0].content[0].cache_control.type, 'ephemeral');
  assert.match(p.messages[0].content[0].text, /\[altezza_max__isola\]/);
  assert.match(p.messages[0].content[1].text, /altezza isola\?/);
  assert.equal(p.messages[2].content, 'e in linea?\nanche i corner');
  assert.match(p.system, /Nessuna conversione di unità/);
});

test('chiamata: senza una domanda del PM in fondo, errore senza chiamare l\'API', async () => {
  const client = clientFinto(ok({ messaggio: 'x', voci: [] }));
  await assert.rejects(rispondiAssistente({ client, modello: 'm', effort: 'low', scheda, messaggi: [] }), ErroreAssistente);
  await assert.rejects(rispondiAssistente({ client, modello: 'm', effort: 'low', scheda, messaggi: [{ ruolo: 'pm', testo: 'a' }, { ruolo: 'assistente', testo: 'b' }] }), ErroreAssistente);
  assert.equal(client.chiamate.length, 0);
});

test('chiamata: risposta interrotta, rifiutata o non leggibile diventa un errore chiaro', async () => {
  const domanda = [{ ruolo: 'pm', testo: 'ciao' }];
  for (const risposta of [
    { stop_reason: 'max_tokens', content: [], usage: {} },
    { stop_reason: 'refusal', content: [], usage: {} },
    { stop_reason: 'end_turn', content: [{ type: 'text', text: 'non json' }], usage: {} }
  ]) {
    await assert.rejects(rispondiAssistente({ client: clientFinto(risposta), modello: 'm', effort: 'low', scheda, messaggi: domanda }), ErroreAssistente);
  }
});
