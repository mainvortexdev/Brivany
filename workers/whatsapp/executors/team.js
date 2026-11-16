export async function team_control(context) {
  const { interpretation, configureTeam, reply, normalized, message } = context;
  if (interpretation.intent !== 'team_control') return;
  if (typeof configureTeam !== 'function') throw new Error('El equipo autónomo no está conectado.');
  const result = await configureTeam({ action: interpretation.teamAction, agent: interpretation.teamAgent,
    goal: interpretation.personalGoal, routine: interpretation.routine, routineId: interpretation.routineId,
    ...(interpretation.teamAction==='objective_request'?{agent:interpretation.agent,objective:normalized,messageId:message.id,requiredTools:interpretation.requiredTools}: {}) });
  if(result?.acknowledgement){await reply(result.acknowledgement);return true;}
  if (typeof result === 'string') await reply(result);
  else await reply(`Equipo ${result.enabled ? 'activo' : 'pausado'} · 08:00–22:00, hora dominicana.\n${result.agents.map(agent => `${agent.name}: nivel ${agent.level}, ${agent.xp}/${agent.nextLevelXp || 'máx.'} puntos; ${agent.enabled ? 'activa' : 'pausada'}; ${agent.eventCounts.pending} pendiente(s).`).join('\n')}\n${result.focusAgent ? `Seguimiento personal a cargo de ${result.focusAgent}.` : 'Solo una integrante abrirá conversación a la vez.'}`);
  return true;
}
