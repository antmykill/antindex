/*
  gallery-loader.js
  通用静态图片展示加载器，适用于 GitHub Pages 静态站点。
  只要在 HTML 页面中指定 rootPath，就可以复用这个脚本加载不同目录下的图片。

  用法：
    1. 引入脚本：<script src="./gallery-loader.js"></script>
    2. 添加展示容器：<div id="message"></div><div id="gallery"></div>
    3. 在页面脚本中配置：
       GalleryLoader.initPage({
         rootPath: './artworks/age-restricted/',
         folderManifest: './artworks/age-restricted/folders.json',
       });

  如果 GitHub Pages 无法直接返回目录列表，可使用 folderManifest 或 folderNames。
*/
(function (global) {
  const defaultConfig = {
    targetId: 'gallery',
    messageId: 'message',
    rootPath: './artworks/age-restricted/',
    folderPattern: /^\d{8}_\d{3}$/,
    supportedExt: ['jpg', 'jpeg', 'png'],
    sizes: [400, 800, 1200],
    sortOrder: 'desc',
    description: '自动选择最合适的图片尺寸。',
    emptyFolderText: '未找到符合格式的子目录。子目录名应为 YYYYMMDD_NNN。',
    noItemsText: '没有可展示的作品。',
    folderNames: [],
    folderManifest: null,
    titleMap: null,
    titleMapManifest: null,
    collapsibleCards: false,
    collapsedByDefault: false,
    allowDirectoryListing: true,
    commentsEnabled: true,
    giscusConfig: {
      repo: '',
      repoId: '',
      category: 'General',
      categoryId: '',
      mapping: 'specific',
      termPrefix: 'gallery',
      strict: '0',
      reactionsEnabled: '1',
      emitMetadata: '0',
      inputPosition: 'bottom',
      theme: 'preferred_color_scheme',
      lang: 'zh-CN',
      loading: 'lazy'
    }
  };

  let collapsibleStylesInjected = false;

  function ensureCollapsibleCardStyles() {
    if (collapsibleStylesInjected) return;
    const style = document.createElement('style');
    style.textContent = `
      .gallery-card {
        background: rgba(255,255,255,0.04);
        border: 1px solid rgba(255,255,255,0.08);
        border-radius: 18px;
        overflow: hidden;
      }
      .gallery-card-header {
        display: flex;
        align-items: center;
        width: 100%;
        border: none;
        background: transparent;
        padding: 18px;
        text-align: left;
        color: #f4f4f8;
        font-size: 1.2rem;
        font-weight: 600;
        cursor: pointer;
      }
      .gallery-card-header.collapsible { cursor: pointer; }
      .gallery-card-header:not(.collapsible) { cursor: default; }
      .gallery-card-arrow {
        display: inline-block;
        margin-right: 10px;
        width: 18px;
        text-align: center;
        transition: transform 0.2s ease;
      }
      .gallery-card-title {
        flex: 1;
      }
      .gallery-card-content {
        display: block;
      }
      .gallery-card-content.collapsed {
        display: none;
      }
      .gallery-card-header.collapsible[aria-expanded="false"] .gallery-card-arrow {
        transform: rotate(0deg);
      }
      .gallery-card-header.collapsible[aria-expanded="true"] .gallery-card-arrow {
        transform: rotate(90deg);
      }
    `;
    document.head.appendChild(style);
    collapsibleStylesInjected = true;
  }

  async function xhrText(url) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('GET', url, true);
      xhr.responseType = 'text';
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(xhr.responseText);
        } else if (xhr.status === 0 && xhr.responseText) {
          resolve(xhr.responseText);
        } else {
          reject(new Error(`XHR 无法读取 ${url}：${xhr.status}`));
        }
      };
      xhr.onerror = () => reject(new Error(`XHR 无法读取 ${url}`));
      xhr.send();
    });
  }

  async function fetchText(url) {
    try {
      const response = await fetch(url, { cache: 'no-store' });
      if (!response.ok) {
        throw new Error(`无法读取 ${url}：${response.status} ${response.statusText}`);
      }
      return await response.text();
    } catch (error) {
      if (typeof window !== 'undefined' && window.location.protocol === 'file:') {
        return await xhrText(url);
      }
      throw error;
    }
  }

  async function fetchExists(url) {
    try {
      const response = await fetch(url, { method: 'HEAD', cache: 'no-store' });
      if (response.ok) {
        return true;
      }
      if (response.status === 405 || response.status === 501) {
        const fallback = await fetch(url, { method: 'GET', cache: 'no-store' });
        return fallback.ok;
      }
    } catch {
      return false;
    }
    return false;
  }

  async function checkImageUrl(url) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(true);
      img.onerror = () => resolve(false);
      img.src = url;
    });
  }

  async function urlExists(url) {
    if (typeof window !== 'undefined' && window.location.protocol === 'file:') {
      return await checkImageUrl(url);
    }

    const exists = await fetchExists(url);
    if (exists) return true;
    return await checkImageUrl(url);
  }

  function normalizePath(path) {
    if (!path.endsWith('/')) {
      path += '/';
    }
    return path;
  }

  function parseDirectoryListing(html, baseUrl) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    return Array.from(doc.querySelectorAll('a[href]'))
      .map((link) => link.getAttribute('href'))
      .filter((href) => href && href !== '../')
      .map((href) => {
        try {
          const url = new URL(href, baseUrl);
          if (url.pathname.endsWith('/')) {
            return decodeURIComponent(url.pathname.replace(/\/$/, '').split('/').pop() || '');
          }
        } catch {
          return null;
        }
        return null;
      })
      .filter((name) => name);
  }

  async function listFolders(rootPath, folderPattern) {
    const html = await fetchText(rootPath);
    return parseDirectoryListing(html, rootPath).filter((name) => folderPattern.test(name));
  }

  function sortFolderNames(folderNames, sortOrder) {
    return folderNames.slice().sort((a, b) => {
      if (sortOrder === 'asc') return a.localeCompare(b);
      return b.localeCompare(a);
    });
  }

  async function loadFolderNames(config) {
    if (Array.isArray(config.folderNames) && config.folderNames.length) {
      return config.folderNames.slice();
    }

    if (config.folderManifest) {
      try {
        const text = await fetchText(config.folderManifest);
        const json = JSON.parse(text);
        if (Array.isArray(json)) {
          return json.filter((name) => config.folderPattern.test(name));
        }
      } catch (error) {
        console.warn('无法加载 folderManifest:', error);
      }
    }

    if (config.allowDirectoryListing) {
      try {
        return await listFolders(config.rootPath, config.folderPattern);
      } catch (error) {
        console.warn('目录列表读取失败:', error);
      }
    }

    return [];
  }

  async function loadTitleMap(config) {
    if (config.titleMapManifest) {
      try {
        const text = await fetchText(config.titleMapManifest);
        const json = JSON.parse(text);
        if (json && typeof json === 'object' && !Array.isArray(json)) {
          return json;
        }
      } catch (error) {
        console.warn('无法加载 titleMapManifest:', error);
      }
    }

    if (config.titleMap && typeof config.titleMap === 'object') {
      return config.titleMap;
    }

    return {};
  }

  async function findResponsiveFiles(rootPath, folderName, supportedExt, sizes) {
    const folderRoot = `${rootPath}${folderName}/`;
    const result = { small: null, medium: null, large: null };
    const sizeMap = { 400: 'small', 800: 'medium', 1200: 'large' };

    for (const width of sizes) {
      for (const ext of supportedExt) {
        const url = `${folderRoot}${folderName}_w${width}.${ext}`;
        if (await urlExists(url)) {
          result[sizeMap[width]] = url;
          break;
        }
      }
    }

    return result;
  }

  function captionText(folderName, files, config) {
    return '';
  }

  function getFolderTitle(folderName, config) {
    return (config.titleMap && config.titleMap[folderName]) || folderName;
  }

  function slugify(value) {
    return String(value)
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'gallery';
  }

  function getStableImageId(folderName, files, config) {
    const explicitId = config?.imageIdMap && config.imageIdMap[folderName];
    if (explicitId) {
      return slugify(explicitId);
    }

    const prefix = String(config?.giscusConfig?.termPrefix || 'gallery').trim() || 'gallery';
    const folderToken = slugify(folderName || 'gallery');
    return `${prefix}-${folderToken}`;
  }

  function getCommentLink(folderName, files, config) {
    const term = getStableImageId(folderName, files, config);

    const repo = String(config.giscusConfig?.repo || '').trim();
    if (!repo) return null;

    const encodedTerm = encodeURIComponent(term);
    const encodedRepo = encodeURIComponent(repo);
    return `https://giscus.app/client.js?repo=${encodedRepo}&category=${encodeURIComponent(String(config.giscusConfig?.category || 'General'))}&mapping=${encodeURIComponent(String(config.giscusConfig?.mapping || 'specific'))}&term=${encodedTerm}`;
  }

  function createCommentSection(folderName, files, config) {
    if (!config.commentsEnabled) return null;

    const giscus = config.giscusConfig || {};
    const repo = String(giscus.repo || '').trim();
    const repoId = String(giscus.repoId || '').trim();
    const categoryId = String(giscus.categoryId || '').trim();

    const wrapper = document.createElement('div');
    wrapper.style.marginTop = '16px';
    wrapper.style.padding = '14px 16px 12px';
    wrapper.style.borderTop = '1px solid rgba(255,255,255,0.12)';
    wrapper.style.background = 'linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0.02))';
    wrapper.style.borderRadius = '0 0 16px 16px';

    const stableImageId = getStableImageId(folderName, files, config);
    const commentTerm = stableImageId;
    const params = new URLSearchParams({
      image: files.large || files.medium || files.small || '',
      title: `${folderName} 的评论`,
      repo,
      repoId,
      category: String(giscus.category || 'Announcements'),
      categoryId,
      term: commentTerm,
      imageId: stableImageId,
      returnTo: window.location.pathname + window.location.search + window.location.hash
    });

    const button = document.createElement('a');
    button.href = `./comment-page.html?${params.toString()}`;
    button.target = '_blank';
    button.rel = 'noopener noreferrer';
    button.style.display = 'inline-flex';
    button.style.alignItems = 'center';
    button.style.justifyContent = 'center';
    button.style.padding = '10px 14px';
    button.style.borderRadius = '10px';
    button.style.background = 'rgba(255,255,255,0.06)';
    button.style.color = '#f4f4f8';
    button.style.textDecoration = 'none';
    button.style.fontSize = '0.95rem';
    button.style.fontWeight = '600';
    button.textContent = '为这张图留言';

    wrapper.appendChild(button);

    if (!repo || !repoId || !categoryId) {
      const notice = document.createElement('div');
      notice.style.marginTop = '10px';
      notice.style.padding = '12px 14px';
      notice.style.borderRadius = '12px';
      notice.style.background = 'rgba(255,255,255,0.05)';
      notice.style.border = '1px dashed rgba(255,255,255,0.14)';
      notice.style.color = '#c8c8d2';
      notice.style.fontSize = '0.92rem';
      notice.style.lineHeight = '1.6';
      notice.innerHTML = '评论入口已就绪，但当前仓库配置还未完成，暂时显示为留言入口。';
      wrapper.appendChild(notice);
      return wrapper;
    }

    return wrapper;
  }

  function createCard(folderName, files, caption, config) {
    const card = document.createElement('article');
    card.style.background = 'rgba(255,255,255,0.04)';
    card.style.border = '1px solid rgba(255,255,255,0.08)';
    card.style.borderRadius = '18px';
    card.style.overflow = 'hidden';

    const displayTitle = getFolderTitle(folderName, config);
    const collapsed = !!config.collapsibleCards && !!config.collapsedByDefault;

    const header = config.collapsibleCards ? document.createElement('button') : document.createElement('div');
    header.className = `gallery-card-header${config.collapsibleCards ? ' collapsible' : ''}`;
    header.style.display = 'flex';
    header.style.alignItems = 'center';
    header.style.width = '100%';
    header.style.border = 'none';
    header.style.background = 'transparent';
    header.style.padding = '18px';
    header.style.textAlign = 'left';
    header.style.color = '#f4f4f8';
    header.style.fontSize = '1.2rem';
    header.style.fontWeight = '600';
    header.style.outline = 'none';
    header.style.cursor = config.collapsibleCards ? 'pointer' : 'default';

    if (config.collapsibleCards) {
      ensureCollapsibleCardStyles();
      header.type = 'button';
      header.setAttribute('aria-expanded', String(!collapsed));
    }

    const arrow = document.createElement('span');
    arrow.className = 'gallery-card-arrow';
    arrow.textContent = '▶';
    if (!config.collapsibleCards) {
      arrow.style.visibility = 'hidden';
    }

    const titleText = document.createElement('span');
    titleText.className = 'gallery-card-title';
    titleText.style.flex = '1';
    titleText.textContent = displayTitle;

    header.appendChild(arrow);
    header.appendChild(titleText);
    card.appendChild(header);

    const content = document.createElement('div');
    content.className = `gallery-card-content${collapsed ? ' collapsed' : ''}`;

    if (config.collapsibleCards) {
      header.addEventListener('click', () => {
        const isCollapsed = content.classList.toggle('collapsed');
        header.setAttribute('aria-expanded', String(!isCollapsed));
      });
    }

    const figure = document.createElement('figure');
    figure.style.margin = '0';

    const picture = document.createElement('picture');
    if (files.small) {
      const source = document.createElement('source');
      source.media = '(max-width: 640px)';
      source.srcset = files.small;
      picture.appendChild(source);
    }
    if (files.medium) {
      const source = document.createElement('source');
      source.media = '(max-width: 1024px)';
      source.srcset = files.medium;
      picture.appendChild(source);
    }

    const fallback = files.large || files.medium || files.small || '';
    const img = document.createElement('img');
    img.src = fallback;
    img.alt = displayTitle;
    img.loading = 'lazy';
    img.style.display = 'block';
    img.style.width = '100%';
    img.style.height = 'auto';
    img.style.cursor = 'zoom-in';
    img.addEventListener('click', () => {
      showZoomOverlay(files.large || files.medium || files.small, displayTitle);
    });
    picture.appendChild(img);

    figure.appendChild(picture);

    const captionEl = document.createElement('figcaption');
    captionEl.textContent = caption;
    captionEl.style.padding = '14px 18px 18px';
    captionEl.style.color = '#d4d4e1';
    captionEl.style.fontSize = '0.95rem';

    const downloadUrl = files.large;
    if (downloadUrl) {
      const downloadBtn = document.createElement('a');
      downloadBtn.href = downloadUrl;
      downloadBtn.download = downloadUrl.slice(downloadUrl.lastIndexOf('/') + 1);
      downloadBtn.textContent = '下载';
      downloadBtn.style.display = 'inline-flex';
      downloadBtn.style.alignItems = 'center';
      downloadBtn.style.justifyContent = 'center';
      downloadBtn.style.marginTop = '12px';
      downloadBtn.style.padding = '10px 14px';
      downloadBtn.style.borderRadius = '12px';
      downloadBtn.style.border = '1px solid rgba(255,255,255,0.16)';
      downloadBtn.style.background = 'rgba(255,255,255,0.06)';
      downloadBtn.style.color = '#f4f4f8';
      downloadBtn.style.textDecoration = 'none';
      downloadBtn.style.fontSize = '0.95rem';
      downloadBtn.style.cursor = 'pointer';
      downloadBtn.style.transition = 'background 0.2s ease';
      downloadBtn.addEventListener('mouseover', () => { downloadBtn.style.background = 'rgba(255,255,255,0.12)'; });
      downloadBtn.addEventListener('mouseout', () => { downloadBtn.style.background = 'rgba(255,255,255,0.06)'; });
      captionEl.appendChild(document.createElement('br'));
      captionEl.appendChild(downloadBtn);
    }

    figure.appendChild(captionEl);

    const commentSection = createCommentSection(folderName, files, config);
    if (commentSection) {
      content.appendChild(figure);
      content.appendChild(commentSection);
    } else {
      content.appendChild(figure);
    }

    card.appendChild(content);
    return card;
  }

  function renderEmpty(container, text) {
    container.innerHTML = `<div style="padding:24px; border-radius:16px; background:rgba(255,255,255,0.04); border:1px dashed rgba(255,255,255,0.12); color:#c6c6d8;">${text}</div>`;
  }

  const zoomOverlayState = {
    container: null,
    wrapper: null,
    image: null,
    caption: null,
    translateX: 0,
    translateY: 0,
    maxOffsetX: 0,
    maxOffsetY: 0,
    scale: 1,
    dragging: false,
    startX: 0,
    startY: 0,
    moved: false,
    pointers: new Map(),
    pinchStartDistance: 0,
    pinchStartScale: 1,
    pinchStartTranslateX: 0,
    pinchStartTranslateY: 0,
    pinchStartMidX: 0,
    pinchStartMidY: 0
  };

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  function updateZoomLimits() {
    if (!zoomOverlayState.image || !zoomOverlayState.wrapper) return;
    const wrapperRect = zoomOverlayState.wrapper.getBoundingClientRect();
    const imgW = zoomOverlayState.image.naturalWidth * zoomOverlayState.scale;
    const imgH = zoomOverlayState.image.naturalHeight * zoomOverlayState.scale;
    zoomOverlayState.maxOffsetX = Math.max((imgW - wrapperRect.width) / 2, 0);
    zoomOverlayState.maxOffsetY = Math.max((imgH - wrapperRect.height) / 2, 0);
    zoomOverlayState.translateX = clamp(zoomOverlayState.translateX, -zoomOverlayState.maxOffsetX, zoomOverlayState.maxOffsetX);
    zoomOverlayState.translateY = clamp(zoomOverlayState.translateY, -zoomOverlayState.maxOffsetY, zoomOverlayState.maxOffsetY);
  }

  function updateZoomImageTransform() {
    if (!zoomOverlayState.image) return;
    updateZoomLimits();
    zoomOverlayState.image.style.transform = `translate(calc(-50% + ${zoomOverlayState.translateX}px), calc(-50% + ${zoomOverlayState.translateY}px)) scale(${zoomOverlayState.scale})`;
  }

  function hideZoomOverlay() {
    if (!zoomOverlayState.container) return;
    zoomOverlayState.container.style.display = 'none';
    if (zoomOverlayState.image) {
      zoomOverlayState.image.src = '';
    }
  }

  function createZoomOverlay() {
    if (zoomOverlayState.container) return;

    const container = document.createElement('div');
    container.style.position = 'fixed';
    container.style.inset = '0';
    container.style.background = 'rgba(0, 0, 0, 0.9)';
    container.style.display = 'none';
    container.style.justifyContent = 'center';
    container.style.alignItems = 'center';
    container.style.zIndex = '9999';
    container.style.overflow = 'hidden';
    container.style.cursor = 'zoom-out';

    const wrapper = document.createElement('div');
    wrapper.style.position = 'relative';
    wrapper.style.width = '100%';
    wrapper.style.height = '100%';
    wrapper.style.overflow = 'hidden';
    wrapper.style.touchAction = 'none';
    wrapper.style.userSelect = 'none';
    container.appendChild(wrapper);

    const image = document.createElement('img');
    image.style.position = 'absolute';
    image.style.top = '50%';
    image.style.left = '50%';
    image.style.transform = 'translate(-50%, -50%) scale(1)';
    image.style.maxWidth = 'none';
    image.style.maxHeight = 'none';
    image.style.cursor = 'grab';
    image.style.userSelect = 'none';
    image.draggable = false;
    image.style.willChange = 'transform';
    wrapper.appendChild(image);

    const caption = document.createElement('div');
    caption.style.position = 'absolute';
    caption.style.left = '0';
    caption.style.right = '0';
    caption.style.bottom = '24px';
    caption.style.margin = '0 auto';
    caption.style.maxWidth = '90%';
    caption.style.color = '#f4f4f8';
    caption.style.textAlign = 'center';
    caption.style.fontSize = '0.95rem';
    caption.style.pointerEvents = 'none';
    container.appendChild(caption);

    function getPointerMidpoint(points) {
      const x = (points[0].clientX + points[1].clientX) / 2;
      const y = (points[0].clientY + points[1].clientY) / 2;
      return { x, y };
    }

    function getWrapperCenterPoint(clientX, clientY) {
      const rect = zoomOverlayState.wrapper.getBoundingClientRect();
      return {
        x: clientX - (rect.left + rect.width / 2),
        y: clientY - (rect.top + rect.height / 2)
      };
    }

    image.addEventListener('pointerdown', (event) => {
      zoomOverlayState.pointers.set(event.pointerId, event);
      if (zoomOverlayState.pointers.size === 1) {
        zoomOverlayState.dragging = true;
        zoomOverlayState.startX = event.clientX;
        zoomOverlayState.startY = event.clientY;
        zoomOverlayState.moved = false;
        image.setPointerCapture(event.pointerId);
        image.style.cursor = 'grabbing';
      } else if (zoomOverlayState.pointers.size === 2) {
        zoomOverlayState.dragging = false;
        const points = Array.from(zoomOverlayState.pointers.values());
        zoomOverlayState.pinchStartDistance = Math.hypot(points[0].clientX - points[1].clientX, points[0].clientY - points[1].clientY);
        zoomOverlayState.pinchStartScale = zoomOverlayState.scale;
        zoomOverlayState.pinchStartTranslateX = zoomOverlayState.translateX;
        zoomOverlayState.pinchStartTranslateY = zoomOverlayState.translateY;
        const midpoint = getPointerMidpoint(points);
        const centerPoint = getWrapperCenterPoint(midpoint.x, midpoint.y);
        zoomOverlayState.pinchStartMidX = centerPoint.x;
        zoomOverlayState.pinchStartMidY = centerPoint.y;
      }
    });

    function endPointer(event) {
      zoomOverlayState.pointers.delete(event.pointerId);
      zoomOverlayState.pinchStartDistance = 0;
      if (zoomOverlayState.pointers.size === 1) {
        const remaining = Array.from(zoomOverlayState.pointers.values())[0];
        zoomOverlayState.dragging = true;
        zoomOverlayState.startX = remaining.clientX;
        zoomOverlayState.startY = remaining.clientY;
      } else {
        zoomOverlayState.dragging = false;
      }
      image.style.cursor = 'grab';
    }

    image.addEventListener('pointermove', (event) => {
      if (!zoomOverlayState.pointers.has(event.pointerId)) return;
      zoomOverlayState.pointers.set(event.pointerId, event);
      if (zoomOverlayState.pointers.size === 2) {
        const points = Array.from(zoomOverlayState.pointers.values());
        const distance = Math.hypot(points[0].clientX - points[1].clientX, points[0].clientY - points[1].clientY);
        if (zoomOverlayState.pinchStartDistance > 0) {
          const newScale = clamp(zoomOverlayState.pinchStartScale * (distance / zoomOverlayState.pinchStartDistance), 0.5, 5);
          const scaleRatio = newScale / zoomOverlayState.pinchStartScale;
          zoomOverlayState.scale = newScale;
          zoomOverlayState.translateX = clamp(
            zoomOverlayState.pinchStartTranslateX + (1 - scaleRatio) * zoomOverlayState.pinchStartMidX,
            -zoomOverlayState.maxOffsetX,
            zoomOverlayState.maxOffsetX
          );
          zoomOverlayState.translateY = clamp(
            zoomOverlayState.pinchStartTranslateY + (1 - scaleRatio) * zoomOverlayState.pinchStartMidY,
            -zoomOverlayState.maxOffsetY,
            zoomOverlayState.maxOffsetY
          );
          updateZoomImageTransform();
        }
        return;
      }
      if (!zoomOverlayState.dragging) return;
      event.preventDefault();
      const dx = event.clientX - zoomOverlayState.startX;
      const dy = event.clientY - zoomOverlayState.startY;
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) zoomOverlayState.moved = true;
      zoomOverlayState.startX = event.clientX;
      zoomOverlayState.startY = event.clientY;
      zoomOverlayState.translateX = clamp(zoomOverlayState.translateX + dx, -zoomOverlayState.maxOffsetX, zoomOverlayState.maxOffsetX);
      zoomOverlayState.translateY = clamp(zoomOverlayState.translateY + dy, -zoomOverlayState.maxOffsetY, zoomOverlayState.maxOffsetY);
      updateZoomImageTransform();
    });

    image.addEventListener('pointerup', endPointer);

    image.addEventListener('pointercancel', endPointer);

    image.addEventListener('click', () => {
      if (!zoomOverlayState.moved && zoomOverlayState.scale <= 1) {
        hideZoomOverlay();
      }
    });

    container.addEventListener('click', (event) => {
      if (event.target === container) {
        hideZoomOverlay();
      }
    });

    container.addEventListener('wheel', (event) => {
      if (!zoomOverlayState.image) return;
      event.preventDefault();
      const pointer = getWrapperCenterPoint(event.clientX, event.clientY);
      const prevScale = zoomOverlayState.scale;
      const delta = -event.deltaY * 0.002;
      const newScale = clamp(prevScale + delta, 0.5, 5);
      if (newScale === prevScale) return;
      const scaleRatio = newScale / prevScale;
      zoomOverlayState.scale = newScale;
      updateZoomLimits();
      zoomOverlayState.translateX = clamp(
        zoomOverlayState.translateX + (1 - scaleRatio) * pointer.x,
        -zoomOverlayState.maxOffsetX,
        zoomOverlayState.maxOffsetX
      );
      zoomOverlayState.translateY = clamp(
        zoomOverlayState.translateY + (1 - scaleRatio) * pointer.y,
        -zoomOverlayState.maxOffsetY,
        zoomOverlayState.maxOffsetY
      );
      updateZoomImageTransform();
    }, { passive: false });

    window.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && zoomOverlayState.container && zoomOverlayState.container.style.display === 'flex') {
        hideZoomOverlay();
      }
    });

    zoomOverlayState.container = container;
    zoomOverlayState.wrapper = wrapper;
    zoomOverlayState.image = image;
    zoomOverlayState.caption = caption;
    document.body.appendChild(container);
  }

  function showZoomOverlay(url, title) {
    if (!url) return;
    createZoomOverlay();
    const { container, image, caption, wrapper } = zoomOverlayState;
    zoomOverlayState.translateX = 0;
    zoomOverlayState.translateY = 0;
    zoomOverlayState.maxOffsetX = 0;
    zoomOverlayState.maxOffsetY = 0;
    zoomOverlayState.moved = false;
    container.style.display = 'flex';
    image.style.width = 'auto';
    image.style.height = 'auto';
    caption.textContent = title || '';

    image.onload = () => {
      zoomOverlayState.scale = 1;
      zoomOverlayState.translateX = 0;
      zoomOverlayState.translateY = 0;
      updateZoomImageTransform();
    };

    image.onerror = () => {
      hideZoomOverlay();
    };

    image.src = url;
  }

  async function initPage(config) {
    const finalConfig = Object.assign({}, defaultConfig, config);
    finalConfig.rootPath = normalizePath(finalConfig.rootPath);

    const message = document.getElementById(finalConfig.messageId);
    const gallery = document.getElementById(finalConfig.targetId);
    if (!message || !gallery) {
      throw new Error('找不到 message 或 gallery 容器，请确认页面中存在指定 ID。');
    }

    message.textContent = `正在加载 ${finalConfig.rootPath} 中的图片...`;
    gallery.innerHTML = '';

    try {
      let folderNames = await loadFolderNames(finalConfig);
      const titleMap = await loadTitleMap(finalConfig);
      finalConfig.titleMap = titleMap;
      folderNames = sortFolderNames(folderNames, finalConfig.sortOrder);

      if (!folderNames.length) {
        message.textContent = finalConfig.emptyFolderText;
        renderEmpty(gallery, finalConfig.noItemsText);
        return;
      }

      let loadedCount = 0;
      for (const folderName of folderNames) {
        const files = await findResponsiveFiles(finalConfig.rootPath, folderName, finalConfig.supportedExt, finalConfig.sizes);
        if (!files.small && !files.medium && !files.large) {
          continue;
        }
        const caption = captionText(folderName, files, finalConfig);
        gallery.appendChild(createCard(folderName, files, caption, finalConfig));
        loadedCount += 1;
      }

      if (!loadedCount) {
        message.textContent = '未找到可展示的响应式图片。请检查文件名后缀是否为 _w400/_w800/_w1200。';
        renderEmpty(gallery, finalConfig.noItemsText);
        return;
      }

      message.textContent = `已加载 ${loadedCount} 个作品，按 ${finalConfig.sortOrder === 'asc' ? '最早到最新' : '最新到最晚'} 顺序显示。`;
    } catch (error) {
      console.error(error);
      message.textContent = `读取图片时发生错误：${error.message}`;
      renderEmpty(gallery, '请通过 GitHub Pages 或本地服务器打开此页面，并确认目录可访问。');
    }
  }

  global.GalleryLoader = {
    initPage
  };
})(window);


