(() => {
  const $ = (selector) => document.querySelector(selector);
  const form = $('#auth');
  const emailStep = $('#emailStep');
  const codeStep = $('#codeStep');
  const emailInput = $('#email');
  const codeInput = $('#code');
  const error = $('#error');
  const submit = form.querySelector('button[type="submit"]');
  let email = '';
  document.documentElement.dataset.loginReady = 'true';
  form.noValidate = true;

  async function api(path, options = {}) {
    const response = await fetch(path, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'No se pudo completar la solicitud.');
    return data;
  }

  function pending(isPending) {
    submit.disabled = isPending;
    submit.textContent = isPending ? 'Verificando…' : codeStep.classList.contains('hidden') ? 'Continuar' : 'Verificar';
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    error.textContent = '';
    pending(true);
    try {
      if (!emailStep.classList.contains('hidden')) {
        email = emailInput.value.trim();
        if (!email || !emailInput.validity.valid) throw new Error('Escribe una dirección de correo válida.');
        await api('/api/auth/request', { method: 'POST', body: JSON.stringify({ email }) });
        emailStep.classList.add('hidden');
        codeStep.classList.remove('hidden');
        $('#title').textContent = 'Verifica el código.';
        $('#copy').textContent = 'Introduce el código temporal para continuar.';
        codeInput.focus();
      } else {
        await api('/api/auth/verify', { method: 'POST', body: JSON.stringify({ email, code: codeInput.value.trim() }) });
        window.location.assign('/workspace');
      }
    } catch (requestError) {
      error.textContent = requestError.message;
    } finally {
      pending(false);
    }
  });

  $('#back').addEventListener('click', () => {
    codeStep.classList.add('hidden');
    emailStep.classList.remove('hidden');
    codeInput.value = '';
    emailInput.focus();
  });
})();
