// Fills a line with negative, neutral and positive in proportion to their counts, labeled only for screen readers.
function fillSentimentBar(element, label, counts) {
  element.setAttribute('aria-label', `${label}: ${counts.positive} positive, ${counts.negative} negative, ${counts.neutral} neutral`);
  element.replaceChildren(...['negative', 'neutral', 'positive'].map((sentiment) => {
    const part = document.createElement('span');
    part.className = sentiment;
    part.style.flexGrow = counts[sentiment];
    return part;
  }));
}
