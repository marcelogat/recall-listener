const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

class ThinkingAgent {
  constructor(meetingId, agentConfig) {
    this.meetingId = meetingId;
    this.agent = agentConfig.agent;
    this.language = agentConfig.agent.language || 'es'; // Detectar idioma
    
    // 🧠 MEMORIA DUAL
    this.conversationBuffer = []; // Memoria de trabajo (últimos 30 msgs)
    this.fullTranscript = [];     // Memoria a largo plazo (toda la reunión)
    
    this.thinkingHistory = [];
    this.lastThinkingTime = 0;
    this.speakerStats = new Map();
    this.meetingStartTime = Date.now();
    
    // Palabras clave dinámicas según idioma
    this.keywords = this.getKeywordsByLanguage(this.language);

    console.log(`🧠 AGENTE PENSANTE (${this.language}) ACTIVADO`);
  }

  getKeywordsByLanguage(lang) {
    if (lang.startsWith('en')) {
      return {
        confusion: ['don\'t understand', 'unclear', 'confused', 'not sure', 'what do you mean'],
        objection: ['but', 'however', 'disagree', 'issue is', 'concern', 'not sure about'],
        enthusiasm: ['great', 'awesome', 'perfect', 'love it', 'brilliant', 'amazing'],
        decision: ['let\'s do', 'agreed', 'decided', 'action item', 'moving forward']
      };
    }
    // Default Español
    return {
      confusion: ['no entiendo', 'no me queda claro', 'confuso', 'no sé', 'no comprendo', 'perdón'],
      objection: ['pero', 'sin embargo', 'no estoy de acuerdo', 'el problema es', 'me preocupa'],
      enthusiasm: ['excelente', 'perfecto', 'genial', 'me encanta', 'buenísimo', 'brillante'],
      decision: ['entonces vamos', 'decidido', 'hagamos', 'acordamos', 'quedamos en']
    };
  }

  async processUtterance(fullText, metadata) {
    // No uses await aquí para no bloquear el hilo principal de audio
    this._processAsync(fullText, metadata).catch(err => console.error('❌ Error background thinking:', err));
  }

  async _processAsync(fullText, metadata) {
    const { speakerName, speakerId, isAgentSpeaking } = metadata;
    const utteranceObj = {
      speaker: speakerName,
      text: fullText,
      timestamp: Date.now(),
      isAgent: isAgentSpeaking
    };

    // 1. Guardar en ambas memorias
    this.conversationBuffer.push(utteranceObj);
    this.fullTranscript.push(utteranceObj); // <-- ESTO SOLUCIONA EL BUG DE AMNESIA

    this.updateStats(speakerId, speakerName, fullText);
    this.quickThink(fullText, speakerName, isAgentSpeaking);

    // Mantener buffer corto para el contexto inmediato de GPT
    if (this.conversationBuffer.length > 20) { // Bajado a 20 para ahorrar tokens
      this.conversationBuffer.shift();
    }

    if (this.shouldThinkNow()) {
      await this.deepThink();
    }
  }

  // ... updateStats se mantiene igual ...

  quickThink(text, speaker, isAgent) {
    if (isAgent) return; // No analizarse a sí mismo
    
    const lowerText = text.toLowerCase();
    
    // Usar keywords dinámicas
    if (this.keywords.confusion.some(w => lowerText.includes(w))) {
      console.log(`🧠 🤔 [CONFUSIÓN DETECTADA] ${speaker}`);
    }
    if (this.keywords.objection.some(w => lowerText.includes(w))) {
      console.log(`🧠 ⚠️  [OBJECIÓN DETECTADA] ${speaker}`);
    }
    if (this.keywords.enthusiasm.some(w => lowerText.includes(w))) {
      console.log(`🧠 ✨ [ENTUSIASMO DETECTADA] ${speaker}`);
    }
  }

  shouldThinkNow() {
    const now = Date.now();
    // Aumentado a 45s para ahorrar dinero
    if (now - this.lastThinkingTime < 45000) return false; 
    
    // Solo pensar si alguien habló recientemente (no pensar en silencio)
    const lastMsgTime = this.conversationBuffer[this.conversationBuffer.length - 1]?.timestamp || 0;
    if (now - lastMsgTime > 10000) return false; 

    return this.conversationBuffer.filter(m => m.timestamp > this.lastThinkingTime).length >= 3;
  }

  async deepThink() {
    try {
      const elapsed = Math.floor((Date.now() - this.meetingStartTime) / 60000);
      this.lastThinkingTime = Date.now();

      const conversationText = this.conversationBuffer
        .map(msg => `${msg.speaker}: ${msg.text}`)
        .join('\n');

      // Prompt simplificado para gpt-4o-mini
      const evaluationPrompt = `Analiza el estado actual de esta reunión.
CONTEXTO: ${elapsed} mins transcurridos.
CHAT RECIENTE:
${conversationText}

JSON Output:
{
  "situation": "breve resumen de lo que pasa ahora",
  "energy": "alta/media/baja/tensa",
  "insight": "observación clave del coach",
  "action_needed": "que debería hacer el bot si interviene ahora"
}`;

      // CAMBIO CLAVE: Usar gpt-4o-mini para el pensamiento recurrente (10x más barato)
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${OPENAI_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini', // <--- AHORRO DE COSTOS
          messages: [
            { role: 'system', content: 'Eres un analista de reuniones. Responde JSON.' },
            { role: 'user', content: evaluationPrompt }
          ],
          temperature: 0.6,
          response_format: { type: "json_object" }
        })
      });

      const data = await response.json();
      const evaluation = JSON.parse(data.choices[0].message.content);
      
      this.thinkingHistory.push({ timestamp: Date.now(), ...evaluation });
      this.displayEvaluation(evaluation);

    } catch (error) {
      console.error('🧠 ❌ Error thinking:', error.message);
    }
  }

  async getFinalThoughts() {
    try {
      console.log('🧠 🏁 Generando reporte final...');
      
      // Usar fullTranscript (ahora sí tenemos todo)
      // IMPORTANTE: Si la reunión es muy larga, gpt-4o tiene límite de 128k tokens.
      // Para MVP está bien, para prod deberías truncar si > 2 horas.
      const allConversation = this.fullTranscript
        .map(msg => `${msg.speaker}: ${msg.text}`)
        .join('\n');

      const finalPrompt = `Analiza esta reunión completa y genera un reporte ejecutivo.
      
      HISTORIAL DE PENSAMIENTOS DURANTE LA REUNION:
      ${this.thinkingHistory.map(t => `- ${t.insight}`).join('\n')}
      
      TRANSCRIPCION COMPLETA:
      ${allConversation}
      
      Genera un JSON detallado con feedback, puntos clave y rating.`;

      // Aquí SÍ usamos GPT-4o para el reporte final de calidad
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${OPENAI_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'gpt-4o', // <--- CALIDAD MÁXIMA PARA EL REPORTE
          messages: [{ role: 'user', content: finalPrompt }],
          response_format: { type: "json_object" }
        })
      });

      // ... resto del código de parseo ...
      const data = await response.json();
      return JSON.parse(data.choices[0].message.content);

    } catch (e) {
      console.error(e);
    }
  }

  // ... resto de métodos (displayEvaluation, etc) ...
}

module.exports = { ThinkingAgent };
