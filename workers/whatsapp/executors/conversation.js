// Explicit dependencies keep executors independently testable.

export async function socialGreeting(context, services) {
  const { greeting, reply } = context;
if (greeting) { await reply(greeting); return true; }
}

export async function cancel(context, services) {
  const { interpretation, env, phone, reply } = context;
  const { clearOwnerSession } = services;
if (interpretation.intent === 'cancel') {
    await clearOwnerSession(env, phone);
    await reply('Listo, descarté lo que estaba pendiente.');
    return true;
  }
}

export async function capabilities(context, services) {
  const { interpretation } = context;
if (interpretation.intent === 'capabilities') {
    return { handled: false, agent: interpretation.agent, maximumFocus: interpretation.maximumFocus, replyContext:context.replyContext };
  }
}
