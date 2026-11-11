'use strict';
// No network connection is opened until sendMail is called by the outbox.
function createGmailTransport(password, nodemailer = require('nodemailer')) {
  if (typeof password !== 'string' || !password.trim() || /[\r\n\0]/.test(password)) throw TypeError('Invalid mail configuration');
  const transport = nodemailer.createTransport({
    host: 'smtp.gmail.com', port: 465, secure: true,
    auth: { user: 'jacob@appelbaums.com', pass: password },
    tls: { rejectUnauthorized: true, servername: 'smtp.gmail.com', minVersion: 'TLSv1.2' },
    connectionTimeout: 15000, greetingTimeout: 10000, socketTimeout: 30000, dnsTimeout: 10000,
    logger: false, debug: false, disableFileAccess: true, disableUrlAccess: true
  });
  return Object.freeze({
    async sendMail(mail) {
      try { return await transport.sendMail(mail); }
      catch (error) {
        const safe = new Error('Mail transport failed');
        safe.permanent = Number.isInteger(error?.responseCode) && error.responseCode >= 500 && error.responseCode < 600;
        throw safe;
      }
    },
    close() { transport.close(); }
  });
}
module.exports = { createGmailTransport };
