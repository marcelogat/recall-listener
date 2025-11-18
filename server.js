// ════════════════════════════════════════════════════════════════
// server.js - Sistema con Thinking Brain (CORREGIDO)
// ════════════════════════════════════════════════════════════════

require('dotenv').config();
const WebSocket = require('ws');
const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const fetch = require('node-fetch');

const app = express();
const port = process.env.PORT || 8080;

console.log('🚀 Servidor WebSocket con THINKING BRAIN');
console.log('🧠 Sistema: GPT-4o-mini inteligente');
console.log('');

// ════════════════════════════════════════════════════════════════
// SUPABASE CLIENT (Corregido para coincidir con Render)
// ════════════════════════════════════════════════════════════════

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY; // Usamos la variable que tienes en Render

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ ERROR CRÍTICO: Faltan variables de entorno de Supabase.');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// ════════════════════════════════════════════════════════════════
// THINKING BRAIN CLASS
// ════════════════════════════════════════════════════════════════

class ThinkingBrain {
  
  constructor(agentConfig, botId) {
    this.agentName = agentConfig.name;
    this.agentRole = agentConfig.role;
    this.agentVoice = agentConfig.voice_id;
    this.agentLanguage = agentConfig.language;
    this.botId = botId;
    
    this.conversationHistory = [];
    this.thoughtHistory = [];
    this.isProcessing = false;
    this.isSpeaking = false;
    
    this.state = {
      interventions: 0,
      questionsAsked: 0,
      lastSpokeAt: null,
      feedbackReceived: [],
      adjustments: {
        reduceActivity: false,
        avoidQuestions: false,
        waitLonger: false
      }
    };
    
    this.speakerNames = {};
  }
  
  async onTranscriptData(data) {
    
    const { text, speaker_id, user_name } = data;
    
    // Guardar nombres de speakers
    if (user_name && speaker_id) {
      this.speakerNames[speaker_id] = user_name;
    }
    
    // Determinar speaker
    const speaker = this.speakerNames[speaker_id] || 
                    (speaker_id === 100 ? 'Usuario1' : 
                     speaker_id === 200 ? 'Usuario2' : 
                     this.agentName);
    
    console.log(`\n📝 [${speaker}]: "${text}"`);
    
    // Agregar a historia
    this.conversationHistory.push({
      speaker,
      text,
      timestamp: Date.now()
    });
    
    // No pensar si soy yo hablando
    if (speaker === this.agentName) {
      console.log('   (Soy yo hablando, solo registro)');
      return;
    }
    
    // No pensar si ya estoy ocupado
    if (this.isProcessing || this.isSpeaking) {
      console.log('⏸️  Ocupado, esperando...');
      return;
    }
    
    // 🧠 PENSAR
    await this.think();
  }
  
  async think() {
    
    this.isProcessing = true;
    
    console.log('\n🧠 Pensando...');
    const startTime = Date.now();
    
    try {
      
      const prompt = this.buildPrompt();
      const response = await this.callGPT(prompt);
      const elapsed = Date.now() - startTime;
      
      console.log(`⏱️  Pensamiento completado en ${elapsed}ms`);
      
      await this.processThought(response);
      
    } catch (error) {
      console.error('❌ Error al pensar:', error.message);
    } finally {
      this.isProcessing = false;
    }
  }
  
  buildPrompt() {
    
    const recentTranscript = this.getRecentTranscript(180);
    const stats = this.getStats();
    
    return `
Sos ${this.agentName}, un ${this.agentRole}.

Tu personalidad: Hablás argentino, usás "vos", sos cálido/a y natural.

════════════════════════════════════════════════════════════
📊 TU COMPORTAMIENTO RECIENTE
════════════════════════════════════════════════════════════

Intervenciones: ${stats.interventions}
Preguntas hechas: ${stats.questionsAsked}
Última intervención: ${stats.timeSinceLastSpoke}
Participación: ${stats.participationRate}%

${stats.feedbackReceived.length > 0 ? `
⚠️ FEEDBACK RECIBIDO:
${stats.feedbackReceived.map(f => `- "${f}"`).join('\n')}
` : ''}

${this.state.adjustments.reduceActivity ? '🚨 AJUSTE: Reducir actividad\n' : ''}
${this.state.adjustments.avoidQuestions ? '🚨 AJUSTE: Evitar preguntas\n' : ''}

════════════════════════════════════════════════════════════
💬 CONVERSACIÓN (últimos 3 minutos)
════════════════════════════════════════════════════════════

${recentTranscript}

════════════════════════════════════════════════════════════
🧠 ANALIZA Y DECIDE
════════════════════════════════════════════════════════════

Responde en este formato:

THINK: [análisis de la situación]
SELF_CHECK: [auto-evaluación de tu comportamiento]
DECIDE: SPEAK | WAIT
CONFIDENCE: [0-10]
REASON: [por qué decidiste esto]
MESSAGE: [si SPEAK, tu mensaje en 1-2 oraciones]

CRITERIOS:

SPEAK cuando:
✅ Pregunta directa
✅ Pausa >3s tras frase completa
✅ Momento estratégico claro
✅ Agregar valor real

WAIT cuando:
⏸️ Usuario en medio de idea
⏸️ Frase incompleta
⏸️ Hablaste hace <20s
⏸️ Participación >40%
⏸️ Feedback negativo reciente
⏸️ Sin razón clara

Regla: En duda → WAIT
`;
  }
  
  async callGPT(prompt) {
    
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: 'Sos un agente conversacional que piensa antes de actuar.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.7,
        max_tokens: 400
      })
    });
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(`GPT Error: ${error.error?.message || 'Unknown'}`);
    }
    
    const data = await response.json();
    return data.choices[0].message.content;
  }
  
  async processThought(response) {
    
    const thought = this.parseThought(response);
    
    this.thoughtHistory.push({
      timestamp: Date.now(),
      ...thought
    });
    
    // MOSTRAR LOGS
    console.log('\n═══════════════════════════════════════════════════════');
    console.log('🧠 THINK:');
    console.log(`   ${thought.think}`);
    console.log('');
    console.log('🔍 SELF_CHECK:');
    console.log(`   ${thought.selfCheck}`);
    console.log('');
    console.log(`⚡ DECIDE: ${thought.decide}`);
    console.log(`💪 CONFIDENCE: ${thought.confidence}/10`);
    console.log(`📝 REASON: ${thought.reason}`);
    
    // Detectar ajustes necesarios
    if (thought.selfCheck.includes('ALERTA') || thought.selfCheck.includes('⚠️')) {
      console.log('');
      console.log('🚨 Ajustando comportamiento');
      this.applyAdjustments(thought.selfCheck);
    }
    
    // HABLAR o ESPERAR
    if (thought.decide === 'SPEAK' && thought.message) {
      
      console.log('');
      console.log('💬 MENSAJE:');
      console.log(`   "${thought.message}"`);
      console.log('═══════════════════════════════════════════════════════');
      
      await this.speak(thought.message);
      
    } else {
      
      console.log('═══════════════════════════════════════════════════════');
      console.log('⏸️  Decisión: ESPERAR');
      console.log('');
    }
  }
  
  parseThought(response) {
    
    const thinkMatch = response.match(/THINK:\s*(.+?)(?=\n\s*SELF_CHECK:|\n\s*DECIDE:|$)/s);
    const selfCheckMatch = response.match(/SELF_CHECK:\s*(.+?)(?=\n\s*DECIDE:|$)/s);
    const decideMatch = response.match(/DECIDE:\s*(SPEAK|WAIT)/i);
    const confidenceMatch = response.match(/CONFIDENCE:\s*(\d+)/);
    const reasonMatch = response.match(/REASON:\s*(.+?)(?=\n\s*MESSAGE:|$)/s);
    const messageMatch = response.match(/MESSAGE:\s*(.+)/s);
    
    return {
      think: thinkMatch?.[1]?.trim() || 'No analysis',
      selfCheck: selfCheckMatch?.[1]?.trim() || 'No self-check',
      decide: decideMatch?.[1]?.toUpperCase() || 'WAIT',
      confidence: parseInt(confidenceMatch?.[1] || '5'),
      reason: reasonMatch?.[1]?.trim() || 'No reason',
      message: messageMatch?.[1]?.trim() || ''
    };
  }
  
  applyAdjustments(selfCheck) {
    
    const lower = selfCheck.toLowerCase();
    
    if (lower.includes('muchas preguntas') || lower.includes('preguntas recientes')) {
      this.state.adjustments.avoidQuestions = true;
      console.log('   → Evitar preguntas');
    }
    
    if (lower.includes('participación alta') || lower.includes('hablando demasiado')) {
      this.state.adjustments.reduceActivity = true;
      console.log('   → Reducir actividad');
    }
    
    if (lower.includes('interrumpí') || lower.includes('interrupciones')) {
      this.state.adjustments.waitLonger = true;
      console.log('   → Esperar más');
    }
    
    const lastMessage = this.conversationHistory[this.conversationHistory.length - 1];
    if (lastMessage) {
      this.state.feedbackReceived.push(lastMessage.text);
    }
  }
  
  async speak(message) {
    
    this.isSpeaking = true;
    
    console.log('');
    console.log('🗣️  Generando audio...');
    const startTime = Date.now();
    
    try {
      
      // Generar con ElevenLabs
      const audioResponse = await fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${this.agentVoice}`,
        {
          method: 'POST',
          headers: {
            'Accept': 'audio/mpeg',
            'Content-Type': 'application/json',
            'xi-api-key': process.env.ELEVENLABS_API_KEY
          },
          body: JSON.stringify({
            text: message,
            model_id: 'eleven_turbo_v2_5',
            voice_settings: {
              stability: 0.5,
              similarity_boost: 0.75
            }
          })
        }
      );
      
      if (!audioResponse.ok) {
        throw new Error(`ElevenLabs error: ${audioResponse.status}`);
      }
      
      const audioBuffer = await audioResponse.buffer();
      const audioBase64 = audioBuffer.toString('base64');
      const audioTime = Date.now() - startTime;
      
      console.log(`✅ Audio generado en ${audioTime}ms: ${audioBase64.length} caracteres`);
      
      // Enviar a Recall.ai
      const sendResponse = await fetch(
        `https://us-west-2.recall.ai/api/v1/bot/${this.botId}/send_audio`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Token ${process.env.RECALL_API_KEY}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            audio: audioBase64
          })
        }
      );
      
      if (!sendResponse.ok) {
        throw new Error(`Recall.ai error: ${sendResponse.status}`);
      }
      
      const totalTime = Date.now() - startTime;
      console.log(`✅ Audio enviado en ${totalTime}ms total`);
      console.log('');
      
      // Actualizar stats
      this.state.interventions++;
      this.state.lastSpokeAt = Date.now();
      
      if (message.includes('?')) {
        this.state.questionsAsked++;
      }
      
      // Registrar en historia
      this.conversationHistory.push({
        speaker: this.agentName,
        text: message,
        timestamp: Date.now()
      });
      
      // Esperar antes de permitir nuevo pensamiento
      await this.sleep(2000);
      
    } catch (error) {
      console.error('❌ Error al hablar:', error.message);
    } finally {
      this.isSpeaking = false;
    }
  }
  
  getRecentTranscript(seconds) {
    const now = Date.now();
    const cutoff = now - (seconds * 1000);
    
    const recent = this.conversationHistory
      .filter(item => item.timestamp > cutoff)
      .map(item => `[${item.speaker}]: ${item.text}`)
      .join('\n');
    
    return recent || '[Sin conversación reciente]';
  }
  
  getStats() {
    const now = Date.now();
    const threeMinAgo = now - 180000;
    
    const recent = this.conversationHistory.filter(
      item => item.timestamp > threeMinAgo
    );
    
    const myMessages = recent.filter(
      item => item.speaker === this.agentName
    );
    
    const totalMessages = recent.length;
    const participationRate = totalMessages > 0
      ? Math.round((myMessages.length / totalMessages) * 100)
      : 0;
    
    const timeSinceLastSpoke = this.state.lastSpokeAt
      ? Math.round((now - this.state.lastSpokeAt) / 1000) + 's'
      : 'nunca';
    
    return {
      interventions: this.state.interventions,
      questionsAsked: this.state.questionsAsked,
      timeSinceLastSpoke,
      participationRate,
      feedbackReceived: this.state.feedbackReceived
    };
  }
  
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// ════════════════════════════════════════════════════════════════
// WEBSOCKET SERVER
// ════════════════════════════════════════════════════════════════

const wss = new WebSocket.Server({ 
  noServer: true,
  path: '/recall-webhook'
});

let brain = null;
let currentBotId = null;
let agentConfig = null;

async function loadAgentConfig() {
  try {
    console.log('🔍 Consultando tabla agents en Supabase...');
    const { data, error } = await supabase
      .from('agents')
      .select('*')
      .eq('is_default', true)
      .single();
    
    if (error) throw error;
    
    return data;
  } catch (error) {
    console.error('❌ Error cargando agente:', error.message);
    return null;
  }
}

wss.on('connection', async (ws, request) => {
  
  console.log('✅ Nueva conexión WebSocket desde:', request.socket.remoteAddress);
  
  // Cargar agente
  console.log('📥 Cargando configuración del agente...');
  agentConfig = await loadAgentConfig();
  
  if (agentConfig) {
    console.log('✅ Agente cargado:');
    console.log(`   👤 Nombre: ${agentConfig.name}`);
    console.log(`   🎭 Tipo: ${agentConfig.type || agentConfig.role}`);
    console.log(`   🗣️  Voz: ${agentConfig.voice_name}`);
    console.log(`   🧠 Sistema: THINKING BRAIN`);
  } else {
    console.log('⚠️ No se pudo cargar la configuración del agente por defecto.');
  }
  
  ws.on('message', async (data) => {
    
    try {
      const message = JSON.parse(data);
      
      // Capturar bot ID
      if (message.type === 'bot.data' && message.data?.bot_id) {
        currentBotId = message.data.bot_id;
        console.log(`🤖 Bot ID capturado: ${currentBotId}`);
        
        // Inicializar brain con bot ID
        if (agentConfig && !brain) {
          brain = new ThinkingBrain(agentConfig, currentBotId);
          console.log('🧠 Thinking Brain inicializado');
        }
      }
      
      // Ignorar partial data
      if (message.type === 'transcript.partial_data') {
        return;
      }
      
      // Procesar transcript
      if (message.type === 'transcript.data') {
        
        if (!brain) {
          console.log('⚠️  Brain no inicializado aún (Esperando configuración o Bot ID)');
          return;
        }
        
        await brain.onTranscriptData(message.data);
      }
      
    } catch (error) {
      console.error('❌ Error procesando mensaje:', error);
    }
  });
  
  ws.on('close', (code, reason) => {
    console.log('\n❌ Conexión cerrada desde:', request.socket.remoteAddress);
    console.log(`   Código: ${code}, Razón: ${reason.toString()}`);
    
    brain = null;
    currentBotId = null;
    agentConfig = null;
  });
  
  ws.on('error', (error) => {
    console.error('❌ Error en WebSocket:', error);
  });
});

// ════════════════════════════════════════════════════════════════
// HTTP SERVER
// ════════════════════════════════════════════════════════════════

app.get('/', (req, res) => {
  res.send('Recall.ai WebSocket Server - Thinking Brain 🧠');
});

const server = app.listen(port, () => {
  console.log(`📡 Servidor HTTP listo en puerto ${port}`);
});

server.on('upgrade', (request, socket, head) => {
  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit('connection', ws, request);
  });
});

console.log('\n📡 Servidor WebSocket listo - Esperando conexiones...');
console.log('🧠 Modo: THINKING BRAIN (Inteligencia GPT-4o-mini)');
console.log('');
