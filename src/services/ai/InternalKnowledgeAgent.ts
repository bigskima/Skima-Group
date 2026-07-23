/**
 * SKIMA AI AGENT 9 - INTERNAL KNOWLEDGE ASSISTANT
 * Provides policy and operations answers from approved internal knowledge snippets.
 */

export interface KnowledgeArticle {
  id: string;
  title: string;
  body: string;
  tags: string[];
}

export interface KnowledgeAnswer {
  answer: string;
  matchedArticleIds: string[];
  confidence: number;
}

export class InternalKnowledgeAgent {
  public static answerQuestion(question: string, articles: KnowledgeArticle[]): KnowledgeAnswer {
    const query = question.toLowerCase();
    const scored = articles
      .map((article) => {
        const haystack = `${article.title} ${article.body} ${article.tags.join(' ')}`.toLowerCase();
        const score = query
          .split(/\s+/)
          .filter((token) => token.length > 3 && haystack.includes(token)).length;

        return { article, score };
      })
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score);

    if (!scored.length) {
      return {
        answer: 'No approved internal knowledge article matched this question.',
        matchedArticleIds: [],
        confidence: 0,
      };
    }

    const top = scored.slice(0, 3);

    return {
      answer: top.map((item) => item.article.body).join('\n\n'),
      matchedArticleIds: top.map((item) => item.article.id),
      confidence: Math.min(0.95, 0.45 + top[0].score * 0.1),
    };
  }
}
