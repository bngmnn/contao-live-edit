(() => {
  const frame = document.getElementById('sitePreview');
  const toggle = document.getElementById('editToggle');
  const addToggle = document.getElementById('addToggle');
  const elementPicker = document.getElementById('elementPicker');
  const pickerClose = document.getElementById('pickerClose');
  const pickerCategories = document.getElementById('pickerCategories');
  const elementSearch = document.getElementById('elementSearch');
  const label = document.getElementById('editLabel');
  const notice = document.getElementById('previewNotice');
  let noticeTimer;
  let elementCatalogLoaded = false;

  const tell = (message) => {
    notice.textContent = message;
    notice.hidden = false;
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => { notice.hidden = true; }, 3200);
  };

  const inlineControl = () => frame.contentDocument.querySelector('.slowhouse-inline-bar [data-action="toggle"]');

  const syncControls = () => {
    try {
      const control = inlineControl();
      const active = control?.getAttribute('aria-pressed') === 'true';
      label.textContent = active ? 'Editor is on' : 'Activate editor';
      toggle.classList.toggle('is-active', active);
      toggle.disabled = !control;
      toggle.title = control ? 'Turn in-page editing on or off' : 'Sign in to Contao to use the frontend editor';
      addToggle.disabled = !control || !active;
    } catch (_) {
      toggle.disabled = true;
    }
  };

  const applyEditorMode = () => {
    syncControls();
  };

  let previewObserver;
  let editorPoll;
  frame.addEventListener('load', () => {
    clearInterval(editorPoll);
    previewObserver?.disconnect();
    syncControls();

    try {
      const previewDocument = frame.contentDocument;
      previewObserver = new MutationObserver(syncControls);
      previewObserver.observe(previewDocument.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-pressed'] });
      let attempts = 0;
      editorPoll = setInterval(() => {
        applyEditorMode();
        syncControls();
        if (++attempts >= 40 || previewDocument.querySelector('.slowhouse-inline-bar [data-action="toggle"]')) {
          clearInterval(editorPoll);
        }
      }, 150);
    } catch (_) {
      toggle.disabled = true;
    }
  });

  toggle.addEventListener('click', () => {
    try {
      const control = inlineControl();
      if (!control) {
        tell('Sign in to Contao in this browser to activate editing.');
        return;
      }
      control.click();
      requestAnimationFrame(syncControls);
      setTimeout(syncControls, 120);
    } catch (_) {
      tell('The preview could not reach the page. Reload it and try again.');
    }
  });

  addToggle.addEventListener('click', () => {
    const expanded = elementPicker.hidden;
    elementPicker.hidden = !expanded;
    addToggle.setAttribute('aria-expanded', String(expanded));
    if (expanded) loadContentElements();
  });
  pickerClose.addEventListener('click', () => {
    elementPicker.hidden = true;
    addToggle.setAttribute('aria-expanded', 'false');
  });
  pickerCategories.addEventListener('dragstart', (event) => {
    const item = event.target.closest('[data-element-type]');
    if (!item) return;
    event.dataTransfer.setData('application/x-slowhouse-element', item.dataset.elementType);
    event.dataTransfer.effectAllowed = 'copy';
  });

  elementSearch.addEventListener('input', () => {
    const query = elementSearch.value.trim().toLocaleLowerCase();
    pickerCategories.querySelectorAll('[data-picker-category]').forEach((category) => {
      let visible = 0;
      category.querySelectorAll('[data-element-type]').forEach((item) => {
        const matches = !query || item.dataset.search.includes(query);
        item.hidden = !matches;
        if (matches) visible += 1;
      });
      category.hidden = visible === 0;
    });
  });

  async function loadContentElements() {
    if (elementCatalogLoaded) return;
    pickerCategories.replaceChildren(Object.assign(document.createElement('p'), { className: 'picker-loading', textContent: 'Loading Contao elements…' }));
    try {
      const response = await fetch('/contao-live-edit/content-elements', { credentials: 'same-origin', headers: { 'X-Requested-With': 'XMLHttpRequest' } });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not load the Contao element list.');
      pickerCategories.replaceChildren();
      for (const categoryData of result.categories || []) {
        const category = document.createElement('section');
        category.className = 'picker-category';
        category.dataset.pickerCategory = '';
        const heading = document.createElement('h3');
        heading.textContent = categoryData.label;
        category.append(heading);
        const items = document.createElement('div');
        items.className = 'picker-items';
        for (const element of categoryData.items || []) {
          const button = document.createElement('button');
          button.type = 'button';
          button.draggable = true;
          button.dataset.elementType = element.type;
          button.dataset.search = `${element.label} ${element.type} ${element.description || ''}`.toLocaleLowerCase();
          button.title = element.description || element.label;
          const symbol = document.createElement('span');
          symbol.className = 'picker-symbol';
          symbol.setAttribute('aria-hidden', 'true');
          symbol.textContent = element.label.trim().charAt(0).toUpperCase() || '•';
          const label = document.createElement('span');
          label.textContent = element.label;
          button.append(symbol, label);
          items.append(button);
        }
        category.append(items);
        pickerCategories.append(category);
      }
      elementCatalogLoaded = true;
      elementSearch.dispatchEvent(new Event('input'));
    } catch (error) {
      const message = document.createElement('p');
      message.className = 'picker-loading is-error';
      message.textContent = error.message || 'Could not load the Contao element list.';
      pickerCategories.replaceChildren(message);
    }
  }
})();
