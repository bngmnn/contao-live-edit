(() => {
  const fields = '[data-inline-record][data-inline-field]';
  const token = document.querySelector('meta[name="contao-live-edit-inline-token"]')?.content;
  if (!token) return;
  const activationKey = 'contao-live-edit-editor-active';

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
    popover?.querySelectorAll('textarea.contao-live-edit-native-rte').forEach((textarea) => window.hugerte?.get(textarea.id)?.remove());
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
    popover.innerHTML = '<div class="contao-live-edit-element-modal-card"><header class="contao-live-edit-element-header"><div><span class="contao-live-edit-modal-kicker">QUICK EDIT</span><h2>Element settings</h2><p>Edit the fields that matter here. Timing and visibility are just below.</p></div><button type="button" class="contao-live-edit-modal-close" data-action="cancel" aria-label="Close">×</button></header><div class="contao-live-edit-element-fields" data-element-fields><div class="contao-live-edit-library-message">Loading settings…</div></div><footer class="contao-live-edit-image-modal-footer"><div class="contao-live-edit-element-quick-actions"><button type="button" class="contao-live-edit-delete-element" data-action="delete" aria-label="Remove element" title="Remove element"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 6h12m-10 0 .7 10.2h6.6L14 6M8 6V4h4v2m-3 3v4m2-4v4"/></svg></button><button type="button" class="contao-live-edit-visibility-toggle" data-action="visibility" aria-pressed="false" aria-label="Hide element" title="Hide element"></button></div><span class="contao-live-edit-popover-status" aria-live="polite"></span><button type="button" data-action="cancel">Cancel</button><button type="submit">Save changes</button></footer></div>';
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

    const visibilityButton = popover.querySelector('[data-action="visibility"]');
    const renderVisibilityButton = (hidden) => {
      visibilityButton.dataset.hidden = String(hidden);
      visibilityButton.setAttribute('aria-pressed', String(hidden));
      visibilityButton.setAttribute('aria-label', hidden ? 'Show element' : 'Hide element');
      visibilityButton.title = hidden ? 'Show element' : 'Hide element';
      visibilityButton.innerHTML = hidden
        ? '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M2.5 10s2.7-5 7.5-5 7.5 5 7.5 5-2.7 5-7.5 5-7.5-5-7.5-5Z"/><circle cx="10" cy="10" r="2.2"/><path d="m3 3 14 14"/></svg>'
        : '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M2.5 10s2.7-5 7.5-5 7.5 5 7.5 5-2.7 5-7.5 5-7.5-5-7.5-5Z"/><circle cx="10" cy="10" r="2.2"/></svg>';
    };
    visibilityButton.addEventListener('click', () => renderVisibilityButton(visibilityButton.dataset.hidden !== 'true'));

    const controlFor = (field) => {
      const wrapper = document.createElement(field.name === 'cssID' || ['listWizard', 'rowWizard', 'tableWizard'].includes(field.widget) ? 'div' : 'label');
      wrapper.className = 'contao-live-edit-element-field';
      if (field.dependencyGroups?.length) wrapper.dataset.dependencyGroups = JSON.stringify(field.dependencyGroups);
      if (field.name === 'cssID') wrapper.classList.add('is-cssid-pair');
      if (field.widget === 'checkbox' && !field.options?.length) wrapper.classList.add('is-toggle-field');
      if (field.advanced) wrapper.classList.add('is-advanced');
      const title = document.createElement('span');
      title.className = 'contao-live-edit-element-field-title';
      title.textContent = popover.dataset.editorMode === 'description-list' && field.name === 'data' ? 'Terms and descriptions' : popover.dataset.editorMode === 'markdown' && field.name === 'code' ? 'Markdown' : field.name === 'highlight' && popover.dataset.editorMode === 'code' ? 'Syntax' : field.label || field.name;
      if (field.name !== 'cssID') wrapper.append(title);
      let input;
      if (field.widget === 'datetime') {
        input = document.createElement('input'); input.type = 'datetime-local';
        const timestamp = Number(field.value);
        if (timestamp > 0) { const date = new Date(timestamp * 1000); input.value = new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16); }
        else input.value = '';
      } else if (field.widget === 'fileTree') {
        input = document.createElement('input'); input.type = 'hidden'; input.value = JSON.stringify(Array.isArray(field.value) ? field.value : (field.value ? [field.value] : []));
      } else if (field.name === 'cssID' && field.value && typeof field.value === 'object') {
        input = document.createElement('span'); input.className = 'contao-live-edit-element-paired-fields';
        [['CSS ID', 'id'], ['CSS class', 'class']].forEach(([label, key]) => {
          const part = document.createElement('label'); part.className = 'contao-live-edit-element-paired-field';
          const partLabel = document.createElement('span'); partLabel.textContent = label;
          const partInput = document.createElement('input'); partInput.type = 'text'; partInput.value = String(field.value[key] ?? ''); partInput.dataset.cssIdField = field.name; partInput.dataset.cssIdKey = key;
          part.append(partLabel, partInput); input.append(part);
        });
      } else if (field.widget === 'imageSize') {
        input = document.createElement('span'); input.className = 'contao-live-edit-element-image-size';
        [['Width', 'width'], ['Height', 'height']].forEach(([label, key]) => {
          const part = document.createElement('span'); part.className = 'contao-live-edit-element-image-size-part';
          const partLabel = document.createElement('span'); partLabel.textContent = label;
          const partInput = document.createElement('input'); partInput.type = 'number'; partInput.min = '0'; partInput.placeholder = 'Auto'; partInput.value = String(field.value[key] ?? ''); partInput.dataset.imageSizeField = field.name; partInput.dataset.imageSizeKey = key;
          part.append(partLabel, partInput); input.append(part);
        });
        const mode = document.createElement('span'); mode.className = 'contao-live-edit-element-image-size-part';
        const modeLabel = document.createElement('span'); modeLabel.textContent = 'Preset / fit';
        const modeSelect = document.createElement('select'); modeSelect.dataset.imageSizeField = field.name; modeSelect.dataset.imageSizeKey = 'mode';
        const defaultOption = document.createElement('option'); defaultOption.value = ''; defaultOption.textContent = 'Custom dimensions'; modeSelect.append(defaultOption);
        let currentGroup = null; let optionGroup = null;
        for (const optionData of field.options || []) {
          if (optionData.group && optionData.group !== currentGroup) { currentGroup = optionData.group; optionGroup = document.createElement('optgroup'); optionGroup.label = currentGroup; modeSelect.append(optionGroup); }
          const option = document.createElement('option'); option.value = optionData.value; option.textContent = optionData.label; (optionData.group ? optionGroup : modeSelect).append(option);
        }
        modeSelect.value = String(field.value.mode ?? ''); mode.append(modeLabel, modeSelect); input.append(mode);
      } else if ((['select', 'radio', 'pageTree', 'radioTable', 'selectTree'].includes(field.widget) || (field.options?.length && !['checkbox', 'fileTree', 'inputUnit', 'imageSize', 'text', 'textarea', 'listWizard', 'rowWizard', 'tableWizard'].includes(field.widget))) && field.options?.length) {
        input = document.createElement('select');
        input.multiple = Boolean(field.multiple);
        if (field.widget === 'select' && !input.multiple) {
          const blank = document.createElement('option'); blank.value = ''; blank.textContent = 'Choose…'; input.append(blank);
        }
        for (const option of field.options) {
          const item = document.createElement('option'); item.value = option.value; item.textContent = option.label; input.append(item);
        }
        if (input.multiple) for (const option of input.options) option.selected = (Array.isArray(field.value) ? field.value : [field.value]).map(String).includes(option.value);
        else input.value = String(field.value ?? '');
      } else if (field.widget === 'rowWizard' && field.columns?.length) {
        input = document.createElement('div'); input.className = 'contao-live-edit-wizard-editor';
        const rows = document.createElement('div'); rows.className = 'contao-live-edit-wizard-rows';
        const columns = popover.dataset.editorMode === 'description-list' && field.name === 'data'
          ? field.columns.map((column) => ({ ...column, label: column.name === 'key' ? 'Term' : column.name === 'value' ? 'Description' : column.label }))
          : field.columns;
        const sourceRows = Array.isArray(field.value) ? field.value : [];
        const appendRow = (value = {}) => {
          const row = document.createElement('div'); row.className = 'contao-live-edit-wizard-row';
          for (const column of columns) {
            const cell = document.createElement('label'); cell.className = 'contao-live-edit-wizard-cell';
            const caption = document.createElement('span'); caption.textContent = column.label;
            const cellInput = document.createElement('input'); cellInput.type = 'text';
            cellInput.value = String(Array.isArray(value) ? value[columns.indexOf(column)] ?? '' : value?.[column.name] ?? '');
            cellInput.dataset.wizardField = field.name; cellInput.dataset.wizardColumn = column.name;
            cell.append(caption, cellInput); row.append(cell);
          }
          const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'contao-live-edit-wizard-remove'; remove.textContent = '×'; remove.title = 'Remove row';
          remove.addEventListener('click', () => row.remove()); row.append(remove); rows.append(row);
        };
        sourceRows.forEach(appendRow);
        const add = document.createElement('button'); add.type = 'button'; add.className = 'contao-live-edit-wizard-add'; add.textContent = '＋ Add row'; add.addEventListener('click', () => appendRow());
        input.append(rows, add);
      } else if (field.widget === 'listWizard') {
        input = document.createElement('div'); input.className = 'contao-live-edit-wizard-editor is-list-wizard';
        const rows = document.createElement('div'); rows.className = 'contao-live-edit-wizard-rows';
        const appendRow = (value = '') => {
          const row = document.createElement('div'); row.className = 'contao-live-edit-wizard-row';
          const cell = document.createElement('input'); cell.type = 'text'; cell.value = String(value); cell.dataset.wizardField = field.name; cell.dataset.wizardColumn = 'value';
          const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'contao-live-edit-wizard-remove'; remove.textContent = '×'; remove.title = 'Remove item';
          remove.addEventListener('click', () => row.remove()); row.append(cell, remove); rows.append(row);
        };
        (Array.isArray(field.value) ? field.value : []).forEach(appendRow);
        const add = document.createElement('button'); add.type = 'button'; add.className = 'contao-live-edit-wizard-add'; add.textContent = '＋ Add item'; add.addEventListener('click', () => appendRow());
        input.append(rows, add);
      } else if (field.widget === 'textarea' || ['rowWizard', 'tableWizard'].includes(field.widget) || Array.isArray(field.value)) {
        input = document.createElement('textarea'); input.rows = ['rowWizard', 'tableWizard'].includes(field.widget) ? 5 : 4;
        if (['rowWizard', 'tableWizard'].includes(field.widget)) input.value = (Array.isArray(field.value) ? field.value : []).map((row) => (Array.isArray(row) ? row : Object.values(row || {})).map(String).join('\t')).join('\n');
        else if (Array.isArray(field.value)) { input.value = JSON.stringify(field.value ?? [], null, 2); input.dataset.jsonStructuredValue = 'true'; }
        else input.value = String(field.value ?? '');
        if (field.richText) { input.classList.add('contao-live-edit-native-rte'); input.rows = 9; }
        if (['code', 'html', 'unfilteredHtml'].includes(field.name)) { input.classList.add('contao-live-edit-source-editor'); input.rows = field.name === 'code' ? 18 : 14; input.spellcheck = false; wrapper.classList.add('is-source-field'); }
        if (field.name === 'markdownSource' || field.name === 'highlight') wrapper.classList.add('is-quick-select');
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
      if (field.required && input.matches?.('input,textarea,select') && input.type !== 'hidden') { input.dataset.conditionalRequired = 'true'; input.required = !field.dependencyGroups?.length; }
      wrapper.append(input);
      if (field.description && !(popover.dataset.editorMode === 'markdown' && field.name === 'code')) { const hint = document.createElement('small'); hint.textContent = field.description; wrapper.append(hint); }
      if (field.widget === 'fileTree') {
        const selectedView = document.createElement('div'); selectedView.className = 'contao-live-edit-element-selected-files';
        const renderSelected = () => {
          selectedView.replaceChildren();
          let selected = []; try { selected = JSON.parse(input.value || '[]'); } catch {}
          for (const uuid of selected) {
            const item = (field.selectedFiles || []).find((file) => file.uuid === uuid);
            const card = document.createElement('div'); card.className = 'contao-live-edit-element-selected-file';
            if (item?.type === 'image' && item.url) { const image = document.createElement('img'); image.src = item.url; image.alt = item.name; card.append(image); }
            else { const fileIcon = document.createElement('span'); fileIcon.className = 'contao-live-edit-element-file-icon'; fileIcon.textContent = '▤'; card.append(fileIcon); }
            const name = document.createElement('span'); name.textContent = item?.name || 'Selected file'; card.append(name);
            const remove = document.createElement('button'); remove.type = 'button'; remove.setAttribute('aria-label', `Remove ${item?.name || 'selected file'}`); remove.textContent = '×';
            remove.addEventListener('click', () => { input.value = JSON.stringify(selected.filter((value) => value !== uuid)); renderSelected(); }); card.append(remove); selectedView.append(card);
          }
          if (!selected.length) { const empty = document.createElement('span'); empty.className = 'contao-live-edit-element-file-empty'; empty.textContent = 'No file selected'; selectedView.append(empty); }
        };
        renderSelected();
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
              const choice = document.createElement('button'); choice.type = 'button'; choice.className = `contao-live-edit-element-file-choice${item.type === 'folder' ? ' is-folder' : ''}`;
              if (item.type === 'image' && item.url) { const thumbnail = document.createElement('img'); thumbnail.src = item.url; thumbnail.alt = ''; choice.append(thumbnail); }
              const name = document.createElement('span'); name.textContent = item.type === 'folder' ? `▰ ${item.name}` : item.name; choice.append(name);
              if (item.type === 'folder') choice.addEventListener('click', () => { folders.push(item.uuid); load(); });
              else choice.addEventListener('click', () => {
                let selected; try { selected = JSON.parse(input.value || '[]'); } catch { selected = []; }
                if (!Array.isArray(selected)) selected = [];
                selected = field.multiple ? (selected.includes(item.uuid) ? selected.filter((uuid) => uuid !== item.uuid) : [...selected, item.uuid]) : [item.uuid];
                input.value = JSON.stringify(selected); input.dispatchEvent(new Event('input', { bubbles: true }));
                field.selectedFiles = field.selectedFiles || [];
                field.selectedFiles = field.selectedFiles.filter((file) => file.uuid !== item.uuid);
                field.selectedFiles.push({ uuid: item.uuid, name: item.name, type: item.type, url: item.url });
                renderSelected();
                choice.classList.toggle('is-selected', selected.includes(item.uuid));
                if (!field.multiple) library.hidden = true;
              });
              library.append(choice);
            }
            if (!result.items.length) { const empty = document.createElement('small'); empty.textContent = 'No files in this folder.'; library.append(empty); }
          } catch (error) { const message = document.createElement('small'); message.textContent = error.message || 'Could not load files.'; library.replaceChildren(message); }
        };
        choose.addEventListener('click', load); wrapper.append(input, selectedView, choose, library);
      }
      return wrapper;
    };
    const appendFields = (container, fields) => {
      const imageSelectorNames = new Set(fields.filter((field) => field.name === 'addImage' && field.widget === 'checkbox').map((field) => field.name));
      const imageOptions = [];
      const normalFields = [];
      for (const field of fields) {
        const dependsOnImageToggle = field.dependencyGroups?.some((group) => group.some((condition) => imageSelectorNames.has(condition.field)));
        (dependsOnImageToggle ? imageOptions : normalFields).push(field);
      }
      const dates = [];
      const orderedFields = [];
      for (let index = 0; index < normalFields.length; index++) {
        const field = normalFields[index];
        if (field.name === 'start' && normalFields[index + 1]?.name === 'stop') dates.push(field, normalFields[++index]);
        else {
          orderedFields.push(field);
          if (imageSelectorNames.has(field.name)) orderedFields.push(...imageOptions.splice(0));
        }
      }
      orderedFields.push(...imageOptions, ...dates);
      for (let index = 0; index < orderedFields.length; index++) {
        const field = orderedFields[index];
        if (field.name === 'start' && orderedFields[index + 1]?.name === 'stop') {
          const dates = document.createElement('div'); dates.className = 'contao-live-edit-element-date-range';
          dates.append(controlFor(field), controlFor(orderedFields[++index])); container.append(dates);
        } else container.append(controlFor(field));
      }
    };

    try {
      const response = await fetch(`/contao-live-edit/element-fields/${encodeURIComponent(id)}`, { credentials: 'same-origin', headers: { 'X-Requested-With': 'XMLHttpRequest' } });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not load element settings.');
      const editorMode = result.editorMode || 'generic';
      popover.dataset.editorMode = editorMode;
      popover.classList.toggle('is-wide', ['code', 'markdown', 'description-list', 'html'].includes(editorMode));
      popover.classList.toggle('is-code-editor', editorMode === 'code');
      renderVisibilityButton(Boolean(result.invisible));
      const type = record.dataset.contaoLiveEditType;
      const videoType = ['youtube', 'vimeo'].includes(type);
      const titles = { code: 'Edit code', markdown: 'Edit Markdown', 'description-list': 'Edit description list', html: 'Edit HTML', toplink: 'Edit top link' };
      const guidance = { code: 'Edit the source and choose its syntax from the quick selector.', markdown: 'Choose a source, then edit the Markdown content or select a source file.', 'description-list': 'Edit each term and description as a separate row.', html: 'Edit the HTML source directly.', toplink: 'Change the label used by the back-to-top link.' };
      popover.querySelector('h2').textContent = result.fields.length ? (videoType ? `Set ${type === 'youtube' ? 'YouTube' : 'Vimeo'} video` : titles[editorMode] || `${type.replaceAll('_', ' ')} settings`) : 'No editable fields';
      popover.querySelector('.contao-live-edit-element-header p').textContent = videoType ? 'Paste the video link, check the preview, then save.' : guidance[editorMode] || 'Edit the key fields here. Open Advanced settings for the rest of Contao’s options.';
      fieldPanel.replaceChildren();
      const mainFields = videoType ? result.fields.filter((field) => [type, 'titleText'].includes(field.name)) : result.fields.filter((field) => !field.advanced);
      const extraFields = videoType ? result.fields.filter((field) => !mainFields.includes(field)) : result.fields.filter((field) => field.advanced);
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
      } else appendFields(fieldPanel, mainFields);
      if (extraFields.length) {
        const details = document.createElement('details'); details.className = 'contao-live-edit-element-extra';
        const summary = document.createElement('summary'); summary.textContent = `Advanced settings · ${extraFields.length} fields`; details.append(summary);
        appendFields(details, extraFields);
        fieldPanel.append(details);
      }
      const refreshDependentFields = () => {
        for (const dependent of fieldPanel.querySelectorAll('[data-dependency-groups]')) {
          let groups = []; try { groups = JSON.parse(dependent.dataset.dependencyGroups); } catch {}
          const active = groups.some((group) => group.every((condition) => {
            const selector = fieldPanel.querySelector(`[name="${CSS.escape(condition.field)}"]`);
            if (!selector) return false;
            const actual = selector.type === 'checkbox' ? selector.checked : selector.value;
            return typeof condition.value === 'boolean' ? Boolean(actual) === condition.value : String(actual) === String(condition.value);
          }));
          dependent.hidden = !active;
          dependent.querySelectorAll('[data-conditional-required="true"]').forEach((control) => { control.required = active; });
        }
      };
      fieldPanel.addEventListener('change', refreshDependentFields);
      fieldPanel.addEventListener('input', refreshDependentFields);
      refreshDependentFields();
      const richTextareas = [...fieldPanel.querySelectorAll('textarea.contao-live-edit-native-rte')];
      if (richTextareas.length && window.hugerte?.init) {
        for (const textarea of richTextareas) {
          textarea.id = `contao-live-edit-rte-${id}-${textarea.name}`;
          const editorOptions = {
            target: textarea,
            height: 300,
            menubar: false,
            branding: false,
            promotion: false,
            statusbar: false,
            element_format: 'html',
              language: document.documentElement.lang || 'en',
              element_format: 'html',
              entities: '160,nbsp,60,lt,62,gt,173,shy',
              skin: document.documentElement.dataset.contaoLiveEditTheme === 'dark' ? 'oxide-dark' : 'oxide',
              plugins: 'autosave charmap code fullscreen help image importcss link lists searchreplace stripnbsp table visualblocks visualchars',
              menubar: 'file edit insert view format table help',
              toolbar: 'link unlink | image | blocks | bold italic | alignleft aligncenter alignright alignjustify | bullist numlist outdent indent | code',
              extended_valid_elements: 'q[cite|class|title],article,section,hgroup,figure,figcaption',
              contextmenu: false,
              paste_data_images: false,
              browser_spellcheck: true,
              importcss_append: true,
              branding: false,
              content_style: document.documentElement.dataset.contaoLiveEditTheme === 'dark'
                ? 'body{background:#202427;color:#e8e9e7;font-family:system-ui,sans-serif;font-size:14px;line-height:1.6;padding:8px 12px}a{color:#ff7900}'
                : 'body{background:#fff;color:#293d32;font-family:system-ui,sans-serif;font-size:14px;line-height:1.6;padding:8px 12px}a{color:#c75b22}',
            setup: (editor) => editor.on('change input undo redo', () => { textarea.value = editor.getContent(); textarea.dispatchEvent(new Event('input', { bubbles: true })); }),
          };
          try { await window.hugerte.init(editorOptions); }
          catch (error) { console.warn('Contao rich-text editor could not be initialized.', error); }
        }
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
        if (input.dataset.arrayField || input.dataset.imageSizeField || input.dataset.cssIdField || input.dataset.wizardField) continue;
        if (input.dataset.unitValue) { values[input.dataset.unitValue] = { ...(values[input.dataset.unitValue] || {}), value: input.value }; continue; }
        if (input.dataset.unitName) { values[input.dataset.unitName] = { ...(values[input.dataset.unitName] || {}), unit: input.value }; continue; }
        if (input.dataset.widget === 'checkbox') values[input.name] = input.checked;
        else if (input.dataset.widget === 'datetime') values[input.name] = input.value ? String(Math.floor(new Date(input.value).getTime() / 1000)) : '';
        else if (input.dataset.widget === 'pageTree' && input.multiple) values[input.name] = [...input.selectedOptions].map((option) => option.value);
        else if (input.dataset.widget === 'fileTree') {
          try { values[input.name] = JSON.parse(input.value || '[]'); } catch { status.textContent = 'Choose files from the library or enter valid JSON.'; status.classList.add('is-error'); submit.disabled = false; return; }
        }
        else if (input.dataset.widget === 'listWizard') values[input.name] = input.value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
        else if (['rowWizard', 'tableWizard'].includes(input.dataset.widget)) values[input.name] = input.value.split(/\r?\n/).filter(Boolean).map((line) => line.split('\t'));
        else if (input.dataset.jsonStructuredValue || input.dataset.widget === 'imageSize' || (input.tagName === 'TEXTAREA' && input.value.trim().startsWith('['))) {
          try { values[input.name] = JSON.parse(input.value); } catch { status.textContent = 'Enter valid JSON for this structured field.'; status.classList.add('is-error'); submit.disabled = false; return; }
        }
        else if (input.classList.contains('contao-live-edit-native-rte') && window.hugerte?.get(input.id)) values[input.name] = window.hugerte.get(input.id).getContent();
        else values[input.name] = input.value;
      }
      for (const name of new Set([...fieldPanel.querySelectorAll('[data-css-id-field]')].map((input) => input.dataset.cssIdField))) {
        values[name] = Object.fromEntries([...fieldPanel.querySelectorAll(`[data-css-id-field="${CSS.escape(name)}"]`)].map((input) => [input.dataset.cssIdKey, input.value]));
      }
      for (const name of new Set([...fieldPanel.querySelectorAll('[data-array-field]')].map((input) => input.dataset.arrayField))) {
        values[name] = [...fieldPanel.querySelectorAll(`[data-array-field="${CSS.escape(name)}"]`)].sort((a, b) => Number(a.dataset.arrayIndex) - Number(b.dataset.arrayIndex)).map((input) => input.value);
      }
      for (const name of new Set([...fieldPanel.querySelectorAll('[data-wizard-field]')].map((input) => input.dataset.wizardField))) {
        const rowMap = new Map();
        for (const input of fieldPanel.querySelectorAll(`[data-wizard-field="${CSS.escape(name)}"]`)) {
          const row = input.closest('.contao-live-edit-wizard-row');
          if (!rowMap.has(row)) rowMap.set(row, {});
          rowMap.get(row)[input.dataset.wizardColumn] = input.value;
        }
        const listWizard = fieldPanel.querySelector(`[data-wizard-field="${CSS.escape(name)}"]`)?.closest('.is-list-wizard');
        values[name] = [...rowMap.values()].map((row) => listWizard ? row.value : row);
      }
      for (const name of new Set([...fieldPanel.querySelectorAll('[data-image-size-field]')].map((input) => input.dataset.imageSizeField))) {
        values[name] = Object.fromEntries([...fieldPanel.querySelectorAll(`[data-image-size-field="${CSS.escape(name)}"]`)].map((input) => [input.dataset.imageSizeKey, input.value]));
      }
      values.invisible = visibilityButton.dataset.hidden === 'true';
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
    const firstField = fieldPanel.querySelector('.contao-live-edit-source-editor') || fieldPanel.querySelector('.contao-live-edit-wizard-editor input, input:not([type="hidden"]),textarea,select');
    (firstField || popover.querySelector('[type="submit"]')).focus();
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
      if (record && !record.matches('[data-contao-live-edit-type="image"],[data-contao-live-edit-type="hyperlink"]')) {
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
