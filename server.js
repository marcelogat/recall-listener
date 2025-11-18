// ════════════════════════════════════════════════════════════════
// server.js - FASE 7: ESTABILIDAD Y LOG VISUAL
// ════════════════════════════════════════════════════════════════

require('dotenv').config();
const WebSocket = require('ws');
const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const fetch = require('node-fetch');

const app = express();
const port = process.env.PORT || 8080;

// ⚡ TIEMPOS
const SILENCE_THRESHOLD_MS = 600; 
const FIRST_MESSAGE_DELAY_MS = 1500; 

console.log('🚀 Servidor WebSocket: LOG VISUAL MEJORADO');

// ════════════════════════════════════════════════════════════════
// 1. SUPABASE
// ════════════════════════════════════════════════════════════════
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ FATAL: Faltan variables SUPABASE.');
  process.exit(1);
}
const supabase = createClient(supabaseUrl, supabaseKey);

// ════════════════════════════════════════════════════════════════
// 2. GESTOR DE RESPUESTA (Con Candado de Procesamiento)
// ════════════════════════════════════════════════════════════════

class StreamManager {
  constructor(agentConfig, botId, voiceConfig) {
    this.agentName = agentConfig.name;
    this.agentRole = agentConfig.role;
    this.botId = botId;
    this.voiceId = voiceConfig.id;
    this.conversationHistory = [];
    
    this.isProcessing = false; 
    this.isFirstInteraction = true; 
    this.isInterrupted = false;
  }

  addToHistory(role, text) {
    this.conversationHistory.push({ role, content: text });
    if (this.conversationHistory.length > 12) this.conversationHistory.shift();
  }

  getFormattedHistory() {
    return this.conversationHistory.map(msg => ({
      role: msg.role === this.agentName ? 'assistant' : 'user',
      content: msg.content
    }));
  }

  stop() {
    this.isInterrupted = true;
    this.isProcessing = false;
    console.log('🛑 Interrupción.');
  }

  async processUserMessage(userText) {
    if (this.isProcessing) {
        console.log('🔒 ERROR DE CONCURRENCIA: Ya estoy pensando. Ignorando input.');
        return; 
    }
    this.isProcessing = true;
    
    console.log(`\n🧠 INICIANDO PENSAMIENTO (Input: ${userText.substring(0, 40).trim()}...)...`); // 🟢 LOG INICIO
    this.addToHistory('user', userText);
    this.isInterrupted = false; 

    const systemPrompt = `
    Eres ${this.agentName}, ${this.agentRole}.
    INSTRUCCIONES:
    1. Responde de forma natural y conversacional, y siempre devuelve una pregunta o un gancho.
    2. Mantente conciso.
    3. Finaliza siempre con una pregunta o un gancho para mantener el flujo.
    `;

    try {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini', 
          messages: [
            { role: 'system', content: systemPrompt },
            ...this.getFormattedHistory()
          ],
          temperature: 0.7,
          max_tokens: 250 
        })
      });

      const data = await response.json();
      
      if (this.isInterrupted) return; 

      const fullText = data.choices[0].message.content;
      
      console.log(`✅ DECISIÓN: SPEAK`); // 🟢 LOG DECISIÓN
      console.log(`💬 TEXTO COMPLETO: "${fullText}"`); // 🟢 LOG TEXTO

      await this.generateAndSendAudio(fullText);

      if (!this.isInterrupted) {
          this.addToHistory(this.agentName, fullText);
      }

    } catch (error) {
      console.error('❌ Error Proceso:', error.message);
      // Asumimos WAIT si falla
      console.log(`⏸️ DECISIÓN: WAIT (Fallo en LLM)`); // 🟢 LOG FALLO/WAIT
    } finally {
      this.isProcessing = false;
    }
  }

  async generateAndSendAudio(text) {
    if (this.isInterrupted) return;

    if (this.isFirstInteraction) {
      console.log(`🔌 Calentando motores (${FIRST_MESSAGE_DELAY_MS}ms)...`);
      await new Promise(resolve => setTimeout(resolve, FIRST_MESSAGE_DELAY_MS));
      this.isFirstInteraction = false;
    }

    try {
      console.log(`🔊 Generando audio completo...`);
      
      const audioResp = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${this.voiceId}/stream`, {
        method: 'POST',
        headers: {
          'xi-api-key': process.env.ELEVENLABS_API_KEY,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          text: text,
          model: 'eleven_turbo_v2_5',
          voice_settings: { stability: 0.5, similarity_boost: 0.8 },
          optimize_streaming_latency: 4
        })
      });

      if (!audioResp.ok) throw new Error(`ElevenLabs: ${audioResp.status}`);
      
      const arrayBuffer = await audioResp.arrayBuffer();
      const base64Audio = Buffer.from(arrayBuffer).toString('base64');

      await fetch(`https://us-west-2.recall.ai/api/v1/bot/${this.botId}/output_audio/`, {
        method: 'POST',
        headers: { 'Authorization': `Token ${process.env.RECALL_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'mp3', b64_data: base64Audio })
      });
      
      console.log(`✅ Audio enviado.`);

    } catch (e) {
      console.error('Error Audio:', e.message);
    }
  }
}

// ════════════════════════════════════════════════════════════════
// 3. SERVIDOR WEBSOCKET
// ════════════════════════════════════════════════════════════════

const wss = new WebSocket.Server({ noServer: true });

async function loadAgent() {
  try {
    const { data: agent, error } = await supabase
      .from('agents')
      .select(`*, agent_voice_config (*)`)
      .eq('is_default', true)
      .single();

    if (error || !agent) throw new Error('Agent not found');
    const vConfig = agent.agent_voice_config?.find(v => v.is_active) || agent.agent_voice_config?.[0];
    
    return {
      agent: { name: agent.name, role: agent.agent_type },
      voice: { id: vConfig?.voice_id || 'eleven_turbo_v2_5' }
    };
  } catch (e) {
    console.error('DB Error:', e.message);
    return null;
  }
}

wss.on('connection', async (ws, req) => {
  console.log('✅ Cliente conectado');
  const config = await loadAgent();
  if (!config) { ws.close(); return; }

  let streamManager = null; 
  let botId = null;
  let currentUtterance = [];
  let silenceTimer = null;

  ws.on('message', async (data) => {
    try {
      const msg = JSON.parse(data);

      if (!botId && msg.data?.bot?.id) {
        botId = msg.data.bot.id;
        console.log(`🤖 Bot ID: ${botId}`);
        streamManager = new StreamManager(config.agent, botId, config.voice);
      }

      if ((msg.event || msg.type) === 'transcript.data') {
        const words = msg.data.data?.words || [];
        
        if (words.length > 0) {
          if (streamManager) streamManager.stop();
          
          if (silenceTimer) clearTimeout(silenceTimer);
          words.forEach(w => currentUtterance.push(w.text));

          silenceTimer = setTimeout(() => {
            if (currentUtterance.length > 0 && streamManager) {
              const fullText = currentUtterance.join(' ');
              currentUtterance = []; 
              streamManager.processUserMessage(fullText);
            }
          }, SILENCE_THRESHOLD_MS);
        }
      }
    } catch (e) { console.error(e); }
  });

  ws.on('close', () => {
    if (silenceTimer) clearTimeout(silenceTimer);
    if (streamManager) streamManager.stop();
    console.log('❌ Cliente desconectado');
  });
});

// ════════════════════════════════════════════════════════════════
// 4. HTTP
// ════════════════════════════════════════════════════════════════

app.get('/', (req, res) => res.send('Single Shot Core v7.0 (Stable)'));
const server = app.listen(port, () => console.log(`📡 Puerto ${port}`));

server.on('upgrade', (req, socket, head) => {
  wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req));
});
