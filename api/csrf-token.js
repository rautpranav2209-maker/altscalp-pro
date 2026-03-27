/**
 * AltScalp PRO — CSRF Token Issuance Endpoint (Vercel Serverless)
 * Issues a CSRF token cookie and returns the token value.
 */

'use strict';

const { issueCsrfToken } = require('./middleware/csrf');

module.exports = issueCsrfToken;
