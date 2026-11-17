'use strict';

// Entry point reconocido por el preset Express de Vercel.
// No se llama listen(): Vercel gestiona el ciclo de vida de la Function.
// server.js sigue siendo la entrada de escritorio y conserva Socket.IO local.
module.exports = require('./server').app;
