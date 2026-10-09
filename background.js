function sanitizeFileName(name) {
  let clean = name.replace(/[^a-z0-9а-яё\-_]/gi, '_').substring(0, 60).trim();
  if (!clean || /^_+$/.test(clean)) {
    clean = "article_" + Date.now();
  }
  return clean;
}

function sanitizeImageFileName(url) {
  try {
    const cleanUrl = url.split('?')[0].split('#')[0];
    let fileName = cleanUrl.split('/').pop();
    if (!fileName || !fileName.includes('.')) {
      return `img_${Math.abs(url.split('').reduce((a, b) => ((a << 5) - a) + b.charCodeAt(0), 0))}.jpg`;
    }
    
    const ext = fileName.split('.').pop().toLowerCase();
    const validExts = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'];
    const safeExt = validExts.includes(ext) ? ext : 'jpg';
    
    let base = fileName.substring(0, fileName.lastIndexOf('.'));
    base = base.replace(/[^a-z0-9а-яё\-_]/gi, '_').substring(0, 50);
    
    return `${base}.${safeExt}`;
  } catch (e) {
    return `img_${Date.now()}.jpg`;
  }
}

function convertTableToMarkdown(table) {
  try {
    const rows = Array.from(table.querySelectorAll('tr'));
    if (rows.length === 0) return '';

    const cleanCell = (cell) => {
      let text = cell.innerHTML
        .replace(/<br\s*\/?>/gi, ' ')
        .replace(/<[^>]+>/g, '')
        .replace(/\s+/g, ' ')
        .trim();
      text = text.replace(/\|/g, '\\|');
      return text || ' ';
    };

    const alignments = [];
    const headerRow = rows.find(r => r.querySelector('th')) || rows[0];
    const headerCells = headerRow.querySelectorAll('th, td');
    
    headerCells.forEach(cell => {
      const align = cell.getAttribute('align') || cell.style?.textAlign || 'left';
      alignments.push(align.toLowerCase());
    });

    const mdRows = [];
    rows.forEach((row, rowIndex) => {
      const cells = row.querySelectorAll('td, th');
      const cellTexts = Array.from(cells).map(cleanCell);

      while (cellTexts.length < alignments.length) {
        cellTexts.push(' ');
      }

      mdRows.push('| ' + cellTexts.join(' | ') + ' |');

      if (rowIndex === 0) {
        const separator = alignments.map(align => {
          if (align === 'center') return ':---:';
          if (align === 'right') return '---:';
          return '---';
        });
        mdRows.push('| ' + separator.join(' | ') + ' |');
      }
    });

    return '\n\n' + mdRows.join('\n') + '\n\n';
  } catch (e) {
    console.error("[convertTableToMarkdown] Ошибка:", e);
    return '';
  }
}

async function downloadFile(url, filename) {
  return new Promise((resolve, reject) => {
    browser.downloads.download({ url, filename, saveAs: false }, (downloadId) => {
      if (browser.runtime.lastError) {
        reject(new Error(browser.runtime.lastError.message));
      } else {
        resolve(downloadId);
      }
    });
  });
}

browser.runtime.onConnect.addListener((port) => {
  if (port.name !== 'clipper') return;

  port.onMessage.addListener(async (msg) => {
    if (msg.action !== 'start') return;

    const safeSend = (obj) => {
      try {
        port.postMessage(obj);
      } catch (e) {
        console.warn("[background] Порт закрыт, не могу отправить:", obj);
      }
    };

    const sendStatus = (text) => safeSend({ type: 'status', text });
    const sendError = (text) => {
      console.error("[CRITICAL ERROR]", text);
      safeSend({ type: 'error', text });
    };
    const sendDone = (text) => safeSend({ type: 'done', text });
    const sendMeta = (data) => safeSend({ type: 'metadata', data });

    try {
      sendStatus('Запуск...');
      console.log("[background] Процесс запущен");

      // 🔥 ПРОВЕРКА: существуют ли библиотеки
      if (typeof TurndownService === 'undefined') {
        throw new Error("TurndownService не загружен. Проверьте manifest.json");
      }
      if (typeof turndownPluginGfm === 'undefined') {
        console.warn("[background] turndownPluginGfm не найден, таблицы могут работать некорректно");
      }

      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      if (!tab) throw new Error('Не удалось получить активную вкладку');

      sendStatus('Внедрение скриптов...');
      console.log("[background] Внедрение в:", tab.url);

      try {
        await browser.scripting.executeScript({
          target: { tabId: tab.id },
          files: ["lib/Readability-readerable.js", "lib/Readability.js", "content.js"]
        });
      } catch (e) {
        throw new Error("Сайт блокирует скрипты (CSP). Обновите страницу (F5) и попробуйте снова.");
      }

      sendStatus('Анализ страницы...');
      const response = await browser.tabs.sendMessage(tab.id, { action: "clipPage" });

      if (!response || response.error) {
        throw new Error(response?.error || 'Пустой ответ от страницы');
      }

      const { html, metadata } = response;
      if (!html || html.length < 200) {
        throw new Error("Извлеченный HTML слишком короткий.");
      }

      sendMeta(metadata);
      sendStatus('Подготовка контента...');

      const safeFolderName = sanitizeFileName(metadata.title);
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');

      const images = doc.querySelectorAll('img');
      const imageDownloadPromises = [];
      let downloadedCount = 0;
      const totalImages = images.length;
      const usedFileNames = new Set();

      console.log(`[Images] Найдено: ${totalImages}`);

      for (let i = 0; i < images.length; i++) {
        const img = images[i];
        let src = img.src || img.dataset.src || img.getAttribute('data-original');
        
        if (!src) continue;

        let absoluteSrc = src;
        try {
          absoluteSrc = new URL(src, tab.url).href;
        } catch (e) {
          continue;
        }

        if (!absoluteSrc.startsWith('http')) continue;
        if (absoluteSrc.includes('pixel') || absoluteSrc.includes('icon') || absoluteSrc.includes('1x1') || absoluteSrc.includes('spacer')) continue;

        let fileName = sanitizeImageFileName(absoluteSrc);
        let counter = 1;
        while (usedFileNames.has(fileName)) {
          const ext = fileName.includes('.') ? '.' + fileName.split('.').pop() : '.jpg';
          const base = fileName.includes('.') ? fileName.substring(0, fileName.lastIndexOf('.')) : fileName;
          fileName = `${base}_${counter}${ext}`;
          counter++;
        }
        usedFileNames.add(fileName);

        const relativePath = `./${fileName}`;
        const downloadPath = `${safeFolderName}/${fileName}`;

        const downloadPromise = (async () => {
          try {
            const resp = await fetch(absoluteSrc, {
              headers: { 'Referer': tab.url }
            });
            
            if (resp.ok) {
              const blob = await resp.blob();
              const objectUrl = URL.createObjectURL(blob);
              await downloadFile(objectUrl, downloadPath);
              await new Promise(r => setTimeout(r, 100));
              URL.revokeObjectURL(objectUrl);

              img.src = relativePath;
              img.removeAttribute('srcset');
              
              downloadedCount++;
              sendStatus(`Картинки: ${downloadedCount}/${totalImages}`);
            } else {
              throw new Error(`HTTP ${resp.status}`);
            }
          } catch (err) {
            console.warn(`[Skip] ${absoluteSrc}: ${err.message}`);
          }
        })();
        imageDownloadPromises.push(downloadPromise);
      }

      if (imageDownloadPromises.length > 0) {
        sendStatus(`Скачивание ${totalImages} картинок...`);
        await Promise.all(imageDownloadPromises);
      }

      sendStatus('Генерация Markdown...');

      const turndownService = new TurndownService({
        headingStyle: 'atx',
        codeBlockStyle: 'fenced',
        bulletListMarker: '-',
        hr: '---',
        blankReplacement: (content, node) => node.isBlock ? '\n\n' : ''
      });
      
      // 🔥 Безопасное подключение GFM
      if (typeof turndownPluginGfm !== 'undefined') {
        try {
          turndownService.use(turndownPluginGfm.gfm || turndownPluginGfm);
        } catch (e) {
          console.warn("[background] Не удалось подключить turndownPluginGfm:", e);
        }
      }
      
      turndownService.addRule('images', {
        filter: 'img',
        replacement: function (content, node) {
          const alt = node.alt ? node.alt.replace(/(\r\n|\n|\r)/g, ' ').trim() : '';
          const src = node.getAttribute('src') || '';
          if (!src) return '';
          return `![${alt}](${src})`;
        }
      });

      turndownService.addRule('customTable', {
        filter: 'table',
        replacement: (content, node) => convertTableToMarkdown(node)
      });

      turndownService.remove(['script', 'style', 'noscript', 'iframe', 'nav', 'footer', 'header', 'form', 'picture']);

      let markdownBody = turndownService.turndown(doc.body.innerHTML);

      const lines = markdownBody.split('\n');
      const fixedLines = [];
      let buffer = '';

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line.startsWith('|')) {
          if (buffer) buffer += ' ' + line;
          else buffer = line;
          if (line.endsWith('|')) {
            buffer = buffer.replace(/\s+/g, ' ');
            fixedLines.push(buffer);
            buffer = '';
          }
        } else {
          if (buffer) {
            buffer = buffer.replace(/\s+/g, ' ');
            fixedLines.push(buffer);
            buffer = '';
          }
          fixedLines.push(lines[i]);
        }
      }
      if (buffer) {
        buffer = buffer.replace(/\s+/g, ' ');
        fixedLines.push(buffer);
      }

      markdownBody = fixedLines.join('\n');
      markdownBody = markdownBody.replace(/\n{3,}/g, '\n\n');
      markdownBody = markdownBody.replace(/\|\|/g, '| |');

      const tagsString = metadata.tags.map(t => `"${t.replace(/"/g, '\\"')}"`).join(', ');
      const frontmatter = `---
title: "${metadata.title.replace(/"/g, '\\"')}"
author: "${metadata.author}"
date: ${metadata.date}
url: ${metadata.url}
tags: [${tagsString}]
---

`;

      const finalMd = frontmatter + markdownBody;
      sendStatus('Сохранение файла...');
      
      const mdFileName = `${safeFolderName}/${safeFolderName}.md`;
      const mdBlob = new Blob([finalMd], { type: 'text/markdown;charset=utf-8' });
      const mdObjectUrl = URL.createObjectURL(mdBlob);

      await downloadFile(mdObjectUrl, mdFileName);
      await new Promise(r => setTimeout(r, 200));
      URL.revokeObjectURL(mdObjectUrl);

      sendDone(`✅ Готово: ${safeFolderName}/ (${downloadedCount}/${totalImages} карт.)`);

    } catch (error) {
      console.error("[FATAL ERROR]", error);
      sendError(error.message || 'Неизвестная критическая ошибка');
    }
  });
});