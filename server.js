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

// Buffer para acumular frases
let conversationBuffer = [];
let timeoutId = null;
const SILENCE_TIMEOUT = 3000; // 3 segundos de silencio

function processCompleteUtterance() {
    if (conversationBuffer.length === 0) return;
    
    // Unir todas las frases del buffer
    const completeText = conversationBuffer.map(item => item.text).join(' ');
    const participant = conversationBuffer[0].participant;
    
    console.log('');
    console.log('═══════════════════════════════════════');
    console.log('⏸️  PAUSA DETECTADA - TURNO COMPLETO');
    console.log('═══════════════════════════════════════');
    console.log(`👤 ${participant}:`);
    console.log(`   "${completeText}"`);
    console.log('');
    console.log('🤖 >>> MOMENTO DE LLAMAR A LA IA <<<');
    console.log('═══════════════════════════════════════');
    console.log('');
    
    // TODO: Aquí enviarías a OpenAI y generarías respuesta
    
    // Limpiar buffer
    conversationBuffer = [];
}

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
                    
                    // Mostrar fragmentos mientras habla
                    console.log(`📝 ${participant}: "${words}"`);
                    
                    // Agregar al buffer
                    conversationBuffer.push({
                        text: words,
                        participant: participant,
                        timestamp: new Date()
                    });
                    
                    // Cancelar timeout anterior
                    if (timeoutId) {
                        clearTimeout(timeoutId);
                    }
                    
                    // Iniciar nuevo timeout
                    timeoutId = setTimeout(() => {
                        processCompleteUtterance();
                    }, SILENCE_TIMEOUT);
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
        // Procesar lo que quedó en el buffer
        if (conversationBuffer.length > 0) {
            processCompleteUtterance();
        }
    });
    
    ws.on('error', (error) => {
        console.error('❌ ERROR de WebSocket:', error);
    });
});

console.log('✅ Servidor WebSocket listo para recibir conexiones de Recall.ai');
