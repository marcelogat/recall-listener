const WebSocket = require('ws');
const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const url = require('url'); // Para parsear la URL de conexión

const app = express();
const PORT = process.env.PORT || 10000;

// --- 1. CONFIGURACIÓN DE SUPABASE ---
// ¡Estas variables DEBEN estar en tu entorno de Render!
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

let supabase;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error('❌ ERROR: Faltan las variables de entorno SUPABASE_URL o SUPABASE_SERVICE_KEY.');
    console.log('--- El servidor se iniciará, PERO NO SE GRABARÁ NADA en la base de datos. ---');
} else {
    supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    console.log('✅ Cliente de Supabase inicializado.');
}
// --- Fin Configuración Supabase ---

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

wss.on('connection', function connection(ws, req) { // 'req' nos da la petición HTTP original
    console.log('>>> ¡CLIENTE CONECTADO! (Probablemente el bot de Recall.ai)');

    // --- 2. LÓGICA POR CONEXIÓN ---
    // Movemos el buffer y el timeout aquí. Cada conexión (reunión)
    // tendrá su propio buffer y temporizador. ¡Esto es clave!
    let conversationBuffer = [];
    let timeoutId = null;
    const SILENCE_TIMEOUT = 3000; // 3 segundos de silencio

    // --- 3. OBTENER EL MEETING_ID ---
    // Asumimos que Recall.ai se conecta con una URL como:
    // wss://tu-servidor.onrender.com?meeting_id=123e4567-e89b-12d3-a456-42661d174000
    const params = new URLSearchParams(url.parse(req.url).search);
    const meetingId = params.get('meeting_id'); // ¡Este ID es VITAL!

    if (!meetingId) {
        console.warn('⚠️ ADVERTENCIA: No se encontró "meeting_id" en la URL de conexión.');
        console.log(`   URL recibida: ${req.url}`);
        console.log('   Los fragmentos se guardarán con ID nulo o por defecto.');
    } else {
        console.log(`--- Conectado para Meeting ID: ${meetingId} ---`);
    }

    /**
     * Procesa la frase completa después de una pausa y la guarda en Supabase.
     * Esta función ahora es ASÍNCRONA para poder usar 'await' con Supabase.
     */
    async function processCompleteUtterance() {
        if (conversationBuffer.length === 0) return;
        
        // Unir todas las frases del buffer
        const completeText = conversationBuffer.map(item => item.text).join(' ');
        const participant = conversationBuffer[0].participant;
        const startTime = conversationBuffer[0].timestamp; // El timestamp de la primera palabra
        
        console.log('');
        console.log('═══════════════════════════════════════');
        console.log('⏸️  PAUSA DETECTADA - TURNO COMPLETO');
        console.log('═══════════════════════════════════════');
        console.log(`👤 ${participant}:`);
        console.log(`   "${completeText}"`);
        console.log('');
        console.log('🤖 >>> MOMENTO DE LLAMAR A LA IA (y guardar en DB) <<<');
        
        // --- 4. GUARDAR EN SUPABASE ---
        // Solo intentamos guardar si Supabase se inicializó y tenemos un meetingId
        if (supabase && meetingId) {
            console.log('... Guardando turno en Supabase ...');
            
            const { data, error } = await supabase
                .from('transcripciones') // Asegúrate que tu tabla se llame así
                .insert([
                    {
                        meeting_id: meetingId,
                        texto: completeText,
                        locutor: participant,
                        timestamp: startTime, // Usamos el timestamp de la primera palabra
                        es_final: true
                    }
                ]);

            if (error) {
                console.error('❌ ERROR al guardar en Supabase:', error.message);
            } else {
                console.log('✅ Turno guardado en Supabase.');
            }
        } else if (!supabase) {
            console.warn('   (Supabase no configurado, omitiendo guardado)');
        } else if (!meetingId) {
            console.warn('   (Falta meeting_id, omitiendo guardado)');
        }
        console.log('═══════════════════════════════════════');
        console.log('');
        
        // Limpiar buffer (el de ESTA conexión)
        conversationBuffer = [];
    }
    // --- Fin de processCompleteUtterance ---

    ws.on('message', function incoming(message) {
        try {
            const messageString = message.toString();
            
            try {
                const data = JSON.parse(messageString);
                
                if (data.event === 'transcript.data') {
                    const words = data.data.data.words.map(w => w.text).join(' ');
                    const participant = data.data.data.participant.name;
                    
                    if (words.trim().length === 0) return; // Ignorar si son solo espacios

                    console.log(`📝 ${participant}: "${words}"`);
                    
                    // Agregar al buffer (de esta conexión)
                    conversationBuffer.push({
                        text: words,
                        participant: participant,
                        timestamp: new Date()
                    });
                    
                    // Cancelar timeout anterior
                    if (timeoutId) {
                        clearTimeout(timeoutId);
                    }
                    
                    // Iniciar nuevo timeout (llama al processCompleteUtterance de esta conexión)
                    // ESTA ES LA LÍNEA CORREGIDA:
                    timeoutId = setTimeout(() => {
                        processCompleteUtterance();
                    }, SILENCE_TIMEOUT);
                }
            } catch (e) {
                // Si no es JSON, solo mostramos el mensaje
                // console.log(`Raw msg: ${messageString}`);
            }
            
        } catch (error) {
            console.error('❌ ERROR al procesar el mensaje:', error);
        }
    });
    
    ws.on('close', () => {
        console.log(`<<< Cliente desconectado (Meeting ID: ${meetingId}).`);
        // Procesar lo que quedó en el buffer antes de cerrar
        if (timeoutId) clearTimeout(timeoutId);
        if (conversationBuffer.length > 0) {
            processCompleteUtterance();
        }
    });
    
    ws.on('error', (error) => {
        console.error('❌ ERROR de WebSocket:', error);
    });
});

console.log('✅ Servidor WebSocket listo para recibir conexiones de Recall.ai');
