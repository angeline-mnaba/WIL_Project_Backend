import { supabase } from './supabaseClient.js';

const CANVAS_WIDTH = 1200;
const CANVAS_HEIGHT = 820;
const SIGNED_URL_TTL_SECONDS = 60 * 60 * 24 * 365;

export function initJobCardCanvas() {
  const canvasEl = document.getElementById('job-card-canvas');
  if (!canvasEl || !window.fabric) return null;

  const canvas = new fabric.Canvas('job-card-canvas', {
    width: CANVAS_WIDTH,
    height: CANVAS_HEIGHT,
    backgroundColor: '#ffffff',
    isDrawingMode: false,
  });

  const selectBtn = document.getElementById('tool-select');
  const drawBtn = document.getElementById('tool-draw');
  const eraseBtn = document.getElementById('tool-erase');
  const colourInput = document.getElementById('draw-colour');
  const widthInput = document.getElementById('draw-width');
  const addTextBtn = document.getElementById('tool-add-text');
  const addImageBtn = document.getElementById('tool-add-image');
  const imageFileInput = document.getElementById('image-file-input');
  const cropBtn = document.getElementById('tool-crop');
  const applyCropBtn = document.getElementById('apply-crop-button');
  const cancelCropBtn = document.getElementById('cancel-crop-button');
  const deleteSelectedBtn = document.getElementById('tool-delete-selected');
  const clearBtn = document.getElementById('tool-clear-canvas');
  const otherToolButtons = [selectBtn, drawBtn, eraseBtn, addTextBtn, addImageBtn, deleteSelectedBtn, clearBtn];

  let currentMode = 'select';
  let isErasing = false;
  let cropRect = null;
  let cropTargetImage = null;

  canvas.freeDrawingBrush.color = colourInput.value;
  canvas.freeDrawingBrush.width = Number(widthInput.value);

  function applyMode(mode) {
    currentMode = mode;
    canvas.isDrawingMode = mode === 'draw';
    canvas.selection = mode === 'select';
    canvas.forEachObject((object) => {
      object.selectable = mode === 'select';
      object.evented = mode !== 'draw';
    });
    [selectBtn, drawBtn, eraseBtn].forEach((toolButton) => toolButton.classList.remove('active'));
    if (mode === 'select') selectBtn.classList.add('active');
    if (mode === 'draw') drawBtn.classList.add('active');
    if (mode === 'erase') eraseBtn.classList.add('active');
    if (mode !== 'select') {
      canvas.discardActiveObject();
    }
    canvas.requestRenderAll();
  }

  function setOtherToolsEnabled(enabled) {
    otherToolButtons.forEach((button) => {
      button.disabled = !enabled;
    });
  }

  function exitCropMode() {
    if (cropRect) {
      canvas.remove(cropRect);
      cropRect = null;
    }

    cropTargetImage = null;
    cropBtn.style.display = 'inline-block';
    applyCropBtn.style.display = 'none';
    cancelCropBtn.style.display = 'none';
    setOtherToolsEnabled(true);
    canvas.requestRenderAll();
  }

  function eraseTargetFromEvent(event) {
    const target = canvas.findTarget(event, true);
    if (!target || target === cropRect || target.jobCardCropOverlay) return;
    canvas.remove(target);
    canvas.discardActiveObject();
    canvas.requestRenderAll();
  }

  selectBtn.addEventListener('click', () => applyMode('select'));
  drawBtn.addEventListener('click', () => applyMode('draw'));
  eraseBtn.addEventListener('click', () => applyMode('erase'));

  canvas.on('mouse:down', (options) => {
    if (currentMode !== 'erase') return;
    isErasing = true;
    eraseTargetFromEvent(options.e);
  });

  canvas.on('mouse:move', (options) => {
    if (!isErasing || currentMode !== 'erase') return;
    eraseTargetFromEvent(options.e);
  });

  canvas.on('mouse:up', () => {
    isErasing = false;
  });

  colourInput.addEventListener('input', () => {
    canvas.freeDrawingBrush.color = colourInput.value;
  });

  widthInput.addEventListener('input', () => {
    canvas.freeDrawingBrush.width = Number(widthInput.value);
  });

  addTextBtn.addEventListener('click', () => {
    const text = new fabric.Textbox('Note...', {
      left: 60,
      top: 60,
      fontSize: 18,
      fill: '#1a1a1a',
      width: 200,
    });
    canvas.add(text);
    canvas.setActiveObject(text);
    applyMode('select');
  });

  deleteSelectedBtn.addEventListener('click', () => {
    const activeObjects = canvas.getActiveObjects();
    activeObjects.forEach((object) => canvas.remove(object));
    canvas.discardActiveObject();
    canvas.requestRenderAll();
  });

  clearBtn.addEventListener('click', () => {
    if (!window.confirm('Clear the entire board? This removes every sketch, note, and photo on it.')) return;
    canvas.clear();
    canvas.backgroundColor = '#ffffff';
    canvas.requestRenderAll();
  });

  addImageBtn.addEventListener('click', () => imageFileInput.click());

  cropBtn.addEventListener('click', () => {
    applyMode('select');
    const active = canvas.getActiveObject();
    if (!active || active.type !== 'image') {
      window.alert('Select a photo on the board first, then click Crop Photo.');
      return;
    }

    if (active.angle) {
      window.alert('Straighten this photo (reset its rotation to 0) before cropping.');
      return;
    }

    cropTargetImage = active;
    const bounds = active.getBoundingRect();

    cropRect = new fabric.Rect({
      left: bounds.left,
      top: bounds.top,
      width: bounds.width,
      height: bounds.height,
      fill: 'rgba(0,0,0,0.15)',
      stroke: '#ffffff',
      strokeDashArray: [6, 4],
      strokeWidth: 2,
      cornerColor: '#ffffff',
      cornerStrokeColor: '#333333',
      transparentCorners: false,
      lockRotation: true,
      jobCardCropOverlay: true,
    });
    cropRect.setControlsVisibility({ mtr: false });

    canvas.add(cropRect);
    canvas.setActiveObject(cropRect);
    canvas.requestRenderAll();

    cropBtn.style.display = 'none';
    applyCropBtn.style.display = 'inline-block';
    cancelCropBtn.style.display = 'inline-block';
    setOtherToolsEnabled(false);
  });

  cancelCropBtn.addEventListener('click', () => exitCropMode());

  applyCropBtn.addEventListener('click', async () => {
    if (!cropRect || !cropTargetImage) {
      exitCropMode();
      return;
    }

    const image = cropTargetImage;
    const imageBounds = image.getBoundingRect();
    const cropBounds = cropRect.getBoundingRect();

    const clampedLeft = Math.max(cropBounds.left, imageBounds.left);
    const clampedTop = Math.max(cropBounds.top, imageBounds.top);
    const clampedRight = Math.min(cropBounds.left + cropBounds.width, imageBounds.left + imageBounds.width);
    const clampedBottom = Math.min(cropBounds.top + cropBounds.height, imageBounds.top + imageBounds.height);
    const clampedWidth = clampedRight - clampedLeft;
    const clampedHeight = clampedBottom - clampedTop;

    if (clampedWidth < 10 || clampedHeight < 10) {
      window.alert('Crop area is too small or falls outside the photo - adjust the crop box and try again.');
      return;
    }

    const scaleX = image.scaleX || 1;
    const scaleY = image.scaleY || 1;
    const naturalX = (clampedLeft - imageBounds.left) / scaleX;
    const naturalY = (clampedTop - imageBounds.top) / scaleY;
    const naturalWidth = clampedWidth / scaleX;
    const naturalHeight = clampedHeight / scaleY;

    const sourceEl = image.getElement();
    const offscreen = document.createElement('canvas');
    offscreen.width = Math.round(naturalWidth);
    offscreen.height = Math.round(naturalHeight);
    offscreen.getContext('2d').drawImage(
      sourceEl,
      naturalX,
      naturalY,
      naturalWidth,
      naturalHeight,
      0,
      0,
      offscreen.width,
      offscreen.height,
    );

    const croppedDataUrl = offscreen.toDataURL('image/png');
    const croppedBlob = await (await fetch(croppedDataUrl)).blob();

    const path = `${crypto.randomUUID()}-cropped.png`;
    const { error: uploadError } = await supabase.storage
      .from('job-card-images')
      .upload(path, croppedBlob, { contentType: 'image/png' });

    if (uploadError) {
      window.alert('Could not save the cropped photo. Please try again.');
      exitCropMode();
      return;
    }

    const { data: signedUrlData, error: signedUrlError } = await supabase.storage
      .from('job-card-images')
      .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);

    if (signedUrlError || !signedUrlData?.signedUrl) {
      window.alert('Photo cropped, but could not reload it onto the board.');
      exitCropMode();
      return;
    }

    fabric.Image.fromURL(
      signedUrlData.signedUrl,
      (newImage) => {
        newImage.set({ left: clampedLeft, top: clampedTop });
        newImage.scaleToWidth(clampedWidth);
        newImage.jobCardImagePath = path;

        canvas.remove(image);
        canvas.remove(cropRect);
        cropRect = null;
        canvas.add(newImage);
        canvas.setActiveObject(newImage);
        applyMode('select');
        exitCropMode();
      },
      { crossOrigin: 'anonymous' },
    );
  });

  imageFileInput.addEventListener('change', async () => {
    const file = imageFileInput.files[0];
    imageFileInput.value = '';
    if (!file) return;

    const path = `${crypto.randomUUID()}-${file.name}`;
    const { error: uploadError } = await supabase.storage
      .from('job-card-images')
      .upload(path, file);

    if (uploadError) {
      window.alert('Could not upload that image. Please try again.');
      return;
    }

    const { data: signedUrlData, error: signedUrlError } = await supabase.storage
      .from('job-card-images')
      .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);

    if (signedUrlError || !signedUrlData?.signedUrl) {
      window.alert('Image uploaded, but could not load it onto the board.');
      return;
    }

    fabric.Image.fromURL(
      signedUrlData.signedUrl,
      (img) => {
        img.set({ left: 100, top: 100 });
        img.scaleToWidth(280);
        img.jobCardImagePath = path;
        canvas.add(img);
        canvas.setActiveObject(img);
        canvas.requestRenderAll();
      },
      { crossOrigin: 'anonymous' },
    );

    applyMode('select');
  });

  return canvas;
}

export function serializeCanvas(canvas) {
  return canvas.toJSON(['jobCardImagePath']);
}

export function exportCanvasContentImage(canvas) {
  const objects = canvas.getObjects().filter((object) => !object.jobCardCropOverlay);
  if (objects.length === 0) return null;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  objects.forEach((object) => {
    const bounds = object.getBoundingRect(true, true);
    minX = Math.min(minX, bounds.left);
    minY = Math.min(minY, bounds.top);
    maxX = Math.max(maxX, bounds.left + bounds.width);
    maxY = Math.max(maxY, bounds.top + bounds.height);
  });

  const padding = 24;
  const left = Math.max(0, minX - padding);
  const top = Math.max(0, minY - padding);
  const width = Math.min(canvas.getWidth() - left, maxX - minX + padding * 2);
  const height = Math.min(canvas.getHeight() - top, maxY - minY + padding * 2);

  return canvas.toDataURL({ format: 'png', quality: 1, left, top, width, height });
}

export async function loadCanvasData(canvas, canvasData) {
  if (!canvasData) return;

  const objects = canvasData.objects ?? [];
  for (const object of objects) {
    if (object.type === 'image' && object.jobCardImagePath) {
      const { data: signedUrlData } = await supabase.storage
        .from('job-card-images')
        .createSignedUrl(object.jobCardImagePath, SIGNED_URL_TTL_SECONDS);

      if (signedUrlData?.signedUrl) {
        object.src = signedUrlData.signedUrl;
        object.crossOrigin = 'anonymous';
      }
    }
  }

  await new Promise((resolve) => {
    canvas.loadFromJSON(canvasData, () => {
      canvas.requestRenderAll();
      resolve();
    });
  });
}
