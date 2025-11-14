const WebSocket = require('ws');
const express = require('express');
const app = express();

const PORT = process.env.PORT || 10000;

const server = app.listen(PORT, () => {
    console.log('--- Servidor "Oído" iniciado ---');
    console.log(`--- Escuchando en el puerto ${PORT} ---`);
});

const wss = new WebSocket.Server({ server });

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
                // Si no es JSON solo mostramos el mensaje
            }
            
        } catch (error) {
            console.error('❌ ERROR al procesar el mensaje:', error);
        }
    });
    
    ws.on('close', () => {
        console.log('<<< Cliente desconectado.');
    });
    
    ws.on('error', (error) => {
        console.error('❌ ERROR de WebSocket:', error);
    });
});

console.log('✅ Servidor WebSocket listo para recibir conexiones de Recall.ai');
