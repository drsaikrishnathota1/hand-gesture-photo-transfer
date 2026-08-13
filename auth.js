const express = require('express');
const crypto = require('crypto');
const { OAuth2Client } = require('google-auth-library');

function sanitizeGoogleUser(payload = {}) {
  if (!payload.sub) throw new Error('Google account ID missing');

  if (payload.email && payload.email_verified === false) {
    throw new Error('Google email is not verified');
  }

  return {
    googleSub: String(payload.sub),
    name: String(payload.name || '').slice(0, 120),
    email: String(payload.email || '').slice(0, 180),
    picture: String(payload.picture || '').slice(0, 500)
  };
}

function createAuthRouter() {
  const router = express.Router();
  const clientId = String(process.env.GOOGLE_CLIENT_ID || '').trim();
  const oauthClient = new OAuth2Client(clientId);

  router.get('/config', (req, res) => {
    req.session.loginNonce = crypto.randomBytes(24).toString('hex');

    res.setHeader('Cache-Control', 'no-store');
    res.json({
      enabled: Boolean(clientId),
      clientId,
      csrfToken: req.session.loginNonce
    });
  });

  router.get('/me', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');

    if (!req.session?.user) {
      return res.status(401).json({
        authenticated: false
      });
    }

    res.json({
      authenticated: true,
      user: req.session.user
    });
  });

  router.post('/google', express.json({ limit: '64kb' }), async (req, res) => {
    try {
      if (!clientId) {
        return res.status(503).json({
          error: 'Google Sign-In is not configured.'
        });
      }

      const csrfToken = String(req.body?.csrfToken || '');
      const expectedToken = String(req.session?.loginNonce || '');

      if (!csrfToken || !expectedToken || csrfToken !== expectedToken) {
        return res.status(403).json({
          error: 'Login request could not be validated.'
        });
      }

      const credential = String(req.body?.credential || '').trim();

      if (!credential) {
        return res.status(400).json({
          error: 'Google credential is required.'
        });
      }

      const ticket = await oauthClient.verifyIdToken({
        idToken: credential,
        audience: clientId
      });

      const payload = ticket.getPayload();
      const user = sanitizeGoogleUser(payload);

      req.session.user = user;
      req.session.loginAt = Date.now();
      delete req.session.loginNonce;

      req.session.save((error) => {
        if (error) {
          console.error('Session save failed:', error);
          return res.status(500).json({
            error: 'Unable to create login session.'
          });
        }

        res.json({
          authenticated: true,
          user
        });
      });
    } catch (error) {
      console.error('Google authentication failed:', error.message);

      res.status(401).json({
        error: 'Google Sign-In could not be verified.'
      });
    }
  });

  router.post('/logout', (req, res) => {
    if (!req.session) {
      return res.json({ ok: true });
    }

    req.session.destroy(() => {
      res.clearCookie('airgesture.sid', { path: '/' });
      res.json({ ok: true });
    });
  });

  return router;
}

module.exports = {
  createAuthRouter,
  sanitizeGoogleUser
};
