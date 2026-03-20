export const DEFAULT_ROOMS = [
  { name: 'General', description: 'Sala abierta para conversar en cualquier idioma, presentarte y practicar libremente.', language: '', level: '', type: 'public', is_default: 1 },
  { name: 'Español', description: 'Espacio para todos los niveles: practica español con conversación real, dudas y correcciones amigables.', language: 'es', level: '', type: 'public', is_default: 1 },
  { name: 'English', description: 'Room for all levels: practice everyday English, ask questions, and get supportive corrections.', language: 'en', level: '', type: 'public', is_default: 1 },
  { name: 'Português', description: 'Sala para todos os níveis: pratique português com conversas reais e correções da comunidade.', language: 'pt', level: '', type: 'public', is_default: 1 },
];

export const DAILY_PROMPTS = {
  es: ['Describe tu comida favorita con 5 oraciones 🍕', 'Habla sobre tu último viaje o el viaje soñado ✈️', 'Explica un chiste de tu país 😄', '¿Qué serie estás viendo? ¿Por qué la recomiendas? 📺', 'Describe tu ciudad en 3 palabras 🌆'],
  en: ['Describe your favorite meal in 5 sentences 🍕', 'Talk about your last trip or dream destination ✈️', 'Tell a joke from your country 😄', 'What series are you watching? Why do you recommend it? 📺', 'Describe your city in 3 words 🌆'],
  pt: ['Descreva sua comida favorita em 5 frases 🍕', 'Fale sobre sua última viagem ou destino dos sonhos ✈️', 'Conte uma piada do seu país 😄', 'Que série você está vendo? Por que recomenda? 📺', 'Descreva sua cidade em 3 palavras 🌆'],
};

export async function seedRooms(db) {
  for (const room of DEFAULT_ROOMS) {
    await db.execute({
      sql: 'INSERT OR IGNORE INTO rooms (name, description, language, level, type, is_default) VALUES (?, ?, ?, ?, ?, ?)',
      args: [room.name, room.description, room.language, room.level, room.type, room.is_default],
    });
  }

  for (const [lang, prompts] of Object.entries(DAILY_PROMPTS)) {
    const prompt = prompts[new Date().getDay() % prompts.length];
    await db.execute({
      sql: `UPDATE rooms SET daily_prompt = ?, prompt_updated_at = CURRENT_TIMESTAMP WHERE language = ? AND daily_prompt = ''`,
      args: [prompt, lang],
    });
  }
}
