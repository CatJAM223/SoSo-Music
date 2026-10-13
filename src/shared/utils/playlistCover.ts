export async function preparePlaylistCover(file: File): Promise<string> {
  if (!file.type.startsWith('image/') || file.size > 10 * 1024 * 1024) {
    throw new Error('Выберите изображение размером до 10 МБ.');
  }
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Не удалось обработать изображение.');
    const side = Math.min(bitmap.width, bitmap.height);
    ctx.drawImage(
      bitmap,
      (bitmap.width - side) / 2,
      (bitmap.height - side) / 2,
      side,
      side,
      0,
      0,
      512,
      512,
    );
    const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
    if (dataUrl.length > 750000) throw new Error('Обложка слишком большая.');
    return dataUrl;
  } finally {
    bitmap.close();
  }
}
