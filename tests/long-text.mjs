/** A book-sized synthetic article catches quadratic text-map construction. */
export async function checkLongText({ evalIso, check }) {
  const result = await evalIso(`(() => {
    const article = document.createElement('article');
    article.id = 'long-text-regression';
    const sentence = 'Uzun yazının sözcükleri doğru sırayla ve kesintisiz okunabilmelidir. ';
    const expected = ('Başlangıç ' + sentence.repeat(12) + ' son sözcük.').replace(/\\s+/g, ' ').trim();
    const fragment = document.createDocumentFragment();
    for (let index = 0; index < 1000; index++) {
      const paragraph = document.createElement('p');
      paragraph.id = 'long-text-part-' + index;
      paragraph.append('Baş\\u00adlangıç  ', Object.assign(document.createElement('strong'), {textContent: sentence.repeat(12)}), '\\n son\\u200b sözcük.');
      fragment.append(paragraph);
    }
    article.append(fragment);
    document.body.prepend(article);
    try {
      const started = performance.now();
      const blocks = __sesliOkuTest.collect();
      return { ms: performance.now() - started, count: blocks.length,
        chars: blocks.reduce((sum, block) => sum + block.text.length, 0),
        exact: blocks.every((block, index) => block.id === 'long-text-part-' + index && block.text === expected && block.mapped) };
    } finally { article.remove(); }
  })()`);
  console.log(`\n  Long article extraction: ${Math.round(result.ms)} ms, ${result.chars} characters`);
  check('book-sized article preserves every paragraph, normalized character and DOM mapping', result.count === 1000 && result.chars > 750000 && result.exact, JSON.stringify(result));
  // Generous headroom for CI; the former growing-string loop stalls for tens
  // of seconds on this size, whereas a linear walk completes well below 3 s.
  check('book-sized article preparation avoids a long main-thread stall', result.ms < 3000, Math.round(result.ms) + ' ms');
}
