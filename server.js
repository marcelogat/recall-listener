const WebSocket = require('ws');

// Render nos da el puerto automáticamente en esta variable de entorno
const PORT = process.env.PORT || 8080;

// 1. Crear el servidor de WebSocket
const wss = new WebSocket.Server({ port: PORT });

console.log(`--- Servidor "Oído" iniciado ---`);
console.log(`--- Escuchando en el puerto ${PORT} ---`);

// 2. Esto se ejecuta CADA VEZ que un cliente (Recall.ai) se conecta
wss.on('connection', function connection(ws) {

    console.log('>>> ¡CLIENTE CONECTADO! (Probablemente el bot de Recall.ai)');

    // 3. Esto se ejecuta CADA VEZ que ese cliente nos envía un mensaje
    ws.on('message', function incoming(message) {
        try {
            const messageString = message.toString();

        
            // Por ahora, solo lo mostraremos en el log (registro)
            // En la Parte B, aquí lo guardaremos en la base de datos.
            console.log('Mensaje recibido:', messageString);
            // -----------------------------

        } catch (error) {
            console.error('ERROR al procesar el mensaje:', error);
        }
    });

    ws.on('close', () => {
        console.log('<<< Cliente desconectado.');
    });

    ws.on('error', (error) => {
        console.error('ERROR de WebSocket:', error);
    });
});
