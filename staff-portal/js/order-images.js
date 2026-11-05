import { supabase } from './supabaseClient.js';
import { escapeHtml } from './line-items.js';

export const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
export const MAX_BYTES = 10 * 1024 * 1024;

const EXTENSIONS_BY_TYPE = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

const TYPE_BY_EXTENSION = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
};

function fileExtension(name = '') {
  return name.split('.').pop().toLowerCase();
}

function friendlyError(error, fallback) {
  return error?.message || fallback;
}

export function validateImageFile(file) {
  if (file.size > MAX_BYTES) {
    return { ok: false, error: 'That image is larger than 10 MB.' };
  }

  const extension = fileExtension(file.name);
  if (file.type === 'image/heic' || file.type === 'image/heif' || extension === 'heic' || extension === 'heif') {
    return {
      ok: false,
      error: "Please upload a JPG or PNG. iPhone photos can be saved as 'Most Compatible'.",
    };
  }

  const type = file.type || TYPE_BY_EXTENSION[extension];
  if (!ALLOWED_TYPES.includes(type)) {
    return { ok: false, error: 'Please upload a JPG, PNG, WebP, or GIF image.' };
  }

  return { ok: true, ext: EXTENSIONS_BY_TYPE[type] };
}

export async function listOrderImages(orderId) {
  return supabase
    .from('order_images')
    .select('*')
    .eq('order_id', orderId)
    .order('created_at', { ascending: true });
}

export async function uploadOrderImages(orderId, files, caption, userId, onProgress) {
  const results = [];

  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    const validation = validateImageFile(file);
    if (!validation.ok) {
      results.push({ name: file.name, ok: false, error: validation.error });
      continue;
    }

    onProgress?.(index, files.length, file);
    const filePath = `${orderId}/${crypto.randomUUID()}.${validation.ext}`;
    let uploaded = false;

    try {
      const { error: uploadError } = await supabase.storage
        .from('order-images')
        .upload(filePath, file, { contentType: file.type || TYPE_BY_EXTENSION[fileExtension(file.name)] });

      if (uploadError) {
        results.push({ name: file.name, ok: false, error: friendlyError(uploadError, 'Could not upload image.') });
        continue;
      }
      uploaded = true;

      const { data, error: insertError } = await supabase
        .from('order_images')
        .insert({ order_id: orderId, file_path: filePath, caption: caption || null, uploaded_by: userId })
        .select();

      if (insertError || !data?.length) {
        await supabase.storage.from('order-images').remove([filePath]);
        uploaded = false;
        results.push({
          name: file.name,
          ok: false,
          error: friendlyError(insertError, 'Image did not save - not permitted or order not found.'),
        });
        continue;
      }

      results.push({ name: file.name, ok: true });
    } catch (error) {
      if (uploaded) await supabase.storage.from('order-images').remove([filePath]);
      results.push({ name: file.name, ok: false, error: friendlyError(error, 'Could not upload image.') });
    }
  }

  return results;
}

export async function deleteOrderImage(image) {
  const { error: storageError } = await supabase.storage.from('order-images').remove([image.file_path]);
  if (storageError) {
    return { ok: false, error: friendlyError(storageError, 'Could not delete image file.') };
  }

  const { data, error } = await supabase
    .from('order_images')
    .delete()
    .eq('id', image.id)
    .select();

  if (error) return { ok: false, error: friendlyError(error, 'Could not delete image.') };
  if (!data?.length) return { ok: false, error: 'Image delete did not apply.' };
  return { ok: true };
}

export async function getImageUrl(filePath) {
  const { data, error } = await supabase.storage.from('order-images').createSignedUrl(filePath, 3600);
  return { url: data?.signedUrl ?? null, error };
}

export async function openOrderImageViewer(orderId, startIndex = 0) {
  const { data: images, error } = await listOrderImages(orderId);
  const overlay = document.createElement('div');
  overlay.className = 'order-image-viewer';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');

  const panel = document.createElement('div');
  panel.className = 'order-image-viewer-panel';
  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.className = 'order-image-viewer-close';
  closeButton.setAttribute('aria-label', 'Close image viewer');
  closeButton.textContent = 'Close';
  panel.append(closeButton);

  const content = document.createElement('div');
  content.className = 'order-image-viewer-content';
  panel.append(content);
  const navigation = document.createElement('div');
  navigation.className = 'order-image-viewer-navigation';
  panel.append(navigation);
  overlay.append(panel);

  const previousOverflow = document.body.style.overflow;
  let index = Math.max(0, Math.min(startIndex, (images?.length ?? 1) - 1));
  let renderVersion = 0;

  const close = () => {
    document.body.style.overflow = previousOverflow;
    document.removeEventListener('keydown', onKeydown);
    overlay.remove();
  };

  const renderEmpty = (message) => {
    content.replaceChildren();
    const empty = document.createElement('p');
    empty.className = 'order-image-viewer-message';
    empty.textContent = message;
    content.append(empty);
  };

  const showImage = async () => {
    const version = ++renderVersion;
    const image = images[index];
    content.replaceChildren();
    navigation.replaceChildren();

    const loading = document.createElement('p');
    loading.className = 'order-image-viewer-message';
    loading.textContent = 'Loading image...';
    content.append(loading);

    const { url, error: urlError } = await getImageUrl(image.file_path);
    if (version !== renderVersion || !overlay.isConnected) return;
    if (!url || urlError) {
      renderEmpty('Could not load this image.');
      return;
    }

    const imageElement = document.createElement('img');
    imageElement.className = 'order-image-viewer-image';
    imageElement.src = url;
    imageElement.alt = image.caption ? `Order image: ${image.caption}` : 'Order image';
    imageElement.addEventListener('error', () => {
      if (version === renderVersion && overlay.isConnected) renderEmpty('Could not load this image.');
    }, { once: true });

    const caption = document.createElement('p');
    caption.className = 'order-image-viewer-caption';
    caption.innerHTML = escapeHtml(image.caption || 'No caption');

    const count = document.createElement('p');
    count.className = 'order-image-viewer-count';
    count.textContent = `Image ${index + 1} of ${images.length}`;

    content.append(imageElement, caption, count);

    if (images.length > 1) {
      const previous = document.createElement('button');
      previous.type = 'button';
      previous.className = 'order-image-viewer-arrow order-image-viewer-previous';
      previous.setAttribute('aria-label', 'Previous image');
      previous.textContent = 'Previous';
      previous.addEventListener('click', () => {
        index = (index - 1 + images.length) % images.length;
        showImage();
      });

      const next = document.createElement('button');
      next.type = 'button';
      next.className = 'order-image-viewer-arrow order-image-viewer-next';
      next.setAttribute('aria-label', 'Next image');
      next.textContent = 'Next';
      next.addEventListener('click', () => {
        index = (index + 1) % images.length;
        showImage();
      });
      navigation.append(previous, next);
    }
  };

  const onKeydown = (event) => {
    if (event.key === 'Escape') close();
    if (images?.length > 1 && event.key === 'ArrowLeft') {
      index = (index - 1 + images.length) % images.length;
      showImage();
    }
    if (images?.length > 1 && event.key === 'ArrowRight') {
      index = (index + 1) % images.length;
      showImage();
    }
  };

  closeButton.addEventListener('click', close);
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) close();
  });

  document.body.append(overlay);
  document.body.style.overflow = 'hidden';
  document.addEventListener('keydown', onKeydown);
  closeButton.focus();

  if (error || !images?.length) {
    renderEmpty(error ? 'Could not load this image.' : 'No image attached yet.');
    return;
  }

  showImage();
}
