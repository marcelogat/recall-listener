if (data.event === 'transcript.data') {
    // Extraer el texto de las palabras
    const words = data.data.data.words.map(w => w.text).join(' ');
    const participant = data.data.data.participant.name;
    
    console.log('🗣️ TRANSCRIPCIÓN FINAL:');
    console.log(`   Participante: ${participant}`);
    console.log(`   Texto: "${words}"`);
    console.log('---');
}

if (data.event === 'transcript.partial_data') {
    // Extraer el texto de las palabras parciales
    const words = data.data.data.words.map(w => w.text).join(' ');
    const participant = data.data.data.participant.name;
    
    console.log('⏳ Transcripción parcial:');
    console.log(`   ${participant}: "${words}"`);
}
