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
  bar.className = 'slowhouse-inline-bar is-ready';
  bar.setAttribute('role', 'region');
  bar.setAttribute('aria-label', 'Inline text editor');
  bar.innerHTML = '<span class="slowhouse-inline-hint">Double-click any text to edit</span><span class="slowhouse-inline-status" aria-live="polite"></span><button type="button" data-action="toggle">Edit text</button><button type="button" data-action="cancel">Cancel</button><button type="button" data-action="save">Save</button>';
  document.body.append(bar);

  const status = bar.querySelector('.slowhouse-inline-status');
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
    document.body.classList.toggle('slowhouse-text-editing', active);
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
      if (candidate.closest('.slowhouse-inline-bar, .slowhouse-edit-popover')) return false;
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
    if (!fieldName || editable.closest('.slowhouse-inline-bar, .slowhouse-edit-popover')) return null;
    const field = 'headline' === fieldName && heading ? heading : editable;
    field.dataset.inlineRecord = editable.dataset.contaoLiveEditRecord;
    field.dataset.inlineField = fieldName;
    return field;
  };

  const recordForTarget = (target) => target.closest('[data-contao-live-edit-record][data-contao-live-edit-type]');
  const hasDragType = (event, type) => Array.from(event.dataTransfer?.types || []).includes(type);
  const isContentDrag = (event) => hasDragType(event, 'application/x-slowhouse-element');
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
    if (!isActive() || record.querySelector(':scope > .slowhouse-move-handle')) return;
    if ('static' === window.getComputedStyle(record).position) record.style.position = 'relative';
    const handle = document.createElement('button');
    handle.type = 'button';
    handle.className = 'slowhouse-move-handle';
    handle.draggable = true;
    handle.title = 'Drag to rearrange';
    handle.setAttribute('aria-label', 'Drag to rearrange this element');
    handle.textContent = '⠿';
    handle.addEventListener('click', (event) => event.stopPropagation());
    handle.addEventListener('dragstart', (event) => {
      event.stopPropagation();
      event.dataTransfer.setData('application/x-slowhouse-record', record.dataset.contaoLiveEditRecord);
      event.dataTransfer.effectAllowed = 'move';
      record.classList.add('slowhouse-is-moving');
    });
    handle.addEventListener('dragend', () => record.classList.remove('slowhouse-is-moving'));
    record.append(handle);
  };

  document.addEventListener('pointerover', (event) => {
    if (!isActive()) return;
    const record = recordForTarget(event.target);
    if (record && !record.closest('.slowhouse-inline-bar, .slowhouse-edit-popover')) addMoveHandle(record);
  });

  document.addEventListener('dragover', (event) => {
    if (!isActive() || (!isContentDrag(event) && !hasDragType(event, 'application/x-slowhouse-record'))) return;
    const record = recordForTarget(event.target);
    if (!record) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = isContentDrag(event) ? 'copy' : 'move';
    document.querySelectorAll('.slowhouse-drop-before,.slowhouse-drop-after').forEach((node) => node.classList.remove('slowhouse-drop-before', 'slowhouse-drop-after'));
    const placement = event.clientY < record.getBoundingClientRect().top + record.getBoundingClientRect().height / 2 ? 'before' : 'after';
    record.classList.add(`slowhouse-drop-${placement}`);
  });

  document.addEventListener('dragleave', (event) => {
    if (event.target === document.documentElement) document.querySelectorAll('.slowhouse-drop-before,.slowhouse-drop-after').forEach((node) => node.classList.remove('slowhouse-drop-before', 'slowhouse-drop-after'));
  });

  document.addEventListener('drop', async (event) => {
    const record = recordForTarget(event.target);
    if (!isActive() || !record) return;
    const newType = event.dataTransfer?.getData('application/x-slowhouse-element');
    const movingId = event.dataTransfer?.getData('application/x-slowhouse-record');
    if (!newType && !movingId) return;
    event.preventDefault();
    event.stopPropagation();
    const rect = record.getBoundingClientRect();
    const placement = event.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
    document.querySelectorAll('.slowhouse-drop-before,.slowhouse-drop-after').forEach((node) => node.classList.remove('slowhouse-drop-before', 'slowhouse-drop-after'));
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
    popover.className = 'slowhouse-edit-popover slowhouse-link-popover';
    popover.setAttribute('role', 'dialog');
    popover.setAttribute('aria-label', 'Edit link');
    popover.innerHTML = '<div class="slowhouse-popover-heading">Edit link</div>' +
      '<label>Text<input name="label" maxlength="255" required></label>' +
      '<label>URL<input name="url" maxlength="2048" placeholder="https://… or /contact" required></label>' +
      '<label>Title<input name="title" maxlength="255"></label>' +
      '<label>Lightbox group<input name="rel" maxlength="64" placeholder="e.g. gallery"></label>' +
      '<label class="slowhouse-popover-check"><input name="target" type="checkbox"> Open in a new tab</label>' +
      '<div class="slowhouse-popover-actions"><span class="slowhouse-popover-status" aria-live="polite"></span><button type="button" data-action="cancel">Cancel</button><button type="submit">Save link</button></div>';
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
      const message = popover.querySelector('.slowhouse-popover-status');
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
    popover.className = 'slowhouse-edit-popover slowhouse-image-modal';
    popover.setAttribute('role', 'dialog');
    popover.setAttribute('aria-modal', 'true');
    popover.setAttribute('aria-label', 'Edit image');
    popover.innerHTML = '<div class="slowhouse-image-modal-card">' +
      '<header class="slowhouse-image-modal-header"><div><span class="slowhouse-modal-kicker">IMAGE</span><h2>Replace or edit image</h2><p>Upload a new image and update its key display settings.</p></div><button type="button" class="slowhouse-modal-close" data-action="cancel" aria-label="Close">×</button></header>' +
      '<div class="slowhouse-image-modal-content"><div class="slowhouse-image-preview"><img alt="Current image preview"></div>' +
      '<div class="slowhouse-image-dropzone" tabindex="0" role="button" aria-label="Choose or drop an image"><span class="slowhouse-upload-icon" aria-hidden="true">↑</span><strong data-file-name>Drop an image here</strong><span>JPG, PNG, GIF, WebP or AVIF · up to 15 MB</span><div class="slowhouse-image-source-actions"><button type="button" data-action="browse">Upload image</button><button type="button" data-action="library">Choose from library</button></div><input name="file" type="file" accept="image/jpeg,image/png,image/gif,image/webp,image/avif" hidden></div>' +
      '<section class="slowhouse-image-library" data-image-library hidden aria-label="Contao file library"></section>' +
      '<div class="slowhouse-image-fields"><label>Alternative text<input name="alt" maxlength="255" placeholder="Describe the image"></label><label>Image title<input name="title" maxlength="255" placeholder="Optional title"></label><label class="slowhouse-caption-field">Caption<textarea name="caption" maxlength="500" rows="2" placeholder="Optional caption"></textarea></label></div></div>' +
      '<footer class="slowhouse-image-modal-footer"><span class="slowhouse-popover-status" aria-live="polite"></span><button type="button" data-action="cancel">Cancel</button><button type="submit">Save image</button></footer></div>';
    document.body.append(popover);
    const preview = popover.querySelector('.slowhouse-image-preview img');
    preview.src = image.currentSrc || image.src;
    popover.elements.alt.value = image.alt || '';
    popover.elements.title.value = image.title || '';
    popover.elements.caption.value = caption;

    const fileInput = popover.elements.file;
    const dropzone = popover.querySelector('.slowhouse-image-dropzone');
    const fileName = popover.querySelector('[data-file-name]');
    const uploadStatus = popover.querySelector('.slowhouse-popover-status');
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
      loading.className = 'slowhouse-library-message';
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
        header.className = 'slowhouse-library-header';
        const title = document.createElement('strong');
        title.textContent = result.folder?.name || 'Contao file library';
        header.append(title);
        const navigation = document.createElement('div');
        navigation.className = 'slowhouse-library-navigation';
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
        grid.className = 'slowhouse-library-grid';
        for (const item of result.items) {
          const choice = document.createElement('button');
          choice.type = 'button';
          choice.className = item.type === 'folder' ? 'slowhouse-library-item is-folder' : 'slowhouse-library-item';
          if (item.type === 'folder') {
            choice.innerHTML = '<span class="slowhouse-library-folder-icon" aria-hidden="true">▰</span>';
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
          empty.className = 'slowhouse-library-message';
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

  document.addEventListener('click', (event) => {
    if (!isActive() || replayingClick || !event.target.closest('a') || event.target.closest('.slowhouse-inline-bar, .slowhouse-edit-popover, [data-inline-ignore-links]')) return;

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
    if (link?.closest('[data-contao-live-edit-type="hyperlink"]') && !link.closest('.slowhouse-inline-bar, .slowhouse-edit-popover')) {
      if (pendingClick) window.clearTimeout(pendingClick.timer);
      pendingClick = null;
      event.preventDefault();
      event.stopPropagation();
      openLinkEditor(link);
      return;
    }
    const image = event.target.closest('img') || elementAtPoint('img', event.clientX, event.clientY);
    if (image?.closest('[data-contao-live-edit-type="image"]') && !image.closest('.slowhouse-edit-popover')) {
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
    if (!field || !isActive()) return;
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
