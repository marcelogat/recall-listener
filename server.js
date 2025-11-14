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
            
            try {
                const data = JSON.parse(messageString);
                
                if (data.event === 'transcript.data') {
                    const words = data.data.data.words.map(w => w.text).join(' ');
                    const participant = data.data.data.participant.name;
                    console.log(`✅ ${participant}: "${words}"`);
                }
                
                if (data.event === 'transcript.partial_data') {
                    const words = data.data.data.words.map(w => w.text).join(' ');
                    const participant = data.data.data.participant.name;
                    console.log(`⏳ ${participant}: "${words}"`);
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
