(() => {
  let authConfig = null;

  const $ = (id) => document.getElementById(id);

  async function getCurrentUser() {
    try {
      const response = await fetch('/api/auth/me', {
        credentials: 'same-origin',
        cache: 'no-store'
      });

      if (!response.ok) return null;

      const data = await response.json();
      return data.authenticated ? data.user : null;
    } catch {
      return null;
    }
  }

  function showUser(user) {
    document.body.classList.add('auth-ready');

    const gate = $('authGate');
    if (gate) gate.hidden = true;

    const userPanel = $('authUser');
    if (userPanel) userPanel.hidden = false;

    if ($('authUserName')) {
      $('authUserName').textContent = user.name || 'Google User';
    }

    if ($('authUserEmail')) {
      $('authUserEmail').textContent = user.email || '';
    }

    const picture = $('authUserPicture');

    if (picture) {
      if (user.picture) {
        picture.src = user.picture;
        picture.hidden = false;
      } else {
        picture.hidden = true;
      }
    }
  }

  function showLogin(message = '') {
    document.body.classList.remove('auth-ready');

    const gate = $('authGate');
    if (gate) gate.hidden = false;

    const userPanel = $('authUser');
    if (userPanel) userPanel.hidden = true;

    if ($('authMessage')) {
      $('authMessage').textContent = message;
    }
  }

  function waitForGoogle(timeoutMs = 10000) {
    return new Promise((resolve, reject) => {
      const started = Date.now();

      const timer = setInterval(() => {
        if (window.google?.accounts?.id) {
          clearInterval(timer);
          resolve(window.google);
          return;
        }

        if (Date.now() - started > timeoutMs) {
          clearInterval(timer);
          reject(new Error('Google Identity Services did not load.'));
        }
      }, 100);
    });
  }

  async function handleGoogleCredential(response) {
    try {
      if (!response?.credential) {
        throw new Error('Google did not return a credential.');
      }

      if ($('authMessage')) {
        $('authMessage').textContent = 'Verifying your Google account…';
      }

      const result = await fetch('/api/auth/google', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          credential: response.credential,
          csrfToken: authConfig.csrfToken
        })
      });

      const data = await result.json();

      if (!result.ok) {
        throw new Error(data.error || 'Google Sign-In failed.');
      }

      showUser(data.user);
    } catch (error) {
      console.error(error);
      showLogin(error.message || 'Unable to sign in.');
      await renderGoogleButton();
    }
  }

  async function renderGoogleButton() {
    try {
      const configResponse = await fetch('/api/auth/config', {
        credentials: 'same-origin',
        cache: 'no-store'
      });

      authConfig = await configResponse.json();

      if (!authConfig.enabled || !authConfig.clientId) {
        throw new Error('Google Sign-In is not configured on this server.');
      }

      const google = await waitForGoogle();

      google.accounts.id.initialize({
        client_id: authConfig.clientId,
        callback: handleGoogleCredential,
        ux_mode: 'popup',
        auto_select: false
      });

      const container = $('googleSignInButton');

      if (container) {
        container.innerHTML = '';

        google.accounts.id.renderButton(container, {
          type: 'standard',
          theme: 'outline',
          size: 'large',
          text: 'signin_with',
          shape: 'pill',
          width: 320
        });
      }

      if ($('authMessage')) {
        $('authMessage').textContent = '';
      }
    } catch (error) {
      console.error(error);

      if ($('authMessage')) {
        $('authMessage').textContent =
          error.message || 'Google Sign-In could not be loaded.';
      }
    }
  }

  async function logout() {
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'same-origin'
      });

      if (window.google?.accounts?.id) {
        window.google.accounts.id.disableAutoSelect();
      }
    } finally {
      window.location.reload();
    }
  }

  async function initializeAuthentication() {
    const user = await getCurrentUser();

    if (user) {
      showUser(user);
      return;
    }

    showLogin('Sign in with Google to enter the DBA 802 lab.');
    await renderGoogleButton();
  }

  document.addEventListener('DOMContentLoaded', () => {
    $('logoutBtn')?.addEventListener('click', logout);
    initializeAuthentication();
  });
})();
