import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMotivationalRoutineRequest, motivationalPhrase } from '../motivational-routine.js';
import { nextDailyRoutineAt } from '../melodi-routines.js';

const REQUEST='Oye Melodi, envíame una frase motivacional corta que trate de alcanzar el éxito todos los días y en cualquier momento';
test('the reported request is a daily Melodi routine with an explicit default hour',()=>{
  const result=parseMotivationalRoutineRequest(REQUEST,'melodi');
  assert.equal(result.agent,'melodi');assert.equal(result.frequency,'daily');assert.equal(result.kind,'motivational_message');
  assert.equal(result.hour,'10:00');assert.equal(result.defaultHour,true);assert.equal(result.brief,REQUEST);
  assert.equal(nextDailyRoutineAt('2026-10-08T22:10:00Z',result.hour),'2026-10-09T14:00:00.000Z');
});
test('daily phrases respect explicit hours, stop requests and single-message boundaries',()=>{
  assert.equal(parseMotivationalRoutineRequest('Melodi, envíame un mensaje motivador cada día a las 4 pm','melodi').hour,'16:00');
  assert.equal(parseMotivationalRoutineRequest('Melodi, detén las frases diarias','melodi').action,'stop');
  assert.equal(parseMotivationalRoutineRequest('Melodi, no me envíes más frases motivacionales','melodi').action,'stop');
  assert.ok(parseMotivationalRoutineRequest('Melodi, envíame una frase motivacional cada día a las 25:00','melodi').clarification);
  for(const message of ['Envíame una frase motivacional sobre alcanzar el éxito','Crea un PDF con esto: envíame una frase motivacional todos los días',
    '"Envíame una frase motivacional todos los días"']) assert.equal(parseMotivationalRoutineRequest(message,'melodi'),null);
});
test('the phrase generator uses the assigned agent and excludes recent duplicates and stale clichés',async()=>{
  let prompt;
  const phrase=await motivationalPhrase({agent:'melodi',brief:REQUEST,now:'2026-10-08T14:00:00Z'},async(agent,_input,systemPrompt)=>{
    assert.equal(agent,'melodi');prompt=systemPrompt;return {phrase:'Termina hoy ese paso que llevas posponiendo. Ya sabes por dónde empezar.'};
  });
  assert.match(phrase,/Termina hoy/);assert.match(prompt,/Máximo 32 palabras/);
  for(const generated of [{phrase:'El éxito es el resultado de dedicación y perseverancia.'},{phrase:phrase},{phrase:'https://example.com'},{}]) {
    const replacement=await motivationalPhrase({agent:'melodi',brief:REQUEST,now:'2026-10-08T14:00:00Z',recent:[{role:'assistant',message:phrase}]},async()=>generated);
    assert.notEqual(replacement,phrase);assert.ok(replacement.length<240);assert.doesNotMatch(replacement,/dedicación y perseverancia|https:/);
  }
});
