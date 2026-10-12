const { EventEmitter } = require('events');

// Bus interno: notifica en tiempo real (SSE) a los paneles de cada empresa.
const bus = new EventEmitter();
bus.setMaxListeners(0);

const emitToCompany = (companyId, event, data) => bus.emit(`company:${companyId}`, { event, data });

module.exports = { bus, emitToCompany };
