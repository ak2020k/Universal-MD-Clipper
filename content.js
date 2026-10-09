function extractTagsFromText(text) {
  const stopWords = new Set([
    'и', 'в', 'во', 'не', 'что', 'он', 'на', 'я', 'с', 'со', 'как', 'а', 'то', 'все', 'она', 'так', 'его', 'но', 'да', 'ты', 'к', 'у', 'же', 'вы', 'за', 'бы', 'по', 'только', 'ее', 'мне', 'было', 'вот', 'от', 'меня', 'еще', 'нет', 'о', 'из', 'ему', 'теперь', 'когда', 'даже', 'ну', 'вдруг', 'ли', 'если', 'уже', 'или', 'ни', 'быть', 'был', 'него', 'до', 'вас', 'нибудь', 'опять', 'уж', 'вам', 'ведь', 'там', 'потом', 'себя', 'ничего', 'ей', 'может', 'они', 'тут', 'где', 'есть', 'надо', 'ней', 'для', 'мы', 'тебя', 'их', 'чем', 'была', 'сам', 'чтоб', 'без', 'будто', 'чего', 'раз', 'тоже', 'себе', 'под', 'будет', 'ж', 'тогда', 'кто', 'этот', 'того', 'потому', 'этого', 'какой', 'совсем', 'ним', 'здесь', 'этом', 'один', 'почти', 'мой', 'тем', 'чтобы', 'нее', 'сейчас', 'были', 'куда', 'зачем', 'всех', 'никогда', 'можно', 'при', 'наконец', 'два', 'об', 'другой', 'хоть', 'после', 'над', 'больше', 'тот', 'через', 'эти', 'нас', 'про', 'всего', 'них', 'какая', 'много', 'разве', 'три', 'эту', 'моя', 'впрочем', 'хорошо', 'свою', 'этой', 'перед', 'иногда', 'лучше', 'чуть', 'том', 'нельзя', 'такой', 'им', 'более', 'всегда', 'конечно', 'всю', 'между',
    'the', 'and', 'to', 'of', 'a', 'in', 'is', 'that', 'it', 'on', 'you', 'this', 'for', 'but', 'with', 'are', 'have', 'be', 'at', 'or', 'as', 'was', 'so', 'if', 'out', 'not'
  ]);

  const words = text.toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(w => w.length > 4 && !stopWords.has(w));

  const frequency = {};
  words.forEach(w => { frequency[w] = (frequency[w] || 0) + 1; });

  return Object.entries(frequency)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(entry => entry[0]);
}

function extractMetadata() {
  const doc = document;
  let title = doc.title || 'Без названия';
  let author = 'Неизвестен';
  let date = new Date().toISOString().split('T')[0];
  let tags = [];

  const getMeta = (prop) => doc.querySelector(`meta[property="${prop}"]`)?.content || null;
  const getNameMeta = (name) => doc.querySelector(`meta[name="${name}"]`)?.content || null;

  if (getMeta('og:title')) title = getMeta('og:title');
  if (getMeta('article:author')) author = getMeta('article:author');
  if (getMeta('article:published_time')) date = getMeta('article:published_time').split('T')[0];
  
  const ogTags = doc.querySelectorAll('meta[property="article:tag"]');
  if (ogTags.length > 0) tags = Array.from(ogTags).map(t => t.content.trim());

  const jsonLd = doc.querySelector('script[type="application/ld+json"]');
  if (jsonLd && tags.length === 0) {
    try {
      const data = JSON.parse(jsonLd.textContent);
      const article = Array.isArray(data) ? data.find(d => d['@type'] === 'Article' || d['@type'] === 'BlogPosting') : data;
      if (article) {
        if (article.author) author = typeof article.author === 'string' ? article.author : (article.author.name || author);
        if (article.datePublished) date = article.datePublished.split('T')[0];
        if (article.keywords) {
          tags = typeof article.keywords === 'string' ? article.keywords.split(',').map(k => k.trim()) : article.keywords;
        }
      }
    } catch (e) {}
  }

  if (tags.length === 0) {
    const metaKeywords = getNameMeta('keywords');
    if (metaKeywords) tags = metaKeywords.split(',').map(k => k.trim());
  }

  return { title, author, date, tags, url: window.location.href };
}

browser.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "clipPage") {
    try {
      // 🔥 ШАГ 1: Считаем ВСЕ картинки ДО любой обработки
      const allImagesBefore = document.querySelectorAll('img').length;
      console.log(`[content.js] Картинок на странице до обработки: ${allImagesBefore}`);
      
      // 🔥 ШАГ 2: Модифицируем ОРИГИНАЛЬНЫЙ документ (для fallback)
      // Превращаем все относительные пути в абсолютные
      document.querySelectorAll('img').forEach(img => {
        let realSrc = img.currentSrc || img.dataset.src || img.getAttribute('data-original') || img.src;
        if (!realSrc || realSrc.includes('placeholder') || realSrc.includes('1x1') || realSrc.includes('spacer')) {
          const srcset = img.getAttribute('srcset');
          if (srcset) realSrc = srcset.split(',')[0].trim().split(' ')[0];
        }
        if (realSrc) {
          try {
            realSrc = new URL(realSrc, window.location.href).href;
            img.src = realSrc;
          } catch (e) {
            console.warn("[content.js] Не удалось создать URL:", realSrc);
          }
        }
      });

      let articleContent = null;
      let textContent = "";
      let useFallback = false;

      // 🔥 ШАГ 3: Пробуем Readability
      if (typeof isProbablyReaderable !== 'undefined' && typeof Readability !== 'undefined') {
        if (isProbablyReaderable(document)) {
          const parsed = new Readability(document.cloneNode(true)).parse();
          if (parsed && parsed.content.length > 500) {
            // 🔥 ПРОВЕРКА: сколько картинок осталось после Readability?
            const imgMatches = parsed.content.match(/<img/g);
            const readabilityImages = imgMatches ? imgMatches.length : 0;
            
            console.log(`[content.js] Readability оставил картинок: ${readabilityImages} из ${allImagesBefore}`);
            
            // Если Readability вырезал больше половины картинок — используем fallback
            if (allImagesBefore > 0 && readabilityImages < allImagesBefore * 0.5) {
              console.log(`[content.js] ⚠️ Readability вырезал слишком много картинок, переключаемся на fallback`);
              useFallback = true;
            } else {
              articleContent = parsed.content;
              textContent = parsed.textContent;
            }
          }
        }
      }

      // 🔥 ШАГ 4: FALLBACK — берём main/article/body с умной очисткой
      if (useFallback || !articleContent) {
        console.log("[content.js] 🔄 Используем fallback (main/article/body с очисткой)");
        
        const mainNode = document.querySelector('main') || 
                         document.querySelector('article') || 
                         document.querySelector('[role="main"]') ||
                         document.querySelector('.article-content') ||
                         document.querySelector('.post-content') ||
                         document.querySelector('.entry-content') ||
                         document.body;

        const clone = mainNode.cloneNode(true);
        
        // Удаляем явный мусор
        const junkSelectors = [
          'nav', 'footer', 'header', 'aside', 
          'script', 'style', 'noscript', 'iframe',
          '.sidebar', '.comments', '.related', '.social-share',
          '.advertisement', '.ads', '.banner',
          '[role="navigation"]', '[role="complementary"]',
          '.share-buttons', '.social-links', '.breadcrumbs'
        ];
        
        junkSelectors.forEach(selector => {
          clone.querySelectorAll(selector).forEach(el => el.remove());
        });

        articleContent = clone.innerHTML;
        textContent = clone.innerText;
      }

      // 🔥 ШАГ 5: Извлекаем метаданные
      let metadata = extractMetadata();
      if (metadata.tags.length === 0 && textContent) {
        metadata.tags = extractTagsFromText(textContent);
      }

      const finalImgCount = (articleContent.match(/<img/g) || []).length;
      console.log(`[content.js] ✅ Отправляем HTML длиной: ${articleContent.length}, картинок: ${finalImgCount}`);
      
      sendResponse({ 
        success: true, 
        html: articleContent, 
        textContent: textContent,
        metadata 
      });
    } catch (error) {
      console.error("[MD Clipper content.js] Критическая ошибка:", error);
      sendResponse({ error: error.message });
    }
    return true;
  }
});