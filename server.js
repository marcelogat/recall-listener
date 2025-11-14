const WebSocket = require('ws');
const express = require('express');
const app = express();

const PORT = process.env.PORT || 10000;

// IMPORTANTE: Crear servidor HTTP primero
const server = app.listen(PORT, () => {
    console.log('--- Servidor "Oído" iniciado ---');
    console.log(`--- Escuchando en el puerto ${PORT} ---`);
});

// Montar WebSocket sobre el servidor HTTP
const wss = new WebSocket.Server({ server });

// Health check para que Render sepa que está vivo
app.get('/', (req, res) => {
    res.json({ 
        status: 'ok', 
        message: 'Servidor WebSocket funcionando',
        connections: wss.clients.size 
    });
});

wss.on('connection', function connection(ws) {
    console.log('>>> ¡CLIENTE CONECTADO! (Probablemente el bot de Recall.ai)');
    
    ws.on('message', function incoming(message) {
        try {
            const messageString = message.toString();
            console.log('📩 Mensaje recibido:', messageString);
            
            // Intentar parsear como JSON
            try {
                const data = JSON.parse(messageString);
                console.log('📝 Evento:', data.event);
                
                if (data.event === 'transcript.data') {
                    console.log('🗣️ Transcripción final:', data.data);
                }
                
                if (data.event === 'transcript.partial_data') {
                    console.log('⏳ Transcripción parcial:', data.data);
                }
            } catch (e) {
                // Si no es JSON, solo mostramos el mensaje
            }
