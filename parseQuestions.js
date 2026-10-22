const fs = require('fs');
const path = require('path');

/**
 * Parses the questionsAndAnswers.md file into a structured array of questions.
 *
 * Expected markdown format (indentation is ignored):
 *   - Question text?
 *     a. Option one (correct)
 *     b. Option two
 *     ...
 *
 * A new question starts on any list line ("- ...") that is NOT an option
 * (options start with a single letter followed by ". ", e.g. "a. ").
 * The option containing the literal "(correct)" marker is the right answer.
 */
function parseQuestions(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const lines = raw.split(/\r?\n/);

  const questions = [];
  let current = null;

  const optionRegex = /^([a-z])\.\s+(.*)$/i;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line === '') continue;

    // Strip a leading markdown list marker ("- " or "* ") if present.
    const listMatch = line.match(/^[-*]\s+(.*)$/);
    const content = listMatch ? listMatch[1].trim() : line;

    const optMatch = content.match(optionRegex);

    if (optMatch) {
      // This is an answer option belonging to the current question.
      if (!current) continue; // option with no question; skip defensively

      let text = optMatch[2].trim();
      const isCorrect = /\(correct\)/i.test(text);
      // Remove the (correct) marker from the displayed text.
      text = text.replace(/\s*\(correct\)\s*/i, '').trim();

      current.options.push({ text, correct: isCorrect });
    } else {
      // This is a new question line (only when it was a list item or
      // clearly a standalone question). Finalize the previous one.
      if (listMatch || content.endsWith('?')) {
        if (current && current.options.length > 0) {
          questions.push(finalizeQuestion(current, questions.length));
        }
        current = { text: content, options: [] };
      }
      // Any other non-list, non-option line is ignored.
    }
  }

  if (current && current.options.length > 0) {
    questions.push(finalizeQuestion(current, questions.length));
  }

  return questions;
}

function finalizeQuestion(q, index) {
  const correctIndex = q.options.findIndex((o) => o.correct);
  return {
    id: index,
    text: q.text,
    options: q.options.map((o) => o.text),
    correctIndex: correctIndex === -1 ? 0 : correctIndex,
  };
}

module.exports = { parseQuestions };

// Allow running directly for a quick sanity check: node parseQuestions.js
if (require.main === module) {
  const file = path.join(__dirname, 'questionsAndAnswers.md');
  const qs = parseQuestions(file);
  console.log(`Parsed ${qs.length} questions:\n`);
  qs.forEach((q) => {
    console.log(`#${q.id + 1} ${q.text}`);
    q.options.forEach((o, i) => {
      const mark = i === q.correctIndex ? ' <- correct' : '';
      console.log(`   ${String.fromCharCode(97 + i)}. ${o}${mark}`);
    });
    console.log('');
  });
}
