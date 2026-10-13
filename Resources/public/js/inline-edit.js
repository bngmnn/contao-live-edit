(() => {
  const fields = '[data-inline-record][data-inline-field]';
  const token = document.querySelector('meta[name="contao-live-edit-token"]')?.content;
  if (!token) return;
  const activationKey = 'contao-live-edit-active';

  let activeField = null;
  let originalMarkup = '';
  let textMode = false;
  let popover = null;
  let pendingClick = null;
  let replayingClick = false;
  let imagePreviewUrl = null;
  textMode = sessionStorage.getItem(activationKey) === 'true';

  const bar = document.createElement('div');
  bar.className = 'contao-live-edit-inline-bar is-ready';
  bar.setAttribute('role', 'region');
  bar.setAttribute('aria-label', 'Inline text editor');
  bar.innerHTML = '<span class="contao-live-edit-inline-hint">Double-click any text to edit</span><span class="contao-live-edit-inline-status" aria-live="polite"></span><button type="button" data-action="toggle">Edit text</button><button type="button" data-action="cancel">Cancel</button><button type="button" data-action="save">Save</button>';
  document.body.append(bar);

  const status = bar.querySelector('.contao-live-edit-inline-status');
  const toggleButton = bar.querySelector('[data-action="toggle"]');
  const saveButton = bar.querySelector('[data-action="save"]');
  const cancelButton = bar.querySelector('[data-action="cancel"]');

  const isActive = () => textMode;
  const setMessage = (message, error = false) => {
    status.textContent = message;
    status.classList.toggle('is-error', error);
  };

  const finish = (restore) => {
    if (!activeField) return;
    if (restore) activeField.innerHTML = originalMarkup;
    activeField.contentEditable = 'false';
    activeField.classList.remove('is-inline-editing');
    activeField = null;
    bar.classList.remove('is-editing');
    saveButton.disabled = false;
    setMessage('');
  };

  const syncActivation = () => {
    const active = isActive();
    sessionStorage.setItem(activationKey, String(textMode));
    bar.classList.toggle('is-active', active);
    document.body.classList.toggle('contao-live-edit-text-editing', active);
    toggleButton.textContent = textMode ? 'Text editing on' : 'Edit text';
    toggleButton.setAttribute('aria-pressed', String(textMode));
    if (!active && activeField) finish(true);
  };
  new MutationObserver(syncActivation).observe(document.body, { attributes: true, attributeFilter: ['class'], subtree: true });
  syncActivation();

  const begin = (field) => {
    if (!isActive()) return;
    if (activeField && activeField !== field) finish(true);
    activeField = field;
    originalMarkup = field.innerHTML;
    field.contentEditable = 'true';
    field.classList.add('is-inline-editing');
    bar.classList.add('is-editing');
    setMessage('');
    field.focus();
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(field);
    selection.removeAllRanges();
    selection.addRange(range);
  };

  const closePopover = () => {
    popover?.remove();
    popover = null;
    if (imagePreviewUrl) URL.revokeObjectURL(imagePreviewUrl);
    imagePreviewUrl = null;
  };

  const placePopover = (node) => {
    const rect = node.getBoundingClientRect();
    const width = Math.min(360, window.innerWidth - 24);
    const left = Math.max(12, Math.min(rect.left, window.innerWidth - width - 12));
    const top = rect.bottom + 12 + 190 < window.innerHeight ? rect.bottom + 12 : Math.max(12, rect.top - 202);
    popover.style.left = `${left}px`;
    popover.style.top = `${top}px`;
  };

  const elementAtPoint = (selector, x, y, within = document) => [...within.querySelectorAll(selector)]
    .filter((candidate) => {
      if (candidate.closest('.contao-live-edit-inline-bar, .contao-live-edit-edit-popover')) return false;
      const rect = candidate.getBoundingClientRect();
      return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
    })
    .sort((a, b) => {
      const aRect = a.getBoundingClientRect();
      const bRect = b.getBoundingClientRect();
      return (aRect.width * aRect.height) - (bRect.width * bRect.height);
    })[0] || null;

  const inlineTextField = (target) => {
    const markedField = target.closest(fields);
    if (markedField) return markedField;

    const editable = target.closest('[data-contao-live-edit-record][data-contao-live-edit-type]');
    if (!editable) return null;

    const heading = target.closest('h1,h2,h3,h4,h5,h6');
    const fieldName = editable.dataset.contaoLiveEditType === 'headline' ? 'headline'
      : editable.dataset.contaoLiveEditType === 'text' && heading && editable.contains(heading) ? 'headline'
        : editable.dataset.contaoLiveEditType === 'text' ? 'text' : '';
    if (!fieldName || editable.closest('.contao-live-edit-inline-bar, .contao-live-edit-edit-popover')) return null;
    const field = 'headline' === fieldName && heading ? heading : editable;
    field.dataset.inlineRecord = editable.dataset.contaoLiveEditRecord;
    field.dataset.inlineField = fieldName;
    return field;
  };

  const recordForTarget = (target) => target.closest('[data-contao-live-edit-record][data-contao-live-edit-type]');
  const hasDragType = (event, type) => Array.from(event.dataTransfer?.types || []).includes(type);
  const isContentDrag = (event) => hasDragType(event, 'application/x-contao-live-edit-element');
  const request = async (path, payload) => {
    const response = await fetch(path, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
      body: JSON.stringify({ ...payload, _token: token })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'The content change could not be saved.');
    return result;
  };

  const addMoveHandle = (record) => {
    if (!isActive() || record.querySelector(':scope > .contao-live-edit-move-handle')) return;
    if ('static' === window.getComputedStyle(record).position) record.style.position = 'relative';
    const handle = document.createElement('button');
    handle.type = 'button';
    handle.className = 'contao-live-edit-move-handle';
    handle.draggable = true;
    handle.title = 'Drag to rearrange';
    handle.setAttribute('aria-label', 'Drag to rearrange this element');
    handle.textContent = '⠿';
    handle.addEventListener('click', (event) => event.stopPropagation());
    handle.addEventListener('dragstart', (event) => {
      event.stopPropagation();
      event.dataTransfer.setData('application/x-contao-live-edit-record', record.dataset.contaoLiveEditRecord);
      event.dataTransfer.effectAllowed = 'move';
      record.classList.add('contao-live-edit-is-moving');
    });
    handle.addEventListener('dragend', () => record.classList.remove('contao-live-edit-is-moving'));
    record.append(handle);
    const settings = document.createElement('button');
    settings.type = 'button';
    settings.className = 'contao-live-edit-settings-handle';
    settings.title = 'Edit element settings';
    settings.setAttribute('aria-label', 'Edit element settings');
    settings.textContent = '⚙';
    settings.addEventListener('click', (event) => { event.preventDefault(); event.stopPropagation(); openElementEditor(record); });
    record.append(settings);
  };

  document.addEventListener('pointerover', (event) => {
    if (!isActive()) return;
    const record = recordForTarget(event.target);
    if (record && !record.closest('.contao-live-edit-inline-bar, .contao-live-edit-edit-popover')) addMoveHandle(record);
  });

  document.addEventListener('dragover', (event) => {
    if (!isActive() || (!isContentDrag(event) && !hasDragType(event, 'application/x-contao-live-edit-record'))) return;
    const record = recordForTarget(event.target);
    if (!record) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = isContentDrag(event) ? 'copy' : 'move';
    document.querySelectorAll('.contao-live-edit-drop-before,.contao-live-edit-drop-after').forEach((node) => node.classList.remove('contao-live-edit-drop-before', 'contao-live-edit-drop-after'));
    const placement = event.clientY < record.getBoundingClientRect().top + record.getBoundingClientRect().height / 2 ? 'before' : 'after';
    record.classList.add(`contao-live-edit-drop-${placement}`);
  });

  document.addEventListener('dragleave', (event) => {
    if (event.target === document.documentElement) document.querySelectorAll('.contao-live-edit-drop-before,.contao-live-edit-drop-after').forEach((node) => node.classList.remove('contao-live-edit-drop-before', 'contao-live-edit-drop-after'));
  });

  document.addEventListener('drop', async (event) => {
    const record = recordForTarget(event.target);
    if (!isActive() || !record) return;
    const newType = event.dataTransfer?.getData('application/x-contao-live-edit-element');
    const movingId = event.dataTransfer?.getData('application/x-contao-live-edit-record');
    if (!newType && !movingId) return;
    event.preventDefault();
    event.stopPropagation();
    const rect = record.getBoundingClientRect();
    const placement = event.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
    document.querySelectorAll('.contao-live-edit-drop-before,.contao-live-edit-drop-after').forEach((node) => node.classList.remove('contao-live-edit-drop-before', 'contao-live-edit-drop-after'));
    try {
      if (newType) {
        setMessage('Adding element…');
        await request('/contao-live-edit/insert-content', { type: newType, anchorId: record.dataset.contaoLiveEditRecord, placement });
        setMessage('Element added');
      } else {
        setMessage('Moving element…');
        await request('/contao-live-edit/reorder-content', { id: movingId, anchorId: record.dataset.contaoLiveEditRecord, placement });
        setMessage('Element moved');
      }
      window.setTimeout(() => window.location.reload(), 350);
    } catch (error) {
      setMessage(error.message || 'The content change could not be saved.', true);
    }
  }, true);

  const openLinkEditor = (link) => {
    closePopover();
    popover = document.createElement('form');
    popover.className = 'contao-live-edit-edit-popover contao-live-edit-link-popover';
    popover.setAttribute('role', 'dialog');
    popover.setAttribute('aria-label', 'Edit link');
    popover.innerHTML = '<div class="contao-live-edit-popover-heading">Edit link</div>' +
      '<label>Text<input name="label" maxlength="255" required></label>' +
      '<label>URL<input name="url" maxlength="2048" placeholder="https://… or /contact" required></label>' +
      '<label>Title<input name="title" maxlength="255"></label>' +
      '<label>Lightbox group<input name="rel" maxlength="64" placeholder="e.g. gallery"></label>' +
      '<label class="contao-live-edit-popover-check"><input name="target" type="checkbox"> Open in a new tab</label>' +
      '<div class="contao-live-edit-popover-actions"><span class="contao-live-edit-popover-status" aria-live="polite"></span><button type="button" data-action="cancel">Cancel</button><button type="submit">Save link</button></div>';
    document.body.append(popover);
    popover.elements.label.value = link.textContent.trim();
    popover.elements.url.value = link.getAttribute('href') || '';
    popover.elements.title.value = link.getAttribute('title') || '';
    popover.elements.rel.value = link.getAttribute('rel') || '';
    popover.elements.target.checked = link.target === '_blank';
    placePopover(link);
    popover.elements.label.focus();
    popover.querySelector('[data-action="cancel"]').addEventListener('click', closePopover);
    popover.addEventListener('click', (event) => event.stopPropagation());
    popover.addEventListener('submit', async (event) => {
      event.preventDefault();
      const submit = popover.querySelector('[type="submit"]');
      const message = popover.querySelector('.contao-live-edit-popover-status');
      submit.disabled = true;
      message.textContent = 'Saving…';
      try {
        const response = await fetch('/contao-live-edit/save-link', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
          body: JSON.stringify({
            id: link.closest('[data-contao-live-edit-type="hyperlink"]')?.dataset.contaoLiveEditRecord || '',
            label: popover.elements.label.value,
            url: popover.elements.url.value,
            title: popover.elements.title.value,
            rel: popover.elements.rel.value,
            target: popover.elements.target.checked,
            _token: token
          })
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Could not save this link.');
        link.textContent = popover.elements.label.value;
        link.setAttribute('href', popover.elements.url.value);
        link.target = popover.elements.target.checked ? '_blank' : '';
        if (popover.elements.title.value) link.setAttribute('title', popover.elements.title.value);
        else link.removeAttribute('title');
        if (popover.elements.rel.value) link.setAttribute('rel', popover.elements.rel.value);
        else link.removeAttribute('rel');
        closePopover();
        setMessage('Saved');
        window.setTimeout(() => setMessage(''), 1200);
      } catch (error) {
        submit.disabled = false;
        message.textContent = error.message || 'Could not save this link.';
        message.classList.add('is-error');
      }
    });
  };

  const openImageEditor = (image) => {
    closePopover();
    const imageRecord = image.closest('[data-contao-live-edit-type="image"]');

    if (!imageRecord?.dataset.contaoLiveEditRecord) {
      setMessage('Contao could not find an editable image element here.', true);
      return;
    }

    const caption = image.closest('figure')?.querySelector('figcaption')?.innerText.trim() || '';
    popover = document.createElement('form');
    popover.className = 'contao-live-edit-edit-popover contao-live-edit-image-modal';
    popover.setAttribute('role', 'dialog');
    popover.setAttribute('aria-modal', 'true');
    popover.setAttribute('aria-label', 'Edit image');
    popover.innerHTML = '<div class="contao-live-edit-image-modal-card">' +
      '<header class="contao-live-edit-image-modal-header"><div><span class="contao-live-edit-modal-kicker">IMAGE</span><h2>Replace or edit image</h2><p>Upload a new image and update its key display settings.</p></div><button type="button" class="contao-live-edit-modal-close" data-action="cancel" aria-label="Close">×</button></header>' +
      '<div class="contao-live-edit-image-modal-content"><div class="contao-live-edit-image-preview"><img alt="Current image preview"></div>' +
      '<div class="contao-live-edit-image-dropzone" tabindex="0" role="button" aria-label="Choose or drop an image"><span class="contao-live-edit-upload-icon" aria-hidden="true">↑</span><strong data-file-name>Drop an image here</strong><span>JPG, PNG, GIF, WebP or AVIF · up to 15 MB</span><div class="contao-live-edit-image-source-actions"><button type="button" data-action="browse">Upload image</button><button type="button" data-action="library">Choose from library</button></div><input name="file" type="file" accept="image/jpeg,image/png,image/gif,image/webp,image/avif" hidden></div>' +
      '<section class="contao-live-edit-image-library" data-image-library hidden aria-label="Contao file library"></section>' +
      '<div class="contao-live-edit-image-fields"><label>Alternative text<input name="alt" maxlength="255" placeholder="Describe the image"></label><label>Image title<input name="title" maxlength="255" placeholder="Optional title"></label><label class="contao-live-edit-caption-field">Caption<textarea name="caption" maxlength="500" rows="2" placeholder="Optional caption"></textarea></label></div></div>' +
      '<footer class="contao-live-edit-image-modal-footer"><span class="contao-live-edit-popover-status" aria-live="polite"></span><button type="button" data-action="cancel">Cancel</button><button type="submit">Save image</button></footer></div>';
    document.body.append(popover);
    const preview = popover.querySelector('.contao-live-edit-image-preview img');
    preview.src = image.currentSrc || image.src;
    popover.elements.alt.value = image.alt || '';
    popover.elements.title.value = image.title || '';
    popover.elements.caption.value = caption;

    const fileInput = popover.elements.file;
    const dropzone = popover.querySelector('.contao-live-edit-image-dropzone');
    const fileName = popover.querySelector('[data-file-name]');
    const uploadStatus = popover.querySelector('.contao-live-edit-popover-status');
    const libraryPanel = popover.querySelector('[data-image-library]');
    let selectedFile = null;
    let selectedUuid = '';
    let libraryFolders = [];

    const selectFile = (file) => {
      if (!file) return;
      if (!file.type.startsWith('image/')) {
        uploadStatus.textContent = 'Choose an image file.';
        uploadStatus.classList.add('is-error');
        return;
      }
      if (file.size > 15 * 1024 * 1024) {
        uploadStatus.textContent = 'This image is larger than 15 MB.';
        uploadStatus.classList.add('is-error');
        return;
      }
      if (imagePreviewUrl) URL.revokeObjectURL(imagePreviewUrl);
      selectedUuid = '';
      selectedFile = file;
      imagePreviewUrl = URL.createObjectURL(file);
      preview.src = imagePreviewUrl;
      fileName.textContent = file.name;
      dropzone.classList.add('has-file');
      uploadStatus.textContent = '';
      uploadStatus.classList.remove('is-error');
    };

    popover.addEventListener('click', (event) => event.stopPropagation());
    popover.querySelectorAll('[data-action="cancel"]').forEach((button) => button.addEventListener('click', closePopover));
    popover.querySelector('[data-action="browse"]').addEventListener('click', () => fileInput.click());
    const loadLibrary = async () => {
      libraryPanel.hidden = false;
      libraryPanel.replaceChildren();
      const loading = document.createElement('p');
      loading.className = 'contao-live-edit-library-message';
      loading.textContent = 'Loading your Contao files…';
      libraryPanel.append(loading);

      try {
        const folder = libraryFolders.at(-1) || '';
        const response = await fetch(`/contao-live-edit/image-library${folder ? `?folder=${encodeURIComponent(folder)}` : ''}`, {
          credentials: 'same-origin',
          headers: { 'X-Requested-With': 'XMLHttpRequest' }
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Could not load the Contao file library.');

        const header = document.createElement('div');
        header.className = 'contao-live-edit-library-header';
        const title = document.createElement('strong');
        title.textContent = result.folder?.name || 'Contao file library';
        header.append(title);
        const navigation = document.createElement('div');
        navigation.className = 'contao-live-edit-library-navigation';
        if (libraryFolders.length) {
          const back = document.createElement('button');
          back.type = 'button';
          back.textContent = '← Back';
          back.addEventListener('click', () => { libraryFolders.pop(); loadLibrary(); });
          navigation.append(back);
        }
        const closeLibrary = document.createElement('button');
        closeLibrary.type = 'button';
        closeLibrary.textContent = 'Close';
        closeLibrary.addEventListener('click', () => { libraryPanel.hidden = true; });
        navigation.append(closeLibrary);
        header.append(navigation);

        const grid = document.createElement('div');
        grid.className = 'contao-live-edit-library-grid';
        for (const item of result.items) {
          const choice = document.createElement('button');
          choice.type = 'button';
          choice.className = item.type === 'folder' ? 'contao-live-edit-library-item is-folder' : 'contao-live-edit-library-item';
          if (item.type === 'folder') {
            choice.innerHTML = '<span class="contao-live-edit-library-folder-icon" aria-hidden="true">▰</span>';
            choice.addEventListener('click', () => { libraryFolders.push(item.uuid); loadLibrary(); });
          } else {
            const thumbnail = document.createElement('img');
            thumbnail.src = item.url;
            thumbnail.alt = '';
            thumbnail.loading = 'lazy';
            choice.append(thumbnail);
            choice.addEventListener('click', () => {
              if (imagePreviewUrl) URL.revokeObjectURL(imagePreviewUrl);
              imagePreviewUrl = null;
              selectedFile = null;
              selectedUuid = item.uuid;
              preview.src = item.url;
              fileName.textContent = `Selected: ${item.name}`;
              dropzone.classList.add('has-file');
              uploadStatus.textContent = '';
              uploadStatus.classList.remove('is-error');
              libraryPanel.hidden = true;
            });
          }
          const label = document.createElement('span');
          label.textContent = item.name;
          choice.append(label);
          grid.append(choice);
        }
        libraryPanel.replaceChildren(header, grid);
        if (!result.items.length) {
          const empty = document.createElement('p');
          empty.className = 'contao-live-edit-library-message';
          empty.textContent = 'No folders or images in this location.';
          libraryPanel.append(empty);
        }
      } catch (error) {
        loading.textContent = error.message || 'Could not load the Contao file library.';
        loading.classList.add('is-error');
      }
    };
    popover.querySelector('[data-action="library"]').addEventListener('click', () => { libraryFolders = []; loadLibrary(); });
    fileInput.addEventListener('change', () => selectFile(fileInput.files?.[0]));
    dropzone.addEventListener('click', (event) => {
      if (!event.target.closest('button')) fileInput.click();
    });
    dropzone.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); fileInput.click(); }
    });
    dropzone.addEventListener('dragover', (event) => { event.preventDefault(); dropzone.classList.add('is-dragging'); });
    dropzone.addEventListener('dragleave', () => dropzone.classList.remove('is-dragging'));
    dropzone.addEventListener('drop', (event) => {
      event.preventDefault();
      dropzone.classList.remove('is-dragging');
      selectFile(event.dataTransfer?.files?.[0]);
    });
    popover.addEventListener('submit', async (event) => {
      event.preventDefault();
      const submit = popover.querySelector('[type="submit"]');
      submit.disabled = true;
      uploadStatus.textContent = 'Saving…';
      uploadStatus.classList.remove('is-error');
      const formData = new FormData();
      formData.set('id', imageRecord.dataset.contaoLiveEditRecord);
      formData.set('alt', popover.elements.alt.value);
      formData.set('title', popover.elements.title.value);
      formData.set('caption', popover.elements.caption.value);
      formData.set('_token', token);
      if (selectedFile) formData.set('file', selectedFile);
      else if (selectedUuid) formData.set('fileUuid', selectedUuid);

      try {
        const response = await fetch('/contao-live-edit/save-image', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'X-Requested-With': 'XMLHttpRequest' },
          body: formData
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Could not save this image.');
        image.alt = result.alt;
        image.title = result.title;
        if (result.url) {
          image.src = `${result.url}?v=${Date.now()}`;
          image.removeAttribute('srcset');
          image.closest('picture')?.querySelectorAll('source').forEach((source) => source.removeAttribute('srcset'));
        }
        const figure = image.closest('figure');
        if (figure) {
          let figcaption = figure.querySelector('figcaption');
          if (result.caption && !figcaption) {
            figcaption = document.createElement('figcaption');
            figure.append(figcaption);
          }
          if (figcaption) {
            if (result.caption) figcaption.textContent = result.caption;
            else figcaption.remove();
          }
        }
        closePopover();
        setMessage('Image saved');
        window.setTimeout(() => setMessage(''), 1400);
      } catch (error) {
        submit.disabled = false;
        uploadStatus.textContent = error.message || 'Could not save this image.';
        uploadStatus.classList.add('is-error');
      }
    });
    popover.querySelector('[name="alt"]').focus();
  };

  const openElementEditor = async (record) => {
    const id = record?.dataset.contaoLiveEditRecord;
    if (!id) return;
    closePopover();
    popover = document.createElement('form');
    popover.className = 'contao-live-edit-edit-popover contao-live-edit-element-modal';
    popover.setAttribute('role', 'dialog');
    popover.setAttribute('aria-modal', 'true');
    popover.setAttribute('aria-label', 'Edit content element');
    popover.innerHTML = '<header class="contao-live-edit-element-header"><div><span class="contao-live-edit-modal-kicker">CONTENT ELEMENT</span><h2>Element settings</h2><p>All available Contao and extension fields for this element.</p></div><button type="button" class="contao-live-edit-modal-close" data-action="cancel" aria-label="Close">×</button></header><div class="contao-live-edit-element-fields" data-element-fields><div class="contao-live-edit-library-message">Loading settings…</div></div><footer class="contao-live-edit-image-modal-footer"><button type="button" class="contao-live-edit-delete-element" data-action="delete">Remove element</button><span class="contao-live-edit-popover-status" aria-live="polite"></span><button type="button" data-action="cancel">Cancel</button><button type="submit">Save changes</button></footer>';
    document.body.append(popover);
    popover.addEventListener('click', (event) => event.stopPropagation());
    popover.querySelectorAll('[data-action="cancel"]').forEach((button) => button.addEventListener('click', closePopover));
    const fieldPanel = popover.querySelector('[data-element-fields]');
    const status = popover.querySelector('.contao-live-edit-popover-status');
    popover.querySelector('[data-action="delete"]').addEventListener('click', async () => {
      if (!window.confirm('Remove this element from the page? This cannot be undone.')) return;
      const button = popover.querySelector('[data-action="delete"]'); button.disabled = true; status.textContent = 'Removing…';
      try { await request('/contao-live-edit/delete-element', { id }); closePopover(); window.location.reload(); }
      catch (error) { button.disabled = false; status.textContent = error.message || 'Could not remove this element.'; status.classList.add('is-error'); }
    });

    const controlFor = (field) => {
      const wrapper = document.createElement('label');
      wrapper.className = 'contao-live-edit-element-field';
      const title = document.createElement('span');
      title.className = 'contao-live-edit-element-field-title';
      title.textContent = field.label || field.name;
      wrapper.append(title);
      let input;
      if (['select', 'radio', 'pageTree'].includes(field.widget) && field.options?.length) {
        input = document.createElement('select');
        if (field.widget === 'pageTree') input.multiple = Boolean(field.multiple);
        if (field.widget === 'select') {
          const blank = document.createElement('option'); blank.value = ''; blank.textContent = 'Choose…'; input.append(blank);
        }
        for (const option of field.options) {
          const item = document.createElement('option'); item.value = option.value; item.textContent = option.label; input.append(item);
        }
        if (input.multiple) for (const option of input.options) option.selected = (Array.isArray(field.value) ? field.value : [field.value]).map(String).includes(option.value);
        else input.value = String(field.value ?? '');
      } else if (field.widget === 'fileTree' || field.widget === 'textarea' || ['listWizard', 'rowWizard', 'tableWizard', 'imageSize'].includes(field.widget) || Array.isArray(field.value)) {
        input = document.createElement('textarea'); input.rows = ['listWizard', 'rowWizard', 'tableWizard'].includes(field.widget) ? 5 : 4;
        if (field.widget === 'fileTree') input.value = JSON.stringify(Array.isArray(field.value) ? field.value : (field.value ? [field.value] : []));
        else if (field.widget === 'listWizard') input.value = (Array.isArray(field.value) ? field.value : []).map(String).join('\n');
        else if (['rowWizard', 'tableWizard'].includes(field.widget)) input.value = (Array.isArray(field.value) ? field.value : []).map((row) => (Array.isArray(row) ? row : Object.values(row || {})).map(String).join('\t')).join('\n');
        else if (['imageSize'].includes(field.widget) || Array.isArray(field.value)) input.value = JSON.stringify(field.value ?? [], null, 2);
        else input.value = String(field.value ?? '');
      } else if (field.widget === 'inputUnit') {
        input = document.createElement('span'); input.className = 'contao-live-edit-element-input-unit';
        const amount = document.createElement('input'); amount.type = 'text'; amount.value = String(field.value?.value ?? ''); amount.dataset.unitValue = field.name;
        const unit = document.createElement('select'); unit.dataset.unitName = field.name;
        for (const option of field.options || []) { const item = document.createElement('option'); item.value = option.value; item.textContent = option.label; unit.append(item); }
        unit.value = String(field.value?.unit ?? ''); input.append(amount, unit);
      } else if (field.widget === 'checkbox' && field.options?.length) {
        input = document.createElement('span'); input.className = 'contao-live-edit-element-check-options';
        for (const option of field.options) {
          const choice = document.createElement('span'); choice.className = 'contao-live-edit-element-check-option';
          const box = document.createElement('input'); box.type = 'checkbox'; box.value = option.value; box.dataset.choiceField = field.name;
          box.checked = Array.isArray(field.value) && field.value.map(String).includes(option.value);
          const label = document.createElement('span'); label.textContent = option.label; choice.append(box, label); input.append(choice);
        }
      } else if (field.widget === 'checkbox') {
        input = document.createElement('input'); input.type = 'checkbox';
        input.checked = Array.isArray(field.value) ? field.value.length > 0 : Boolean(field.value);
      } else {
        const arrayValue = Array.isArray(field.value);
        input = document.createElement(arrayValue ? 'textarea' : 'input');
        if (!arrayValue) input.type = 'text';
        input.value = arrayValue ? JSON.stringify(field.value, null, 2) : String(field.value ?? '');
        if (arrayValue) input.rows = 4;
        if (field.maxlength) input.maxLength = field.maxlength;
      }
      if (input.matches?.('input,textarea,select')) input.name = field.name;
      input.dataset.widget = field.widget; input.dataset.options = JSON.stringify(field.options || []);
      if (field.required && input.matches?.('input,textarea,select')) input.required = true;
      wrapper.append(input);
      if (field.description) { const hint = document.createElement('small'); hint.textContent = field.description; wrapper.append(hint); }
      if (field.widget === 'fileTree') {
        const choose = document.createElement('button'); choose.type = 'button'; choose.className = 'contao-live-edit-element-file-picker'; choose.textContent = 'Choose from Contao files';
        const library = document.createElement('div'); library.className = 'contao-live-edit-element-file-library'; library.hidden = true;
        const folders = [];
        const load = async () => {
          library.hidden = false; library.replaceChildren();
          try {
            const folder = folders.at(-1) || '';
            const response = await fetch(`/contao-live-edit/image-library?all=1${folder ? `&folder=${encodeURIComponent(folder)}` : ''}`, { credentials: 'same-origin', headers: { 'X-Requested-With': 'XMLHttpRequest' } });
            const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Could not load files.');
            const heading = document.createElement('div'); heading.className = 'contao-live-edit-element-library-heading';
            const title = document.createElement('strong'); title.textContent = result.folder?.name || 'Contao file library'; heading.append(title);
            if (folders.length) { const back = document.createElement('button'); back.type = 'button'; back.textContent = '← Back'; back.addEventListener('click', () => { folders.pop(); load(); }); heading.append(back); }
            const close = document.createElement('button'); close.type = 'button'; close.textContent = 'Close'; close.addEventListener('click', () => { library.hidden = true; }); heading.append(close); library.append(heading);
            for (const item of result.items) {
              const choice = document.createElement('button'); choice.type = 'button'; choice.className = 'contao-live-edit-element-file-choice';
              const name = document.createElement('span'); name.textContent = `${item.type === 'folder' ? '▰ ' : '• '}${item.name}`; choice.append(name);
              if (item.type === 'folder') choice.addEventListener('click', () => { folders.push(item.uuid); load(); });
              else choice.addEventListener('click', () => {
                let selected; try { selected = JSON.parse(input.value || '[]'); } catch { selected = []; }
                if (!Array.isArray(selected)) selected = [];
                selected = field.multiple ? (selected.includes(item.uuid) ? selected.filter((uuid) => uuid !== item.uuid) : [...selected, item.uuid]) : [item.uuid];
                input.value = JSON.stringify(selected); input.dispatchEvent(new Event('input', { bubbles: true }));
                choice.classList.toggle('is-selected', selected.includes(item.uuid));
                if (!field.multiple) library.hidden = true;
              });
              library.append(choice);
            }
            if (!result.items.length) { const empty = document.createElement('small'); empty.textContent = 'No files in this folder.'; library.append(empty); }
          } catch (error) { const message = document.createElement('small'); message.textContent = error.message || 'Could not load files.'; library.replaceChildren(message); }
        };
        choose.addEventListener('click', load); wrapper.append(choose, library);
      }
      return wrapper;
    };

    try {
      const response = await fetch(`/contao-live-edit/element-fields/${encodeURIComponent(id)}`, { credentials: 'same-origin', headers: { 'X-Requested-With': 'XMLHttpRequest' } });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not load element settings.');
      const type = record.dataset.contaoLiveEditType;
      const videoType = ['youtube', 'vimeo'].includes(type);
      popover.querySelector('h2').textContent = result.fields.length ? (videoType ? `Set ${type === 'youtube' ? 'YouTube' : 'Vimeo'} video` : `${type.replaceAll('_', ' ')} settings`) : 'No editable fields';
      popover.querySelector('.contao-live-edit-element-header p').textContent = videoType ? 'Paste the video link, check the preview, then save.' : 'All available Contao and extension fields for this element.';
      fieldPanel.replaceChildren();
      const mainFields = videoType ? result.fields.filter((field) => [type, 'titleText'].includes(field.name)) : result.fields;
      const extraFields = videoType ? result.fields.filter((field) => !mainFields.includes(field)) : [];
      let videoPreview = null;
      if (videoType) {
        videoPreview = document.createElement('div'); videoPreview.className = 'contao-live-edit-element-video-preview';
        const updateVideoPreview = (value) => {
          const match = value.match(/(?:youtu\.be\/|youtube(?:-nocookie)?\.com\/(?:watch\?v=|embed\/|shorts\/))([\w-]{6,})/i);
          const vimeo = value.match(/vimeo\.com\/(?:video\/)?(\d+)/i);
          const youtubeId = match?.[1] || (/^[\w-]{11}$/.test(value) ? value : '');
          const vimeoId = vimeo?.[1] || (/^\d{1,12}$/.test(value) ? value : '');
          const source = type === 'youtube' && youtubeId ? `https://www.youtube-nocookie.com/embed/${youtubeId}` : type === 'vimeo' && vimeoId ? `https://player.vimeo.com/video/${vimeoId}` : '';
          videoPreview.replaceChildren();
          if (source) { const frame = document.createElement('iframe'); frame.src = source; frame.title = 'Video preview'; frame.loading = 'lazy'; frame.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share'; frame.allowFullscreen = true; videoPreview.append(frame); }
          else { const note = document.createElement('span'); note.textContent = 'Enter a valid video URL to preview it'; videoPreview.append(note); }
        };
        fieldPanel.append(videoPreview);
        for (const field of mainFields) {
          const displayField = field.name === type ? { ...field, label: `${type === 'youtube' ? 'YouTube' : 'Vimeo'} video URL`, value: field.value ? (type === 'youtube' ? `https://www.youtube.com/watch?v=${field.value}` : `https://vimeo.com/${field.value}`) : '' } : field;
          const control = controlFor(displayField); fieldPanel.append(control);
          if (field.name === type) control.querySelector('input,textarea,select')?.addEventListener('input', (event) => updateVideoPreview(event.target.value));
        }
        updateVideoPreview(String(mainFields.find((field) => field.name === type)?.value || ''));
      } else for (const field of mainFields) fieldPanel.append(controlFor(field));
      if (extraFields.length) {
        const details = document.createElement('details'); details.className = 'contao-live-edit-element-extra';
        const summary = document.createElement('summary'); summary.textContent = `Advanced settings · ${extraFields.length} fields`; details.append(summary);
        for (const field of extraFields) details.append(controlFor(field));
        fieldPanel.append(details);
      }
      if (!result.fields.length) { const empty = document.createElement('p'); empty.className = 'contao-live-edit-library-message'; empty.textContent = 'This element has no editable fields in its Contao configuration.'; fieldPanel.append(empty); }
    } catch (error) {
      fieldPanel.textContent = error.message || 'Could not load element settings.';
      fieldPanel.classList.add('is-error');
      return;
    }

    popover.addEventListener('submit', async (event) => {
      event.preventDefault();
      const submit = popover.querySelector('[type="submit"]'); submit.disabled = true; status.textContent = 'Saving…'; status.classList.remove('is-error');
      const values = {};
      for (const input of fieldPanel.querySelectorAll('input,textarea,select')) {
        if (input.dataset.choiceField) continue;
        if (input.dataset.unitValue) { values[input.dataset.unitValue] = { ...(values[input.dataset.unitValue] || {}), value: input.value }; continue; }
        if (input.dataset.unitName) { values[input.dataset.unitName] = { ...(values[input.dataset.unitName] || {}), unit: input.value }; continue; }
        if (input.dataset.widget === 'checkbox') values[input.name] = input.checked;
        else if (input.dataset.widget === 'pageTree' && input.multiple) values[input.name] = [...input.selectedOptions].map((option) => option.value);
        else if (input.dataset.widget === 'fileTree') {
          try { values[input.name] = JSON.parse(input.value || '[]'); } catch { status.textContent = 'Choose files from the library or enter valid JSON.'; status.classList.add('is-error'); submit.disabled = false; return; }
        }
        else if (input.dataset.widget === 'listWizard') values[input.name] = input.value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
        else if (['rowWizard', 'tableWizard'].includes(input.dataset.widget)) values[input.name] = input.value.split(/\r?\n/).filter(Boolean).map((line) => line.split('\t'));
        else if (input.dataset.widget === 'imageSize' || (input.tagName === 'TEXTAREA' && input.value.trim().startsWith('['))) {
          try { values[input.name] = JSON.parse(input.value); } catch { status.textContent = 'Enter valid JSON for this structured field.'; status.classList.add('is-error'); submit.disabled = false; return; }
        }
        else values[input.name] = input.value;
      }
      if (['youtube', 'vimeo'].includes(record.dataset.contaoLiveEditType)) {
        const mediaType = record.dataset.contaoLiveEditType;
        const mediaInput = fieldPanel.querySelector(`[name="${mediaType}"]`);
        const inputValue = mediaInput?.value.trim() || '';
        const match = mediaType === 'youtube' ? inputValue.match(/(?:youtu\.be\/|youtube(?:-nocookie)?\.com\/(?:watch\?v=|embed\/|shorts\/))([\w-]{11})/i) : inputValue.match(/vimeo\.com\/(?:video\/)?(\d{1,12})/i);
        values[mediaType] = match?.[1] || inputValue;
      }
      const choiceFields = new Set([...fieldPanel.querySelectorAll('[data-choice-field]')].map((input) => input.dataset.choiceField));
      for (const name of choiceFields) values[name] = [...fieldPanel.querySelectorAll(`[data-choice-field="${CSS.escape(name)}"]:checked`)].map((input) => input.value);
      try {
        await request('/contao-live-edit/save-element-fields', { id, fields: values });
        closePopover(); setMessage('Element saved'); window.setTimeout(() => window.location.reload(), 350);
      } catch (error) { submit.disabled = false; status.textContent = error.message || 'Could not save element settings.'; status.classList.add('is-error'); }
    });
    popover.querySelector('[type="submit"]').focus();
  };

  document.addEventListener('click', (event) => {
    if (!isActive() || replayingClick || !event.target.closest('a') || event.target.closest('.contao-live-edit-inline-bar, .contao-live-edit-edit-popover, [data-inline-ignore-links]')) return;

    const anchor = event.target.closest('a');
    event.preventDefault();
    event.stopImmediatePropagation();
    if (pendingClick?.anchor === anchor && event.detail > 1) {
      window.clearTimeout(pendingClick.timer);
      pendingClick = null;
      return;
    }

    if (pendingClick) window.clearTimeout(pendingClick.timer);
    pendingClick = {
      anchor,
      timer: window.setTimeout(() => {
        const clickToReplay = pendingClick?.anchor;
        pendingClick = null;
        if (!clickToReplay?.isConnected) return;
        replayingClick = true;
        clickToReplay.click();
        replayingClick = false;
      }, 280)
    };
  }, true);

  document.addEventListener('dblclick', (event) => {
    if (!isActive()) return;
    const directLink = event.target.closest('a');
    if (directLink?.closest('[data-inline-ignore-links]')) return;
    const link = directLink || elementAtPoint('a[href]', event.clientX, event.clientY);
    if (link?.closest('[data-contao-live-edit-type="hyperlink"]') && !link.closest('.contao-live-edit-inline-bar, .contao-live-edit-edit-popover')) {
      if (pendingClick) window.clearTimeout(pendingClick.timer);
      pendingClick = null;
      event.preventDefault();
      event.stopPropagation();
      openLinkEditor(link);
      return;
    }
    const image = event.target.closest('img') || elementAtPoint('img', event.clientX, event.clientY);
    if (image?.closest('[data-contao-live-edit-type="image"]') && !image.closest('.contao-live-edit-edit-popover')) {
      if (pendingClick) window.clearTimeout(pendingClick.timer);
      pendingClick = null;
      event.preventDefault();
      event.stopPropagation();
      openImageEditor(image);
      return;
    }
    const field = event.target.closest(fields)
      || inlineTextField(event.target)
      || [...document.querySelectorAll(fields)].find((candidate) => {
        const rect = candidate.getBoundingClientRect();
        return event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom;
      });
    if (!field || !isActive()) {
      const record = recordForTarget(event.target);
      if (record && !record.matches('[data-contao-live-edit-type=\"image\"],[data-contao-live-edit-type=\"hyperlink\"]')) {
        if (pendingClick) window.clearTimeout(pendingClick.timer);
        pendingClick = null;
        event.preventDefault(); event.stopPropagation(); openElementEditor(record);
      }
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    begin(field);
  }, true);

  document.addEventListener('keydown', (event) => {
    if (popover && event.key === 'Escape') {
      event.preventDefault();
      closePopover();
      return;
    }
    if (!activeField) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      finish(true);
    } else if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault();
      save();
    }
  });
  document.addEventListener('click', (event) => {
    if (popover && !popover.contains(event.target)) closePopover();
  });

  toggleButton.addEventListener('click', () => {
    textMode = !textMode;
    syncActivation();
  });
  cancelButton.addEventListener('click', () => finish(true));
  saveButton.addEventListener('click', save);

  async function save() {
    if (!activeField) return;
    const field = activeField;
    const value = field.innerText.trim();
    if (!value) {
      setMessage('Text cannot be empty.', true);
      return;
    }

    saveButton.disabled = true;
    setMessage('Saving…');

    try {
      const response = await fetch('/contao-live-edit/save-inline', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
        body: JSON.stringify({
          id: field.dataset.inlineRecord,
          field: field.dataset.inlineField,
          value,
          _token: token
        })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not save this text.');
      if (['headline', 'subheadline'].includes(field.dataset.inlineField)) {
        field.textContent = value;
      } else {
        const richText = field.querySelector('.rte') || field;
        richText.replaceChildren(...value.split(/\n+/).filter(Boolean).map((line) => {
          const paragraph = document.createElement('p');
          paragraph.textContent = line;
          return paragraph;
        }));
      }
      setMessage('Saved');
      window.setTimeout(() => finish(false), 700);
    } catch (error) {
      saveButton.disabled = false;
      setMessage(error.message || 'Could not save this text.', true);
    }
  }
})();
