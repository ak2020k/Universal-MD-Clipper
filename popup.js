document.addEventListener('DOMContentLoaded', () => {
  const clipButton = document.getElementById('clip-button');
  const metadataBlock = document.getElementById('metadata-block');
  const statusBlock = document.getElementById('status-block');
  const statusText = document.getElementById('status-text');
  const resultBlock = document.getElementById('result-block');
  const resultText = document.getElementById('result-text');
  const errorBlock = document.getElementById('error-block');
  const errorText = document.getElementById('error-text');

  const metaTitle = document.getElementById('meta-title');
  const metaAuthor = document.getElementById('meta-author');
  const metaDate = document.getElementById('meta-date');
  const metaTags = document.getElementById('meta-tags');

  let timeoutId = null;

  function setStatus(text) {
    statusBlock.classList.remove('hidden');
    resultBlock.classList.add('hidden');
    errorBlock.classList.add('hidden');
    statusText.textContent = text;
  }

  function hideAll() {
    statusBlock.classList.add('hidden');
    resultBlock.classList.add('hidden');
    errorBlock.classList.add('hidden');
  }

  function showMetadata(metadata) {
    metaTitle.textContent = metadata.title;
    metaAuthor.textContent = metadata.author;
    metaDate.textContent = metadata.date;

    metaTags.innerHTML = '';
    if (metadata.tags && metadata.tags.length > 0) {
      metadata.tags.forEach(tag => {
        const span = document.createElement('span');
        span.className = 'tag';
        span.textContent = tag;
        metaTags.appendChild(span);
      });
    } else {
      metaTags.textContent = '—';
    }

    metadataBlock.classList.remove('hidden');
  }

  function resetButton() {
    clipButton.disabled = false;
    clipButton.querySelector('.button-text').textContent = 'Скачать ещё раз';
    clipButton.querySelector('.button-icon').textContent = '🔄';
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
  }

  clipButton.addEventListener('click', async () => {
    clipButton.disabled = true;
    hideAll();
    setStatus('Подключение к странице...');
    console.log('[Popup] Запуск процесса...');

    try {
      const port = browser.runtime.connect({ name: 'clipper' });
      console.log('[Popup] Порт создан');

      // 🔥 Защита от зависания: если background.js не отвечает 30 секунд — показываем ошибку
      timeoutId = setTimeout(() => {
        console.error('[Popup] Таймаут: background.js не отвечает');
        hideAll();
        errorBlock.classList.remove('hidden');
        errorText.textContent = 'Превышено время ожидания. Проверьте консоль расширения (about:debugging).';
        resetButton();
        try { port.disconnect(); } catch (e) {}
      }, 30000);

      port.onMessage.addListener((msg) => {
        console.log('[Popup] Получено сообщение:', msg);
        switch (msg.type) {
          case 'status':
            setStatus(msg.text);
            break;
          case 'metadata':
            showMetadata(msg.data);
            break;
          case 'done':
            hideAll();
            resultBlock.classList.remove('hidden');
            resultText.textContent = msg.text || 'Статья успешно сохранена!';
            resetButton();
            break;
          case 'error':
            hideAll();
            errorBlock.classList.remove('hidden');
            errorText.textContent = msg.text || 'Произошла неизвестная ошибка';
            resetButton();
            break;
        }
      });

      // 🔥 Обработчик закрытия порта (если background.js упал)
      port.onDisconnect.addListener(() => {
        console.warn('[Popup] Порт закрыт. Ошибка:', browser.runtime.lastError);
        if (clipButton.disabled) {
          hideAll();
          errorBlock.classList.remove('hidden');
          errorText.textContent = 'Соединение с background.js прервано. Проверьте консоль расширения.';
          resetButton();
        }
      });

      port.postMessage({ action: 'start' });
      console.log('[Popup] Сообщение отправлено');

    } catch (error) {
      console.error('[Popup] Ошибка создания порта:', error);
      hideAll();
      errorBlock.classList.remove('hidden');
      errorText.textContent = 'Не удалось подключиться к расширению: ' + error.message;
      resetButton();
    }
  });
});