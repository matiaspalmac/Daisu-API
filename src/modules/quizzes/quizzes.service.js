import { db } from '../../config/database.js';
import { config } from '../../config/index.js';
import { NotFoundError, ValidationError, ConflictError } from '../../errors/index.js';
import { addXP } from '../achievements/achievements.service.js';
import { updateStreak } from '../../services/streaks.js';

const DAILY_QUESTIONS = {
  es: [
    { type: 'translate', prompt: "How do you say 'hello' in Spanish?", options: ['Hola', 'Adios', 'Gracias', 'Por favor'], correct: 'Hola' },
    { type: 'fill_blank', prompt: 'Yo ___ estudiante. (ser)', options: ['soy', 'es', 'eres', 'somos'], correct: 'soy' },
    { type: 'translate', prompt: "What does 'gato' mean?", options: ['Dog', 'Cat', 'Bird', 'Fish'], correct: 'Cat' },
    { type: 'grammar', prompt: 'Which is correct?', options: ['Yo tengo hambre', 'Yo tiene hambre', 'Yo tienes hambre', 'Yo tenemos hambre'], correct: 'Yo tengo hambre' },
    { type: 'vocabulary', prompt: "The opposite of 'grande' is:", options: ['pequeno', 'alto', 'rapido', 'bonito'], correct: 'pequeno' },
  ],
  en: [
    { type: 'translate', prompt: "Como se dice 'gracias' en ingles?", options: ['Thank you', 'Please', 'Sorry', 'Hello'], correct: 'Thank you' },
    { type: 'fill_blank', prompt: 'She ___ a teacher. (be)', options: ['is', 'are', 'am', 'be'], correct: 'is' },
    { type: 'grammar', prompt: 'Which is correct?', options: ['I have been there', 'I has been there', 'I have be there', 'I having been there'], correct: 'I have been there' },
    { type: 'vocabulary', prompt: "A synonym for 'happy' is:", options: ['glad', 'sad', 'angry', 'tired'], correct: 'glad' },
    { type: 'translate', prompt: "Que significa 'weather'?", options: ['Clima', 'Agua', 'Viento', 'Nube'], correct: 'Clima' },
  ],
  pt: [
    { type: 'translate', prompt: "Como se diz 'obrigado' em portugues?", options: ['Obrigado', 'Desculpa', 'Por favor', 'Ola'], correct: 'Obrigado' },
    { type: 'fill_blank', prompt: 'Eu ___ brasileiro. (ser)', options: ['sou', 'e', 'es', 'somos'], correct: 'sou' },
    { type: 'vocabulary', prompt: "O que significa 'casa'?", options: ['House', 'Car', 'Dog', 'Tree'], correct: 'House' },
    { type: 'grammar', prompt: 'Qual esta correto?', options: ['Eu gosto de musica', 'Eu gosta de musica', 'Eu gostas de musica', 'Eu gostamos de musica'], correct: 'Eu gosto de musica' },
    { type: 'translate', prompt: "How do you say 'book' in Portuguese?", options: ['Livro', 'Mesa', 'Cadeira', 'Porta'], correct: 'Livro' },
  ],
};

function todayDateStr() { return new Date().toISOString().slice(0, 10); }

function seededShuffle(arr, seed) {
  const copy = [...arr];
  let s = seed;
  for (let i = copy.length - 1; i > 0; i--) {
    s = (s * 9301 + 49297) % 233280;
    const j = Math.floor((s / 233280) * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function dayOfYear() {
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 0);
  return Math.floor((now - start) / (1000 * 60 * 60 * 24));
}

function generateDailyQuestions(language) {
  const templates = DAILY_QUESTIONS[language];
  if (!templates) return null;
  const seed = dayOfYear();
  return seededShuffle(templates, seed).map((q, idx) => ({ ...q, options: seededShuffle(q.options, seed + idx + 1) }));
}

function stripCorrectAnswers(questions) {
  return questions.map(({ correct, ...rest }) => rest);
}

export const QuizzesService = {
  async getDailyQuiz(userId, language) {
    const lang = language || 'es';
    const today = todayDateStr();

    let result = await db.execute({ sql: 'SELECT * FROM quizzes WHERE is_daily = 1 AND daily_date = ? AND language = ?', args: [today, lang] });
    let quiz = result.rows[0];

    if (!quiz) {
      const questions = generateDailyQuestions(lang);
      if (!questions) throw new ValidationError(`No quiz templates available for language: ${lang}`);
      const title = `Daily Quiz - ${lang.toUpperCase()} - ${today}`;
      const insertResult = await db.execute({
        sql: "INSERT INTO quizzes (title, language, type, questions, is_daily, daily_date) VALUES (?, ?, 'vocabulary', ?, 1, ?)",
        args: [title, lang, JSON.stringify(questions), today],
      });
      const fetchResult = await db.execute({ sql: 'SELECT * FROM quizzes WHERE id = ?', args: [Number(insertResult.lastInsertRowid)] });
      quiz = fetchResult.rows[0];
    }

    const attemptResult = await db.execute({ sql: 'SELECT id, score, total_questions FROM quiz_attempts WHERE quiz_id = ? AND user_id = ?', args: [quiz.id, userId] });
    const questions = JSON.parse(quiz.questions);

    return {
      quiz: { id: quiz.id, title: quiz.title, language: quiz.language, level: quiz.level, type: quiz.type, daily_date: quiz.daily_date, questions: stripCorrectAnswers(questions), total_questions: questions.length },
      already_attempted: attemptResult.rows.length > 0,
      previous_attempt: attemptResult.rows[0] || null,
    };
  },

  async submitAttempt(userId, quizId, answers) {
    if (!answers || typeof answers !== 'object') throw new ValidationError('answers object is required');

    const existing = await db.execute({ sql: 'SELECT id FROM quiz_attempts WHERE quiz_id = ? AND user_id = ?', args: [quizId, userId] });
    if (existing.rows.length > 0) throw new ConflictError('You have already attempted this quiz');

    const quizResult = await db.execute({ sql: 'SELECT * FROM quizzes WHERE id = ?', args: [quizId] });
    if (!quizResult.rows[0]) throw new NotFoundError('Quiz not found');

    const questions = JSON.parse(quizResult.rows[0].questions);
    const total = questions.length;
    let score = 0;
    const corrections = [];

    for (let i = 0; i < total; i++) {
      const q = questions[i];
      const userAnswer = answers[String(i)] || '';
      const isCorrect = userAnswer === q.correct;
      if (isCorrect) score++;
      corrections.push({ index: i, prompt: q.prompt, your_answer: userAnswer, correct_answer: q.correct, is_correct: isCorrect });
    }

    await db.execute({
      sql: 'INSERT INTO quiz_attempts (quiz_id, user_id, score, total_questions, answers) VALUES (?, ?, ?, ?, ?)',
      args: [quizId, userId, score, total, JSON.stringify(answers)],
    });

    const xpEarned = score * config.limits.quizXpPerCorrect;
    if (xpEarned > 0) await addXP(userId, xpEarned, 'quiz_completed', String(quizId));
    await updateStreak(userId);

    return { score, total, xpEarned, corrections };
  },

  async getResults(userId, quizId) {
    const attemptResult = await db.execute({ sql: 'SELECT * FROM quiz_attempts WHERE quiz_id = ? AND user_id = ?', args: [quizId, userId] });
    if (!attemptResult.rows[0]) throw new NotFoundError('No attempt found for this quiz');

    const quizResult = await db.execute({ sql: 'SELECT * FROM quizzes WHERE id = ?', args: [quizId] });
    if (!quizResult.rows[0]) throw new NotFoundError('Quiz not found');

    const questions = JSON.parse(quizResult.rows[0].questions);
    const userAnswers = JSON.parse(attemptResult.rows[0].answers);

    return {
      quiz_id: quizResult.rows[0].id, title: quizResult.rows[0].title, language: quizResult.rows[0].language,
      score: attemptResult.rows[0].score, total_questions: attemptResult.rows[0].total_questions, completed_at: attemptResult.rows[0].completed_at,
      results: questions.map((q, i) => ({
        index: i, type: q.type, prompt: q.prompt, options: q.options,
        correct_answer: q.correct, your_answer: userAnswers[String(i)] || '', is_correct: (userAnswers[String(i)] || '') === q.correct,
      })),
    };
  },

  async getHistory(userId) {
    const result = await db.execute({
      sql: `SELECT qa.id, qa.quiz_id, qa.score, qa.total_questions, qa.completed_at,
                   q.title, q.language, q.type, q.is_daily, q.daily_date
            FROM quiz_attempts qa JOIN quizzes q ON q.id = qa.quiz_id WHERE qa.user_id = ? ORDER BY qa.completed_at DESC LIMIT ?`,
      args: [userId, config.limits.paginationDefault],
    });
    return { history: result.rows };
  },

  async listQuizzes(query) {
    let sql = 'SELECT id, title, language, level, type, created_at FROM quizzes WHERE is_daily = 0';
    const args = [];
    if (query.language) { sql += ' AND language = ?'; args.push(query.language); }
    if (query.type) { sql += ' AND type = ?'; args.push(query.type); }
    sql += ' ORDER BY created_at DESC';
    const result = await db.execute({ sql, args });
    return { quizzes: result.rows };
  },

  async createQuiz(userId, data) {
    const { title, language, level, type, questions, is_daily, daily_date } = data;
    if (!title || !language || !questions) throw new ValidationError('title, language, and questions are required');

    let parsedQuestions;
    try {
      parsedQuestions = typeof questions === 'string' ? JSON.parse(questions) : questions;
      if (!Array.isArray(parsedQuestions) || parsedQuestions.length === 0) throw new ValidationError('questions must be a non-empty array');
    } catch (e) {
      if (e.isOperational) throw e;
      throw new ValidationError('questions must be valid JSON array');
    }

    const result = await db.execute({
      sql: 'INSERT INTO quizzes (title, language, level, type, questions, created_by, is_daily, daily_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      args: [title, language, level || '', type || 'vocabulary', JSON.stringify(parsedQuestions), userId, is_daily ? 1 : 0, daily_date || ''],
    });
    const fetchResult = await db.execute({ sql: 'SELECT * FROM quizzes WHERE id = ?', args: [Number(result.lastInsertRowid)] });
    return { quiz: fetchResult.rows[0] };
  },
};
