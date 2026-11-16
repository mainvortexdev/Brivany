// Explicit dependencies keep executors independently testable.

export async function project_update(context, services) {
  const { interpretation, projects, reply, descriptor, env, phone, message, normalized } = context;
  const { resolveOwnerProject, storeIncomingMedia, saveProjectProgress, projectProgressReply } = services;
if (interpretation.intent === 'project_update') {
    const existing = resolveOwnerProject(projects, interpretation);
    if (!existing && !interpretation.projectName) {
      await reply('Puedo registrar el avance, pero necesito saber a qué proyecto pertenece. ¿Cómo se llama?');
      return true;
    }
    const reference = descriptor ? await storeIncomingMedia(env, phone, message) : null;
    const project = await saveProjectProgress(env, phone, existing, interpretation, normalized, reference);
    await reply(await projectProgressReply(env, interpretation.agent, project, normalized, reference));
    return true;
  }
}

export async function project_list(context, services) {
  const { interpretation, projects, reply } = context;
if (interpretation.intent === 'project_list') {
    if (!projects.length) {
      await reply('Aún no tengo proyectos registrados. Dime el nombre de uno y su primer avance para comenzar.');
    } else {
      await reply(`📁 *Tus proyectos*\n${projects.slice(0, 15).map((project) => `• ${project.name} — ${project.status === 'completed' ? 'completado' : project.status === 'blocked' ? 'bloqueado' : project.status === 'planning' ? 'planificación' : 'en curso'}`).join('\n')}`);
    }
    return true;
  }
}

export async function project_query(context, services) {
  const { interpretation, projects, reply, env, phone } = context;
  const { resolveOwnerProject, projectDetails } = services;
if (interpretation.intent === 'project_query') {
    const project = resolveOwnerProject(projects, interpretation);
    if (!project) {
      await reply(projects.length ? 'No encontré ese proyecto. Dime su nombre exacto o pídeme la lista de proyectos.' : 'Aún no tengo proyectos registrados. Dime el nombre y un avance para comenzar.');
      return true;
    }
    await reply(await projectDetails(env, phone, project, env.TIME_ZONE || 'America/Santo_Domingo'));
    return true;
  }
}
