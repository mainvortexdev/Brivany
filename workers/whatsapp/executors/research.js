// Explicit dependencies keep executors independently testable.

export async function marketing_review(context, services) {
  const { interpretation, reply, progress, env, normalized } = context;
  const { runMarketingTeam } = services;
if (interpretation.intent === 'marketing_review') {
    const speaker = ['melodi'].includes(interpretation.agent) ? interpretation.agent : 'melodi';
    await progress(speaker === 'melodi' ? 'Voy a revisar las señales públicas verificables y te cuento qué encuentro.'
      : speaker === 'melodi' ? 'Voy a revisar las métricas disponibles de tu cuenta y te cuento qué muestran.'
        : 'Mi equipo de marketing ya está trabajando en paralelo: Melodi revisa las señales públicas y Melodi analiza los datos disponibles de tu cuenta. Te envío el informe en este mismo chat. 🌸');
    try {
      await runMarketingTeam(env, interpretation.marketingQuery || normalized, reply, speaker);
    } catch (error) {
      console.error(JSON.stringify({ event: 'marketing_team_run_error', error: error instanceof Error ? error.message : String(error) }));
      await reply('El equipo no pudo completar el informe en este intento. No voy a inventar resultados; puedes pedirme que lo vuelva a revisar. 🌸');
    }
    return true;
  }
}
