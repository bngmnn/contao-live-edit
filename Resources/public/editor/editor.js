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

  const iconPaths = {'type': 'M4 7V4h16v3M9 20h6M12 4v16', 'text': 'M4 6h16M4 10h12M4 14h16M4 18h10', 'code': 'm8 8-4 4 4 4m8-8 4 4-4 4m-3-10-2 12', 'list': 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01', 'table': 'M4 5h16v14H4zM4 10h16M10 5v14M16 5v14', 'image': 'M4 5h16v14H4zM8 9h.01M20 15l-5-5-7 8', 'gallery': 'M4 5h16v14H4zM8 9h.01M20 15l-5-5-7 8M2 3v14', 'link': 'M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71', 'file': 'M6 3h8l5 5v13H6zM14 3v6h5M9 14h7M9 17h7', 'files': 'M8 7V3h9l4 4v12h-4M4 7h10l3 3v11H4zM14 7v4h3', 'play': 'M5 4v16l14-8z', 'user': 'M20 21a8 8 0 0 0-16 0M12 13a4 4 0 1 0 0-8 4 4 0 0 0 0 8', 'lock': 'M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4', 'chevron': 'm6 9 6 6 6-6M4 4h16', 'group': 'M4 7h16M4 12h16M4 17h16M7 4v16', 'sliders': 'M4 6h16M4 12h16M4 18h16M8 4v4M15 10v4M10 16v4', 'article': 'M5 4h14v16H5zM8 8h8M8 12h8M8 16h5', 'form': 'M5 3h14v18H5zM8 8h8M8 12h8M8 16h4', 'box': 'M4 7h16v13H4zM8 7V4h8v3M8 12h8', 'chat': 'M4 5h16v12H9l-5 4zM8 9h8M8 13h5', 'template': 'M4 4h7v7H4zM14 4h6v4h-6zM14 11h6v9h-6zM4 14h7v6H4z', 'puzzle': 'M4 4h6a3 3 0 1 1 6 0h4v6a3 3 0 1 0 0 6v4h-6a3 3 0 1 1-6 0H4v-6a3 3 0 1 0 0-6z'};
  const iconByType = {'headline': 'type', 'text': 'text', 'markdown': 'text', 'html': 'code', 'unfilteredhtml': 'code', 'code': 'code', 'descriptionlist': 'list', 'list': 'list', 'table': 'table', 'image': 'image', 'gallery': 'gallery', 'hyperlink': 'link', 'toplink': 'link', 'download': 'file', 'downloads': 'files', 'videoaudio': 'play', 'vimeo': 'play', 'youtube': 'play', 'changepassword': 'lock', 'closeaccount': 'user', 'login': 'user', 'loginform': 'user', 'managepasskeys': 'lock', 'twofactorauthentication': 'lock', 'accordion': 'chevron', 'accordionsingle': 'chevron', 'accordionstart': 'chevron', 'accordionstop': 'chevron', 'elementgroup': 'group', 'contentslider': 'sliders', 'sliderstart': 'sliders', 'sliderstop': 'sliders', 'article': 'article', 'articleteaser': 'article', 'contentelement': 'box', 'form': 'form', 'module': 'box', 'comments': 'chat', 'customtemplate': 'template', 'teasercard': 'article'};
  const iconFor = (type) => iconByType[type.toLowerCase().replace(/[-_\s]/g, '')] || 'puzzle';
  const makeIcon = (name) => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.classList.add('picker-icon');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.8');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', iconPaths[name] || iconPaths.puzzle);
    svg.append(path);
    return svg;
  };

  const inlineControl = () => frame.contentDocument.querySelector('.contao-live-edit-inline-bar [data-action="toggle"]');

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
        if (++attempts >= 40 || previewDocument.querySelector('.contao-live-edit-inline-bar [data-action="toggle"]')) {
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
    event.dataTransfer.setData('application/x-contao-live-edit-element', item.dataset.elementType);
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
          symbol.append(makeIcon(iconFor(element.type)));
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
